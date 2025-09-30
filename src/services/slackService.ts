import { Channel, SearchParams, Workspace } from '../types';

// 모든 Slack API 요청을 위한 URL 구성입니다.
// 웹 브라우저에서 직접 Slack API('https://slack.com/api')로 요청을 보내면
// CORS(Cross-Origin Resource Sharing) 보안 정책 위반으로 "Failed to fetch" 오류가 발생합니다.
// 이 문제를 해결하기 위해 공개 CORS 프록시 서비스인 corsproxy.io를 사용합니다.
// 모든 API 요청 URL 앞에 프록시 URL을 붙여 요청을 중계합니다.
const CORS_PROXY = 'https://corsproxy.io/?';
const SLACK_API_URL = 'https://slack.com/api';


/**
 * A helper function to make requests to the Slack API.
 * It automatically includes the auth token, handles Slack's `ok` flag,
 * and intelligently retries on `ratelimited` errors (HTTP 429).
 */
const slackFetch = async (endpoint: string, token: string, method: 'GET' | 'POST' = 'POST', body: object = {}, signal?: AbortSignal) => {
  let retries = 5;
  while (retries > 0) {
    let url = `${CORS_PROXY}${SLACK_API_URL}/${endpoint}`;
    const headers: HeadersInit = {
      'Authorization': `Bearer ${token}`,
    };
    let requestBody: BodyInit | undefined;

    if (method === 'GET') {
      if (Object.keys(body).length > 0) {
          const params = new URLSearchParams();
          Object.entries(body).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                  params.append(key, String(value));
              }
          });
          const queryString = params.toString();
          if (queryString) {
              url += `?${queryString}`;
          }
      }
    } else if (method === 'POST') {
      const formData = new URLSearchParams();
      if (Object.keys(body).length > 0) {
          Object.entries(body).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                  formData.append(key, String(value));
              }
          });
      }
      requestBody = formData;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal,
    });
    
    // Check for rate limiting
    if (response.status === 429) {
        retries--;
        if (retries <= 0) {
            // Throw the final error after all retries are exhausted.
            // Slack's official error code for rate limiting is 'ratelimited'.
            throw new Error('Slack API 오류: ratelimited');
        }
        const retryAfterSeconds = parseInt(response.headers.get('Retry-After') || '1', 10);
        console.warn(`Slack API 속도 제한. ${retryAfterSeconds}초 후 재시도... (${retries}회 남음)`);
        await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000));
        continue; // Go to the next iteration to retry
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      const data = await response.json();
      if (!data.ok) {
        console.error(`Slack API 오류 (${endpoint}):`, data.error);
        throw new Error(`Slack API 오류: ${data.error}`);
      }
      return data; // Success, exit loop and function.
    } else {
      const text = await response.text();
      console.error(`Slack API로부터 비-JSON 응답 (${endpoint}):`, text);
      throw new Error(`Slack API에서 데이터를 가져오는 데 실패했습니다. 서버가 JSON이 아닌 응답을 반환했습니다.`);
    }
  }
  // This is a fallback, but the loop should handle the final error throw.
  throw new Error('Slack API 요청이 여러 번의 재시도 후 실패했습니다.');
};


/**
 * Wraps a promise with a timeout.
 * @param promise The promise to wrap.
 * @param ms The timeout duration in milliseconds.
 * @param errorMessage The error message to throw on timeout.
 * @returns A new promise that either resolves with the original promise's value or rejects on timeout.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMessage = '작업 시간이 초과되었습니다.'): Promise<T> => {
    const timeout = new Promise<T>((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error(errorMessage));
        }, ms);
    });

    return Promise.race([
        promise,
        timeout
    ]);
};

/**
 * Verifies a Slack token by actively testing each required permission.
 * This method is robust against CORS proxy issues that might strip permission headers.
 * @param token The Slack user or bot token.
 * @returns A promise that resolves to a Workspace object, including scopes.
 */
export const verifyToken = async (token: string): Promise<Workspace> => {
    // 1. Basic validation and get team info. This fails fast for invalid tokens.
    const authData = await withTimeout(
      slackFetch('auth.test', token),
      20000,
      'Slack API 연결 시간이 초과되었습니다. 토큰, 네트워크 연결 또는 프록시 설정을 확인해주세요.'
    );
    const { team_id, team } = authData;

    // 2. Actively test each required scope by making a minimal API call.
    // These calls run in parallel for efficiency.
    const scopeCheckPromises = [
      // team:read check
      slackFetch('team.info', token, 'GET', { team: team_id }).then(() => 'team:read').catch(() => null),
      
      // channels:read check
      slackFetch('conversations.list', token, 'GET', { limit: 1 }).then(() => 'channels:read').catch(() => null),
      
      // search:read check
      slackFetch('search.messages', token, 'POST', { query: 'permission-check', count: 1 }).then(() => 'search:read').catch(() => null),

      // channels:history check (more complex, requires a channel ID)
      (async (): Promise<string | null> => {
        try {
          // This check depends on channels:read being present.
          const channelsData = await slackFetch('conversations.list', token, 'GET', { limit: 1, types: 'public_channel' });
          if (channelsData.channels && channelsData.channels.length > 0) {
            const channelId = channelsData.channels[0].id;
            // Now test history on that channel
            await slackFetch('conversations.history', token, 'GET', { channel: channelId, limit: 1 });
            return 'channels:history';
          }
          return null; // Can't test if no public channels exist.
        } catch (error) {
          return null; // Fails if channels:read is missing or history fails for other reasons.
        }
      })(),
    ];

    const results = await Promise.all(scopeCheckPromises);
    const grantedScopes = results.filter((scope): scope is string => scope !== null);

    // 3. Fetch team icon using the (now confirmed) team:read scope.
    let teamIcon = '';
    if (grantedScopes.includes('team:read')) {
        const teamInfoResponse = await slackFetch('team.info', token, 'GET', { team: team_id });
        teamIcon = teamInfoResponse.team?.icon?.image_132 || '';
    } else {
        console.warn("팀 아이콘을 가져올 수 없습니다. 'team:read' 권한이 없거나 확인에 실패했습니다.");
    }
    
    // 4. Return the final workspace object with actively detected scopes.
    return {
      id: team_id,
      name: team,
      teamIcon: teamIcon,
      scopes: grantedScopes,
    };
};

/**
 * Fetches all public channels from the workspace, handling pagination.
 * @param token The Slack user token.
 * @returns A promise that resolves to an array of Channel objects.
 */
export const getPublicChannels = async (token:string): Promise<Channel[]> => {
    let allChannels: Channel[] = [];
    let cursor: string | undefined = undefined;
    
    do {
        const params = {
            limit: 200,
            exclude_archived: true,
            types: 'public_channel',
            ...(cursor && { cursor }),
        };
        const data = await slackFetch('conversations.list', token, 'GET', params);
        const channels = data.channels.map((c: any) => ({ id: c.id, name: c.name }));
        allChannels = allChannels.concat(channels);
        cursor = data.response_metadata?.next_cursor;
    } while (cursor);

    return allChannels.sort((a,b) => a.name.localeCompare(b.name));
};

/**
 * Generates all possible spacing variations for a given keyword.
 * For "샷 밴드 디자인", it generates:
 * "샷 밴드 디자인", "샷밴드 디자인", "샷 밴드디자인", "샷밴드디자인"
 */
const generateQueryVariations = (keyword: string): string[] => {
    const words = keyword.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
        return [keyword];
    }

    const variations = new Set<string>();
    const numSpaces = words.length - 1;

    // Iterate through all combinations of spaces (represented by a bitmask)
    for (let i = 0; i < (1 << numSpaces); i++) {
        let currentVariation = words[0];
        for (let j = 0; j < numSpaces; j++) {
            // If the j-th bit is 1, add a space. Otherwise, concatenate.
            if ((i >> j) & 1) {
                currentVariation += ' ';
            }
            currentVariation += words[j + 1];
        }
        variations.add(currentVariation);
    }

    return Array.from(variations);
};


/**
 * Helper to perform a paginated search for a given query.
 */
const performSearch = async (token: string, query: string, signal?: AbortSignal): Promise<any[]> => {
    let allMessages: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const params = {
            query,
            sort: 'timestamp',
            sort_dir: 'asc',
            count: 100,
            page,
        };
        const data = await slackFetch('search.messages', token, 'POST', params, signal);
        if (data.messages && data.messages.matches) {
            allMessages = allMessages.concat(data.messages.matches);
        }
        hasMore = data.messages?.paging ? page < data.messages.paging.pages : false;
        page++;
    }
    return allMessages;
};

/**
 * Searches for Slack messages, then fetches full threads for any messages that are part of a thread.
 * It also generates all spacing variations of the keyword to find more relevant messages and runs searches in parallel.
 * @param token The Slack user token.
 * @param params The search parameters.
 * @returns A promise that resolves to an array of conversation threads.
 */
export const searchMessages = async (token: string, params: SearchParams, signal?: AbortSignal): Promise<any[]> => {
    const { keyword, startDate, endDate, channels } = params;
    
    const queryVariations = generateQueryVariations(keyword);
    
    // Create a promise for each search variation. These will run in parallel.
    const variationSearchPromises = queryVariations.map(variation => {
        const baseQuery = `${variation} after:${startDate} before:${endDate}`;

        if (channels.length > 0) {
            // If channels are specified, search within each channel for the current variation.
            // These channel searches also run in parallel.
            const channelSearchPromises = channels.map(channelId => {
                const channelQuery = `${baseQuery} in:${channelId}`;
                return performSearch(token, channelQuery, signal);
            });
            // After all channels are searched for this variation, flatten the results.
            return Promise.all(channelSearchPromises).then(results => results.flat());
        } else {
            // If no channels are specified, perform a single search for the current variation.
            return performSearch(token, baseQuery, signal);
        }
    });

    // Execute all variation searches in parallel and flatten the results.
    const resultsByVariation = await Promise.all(variationSearchPromises);
    const allSearchResults = resultsByVariation.flat();
    
    const uniqueMessages = Array.from(new Map(allSearchResults.map(msg => [msg.permalink, msg])).values());

    // Identify all unique threads from the search results
    const threadTsToFetch = new Map<string, string>(); // Map thread_ts to channel_id
    uniqueMessages.forEach(msg => {
        if (msg.thread_ts) {
            threadTsToFetch.set(msg.thread_ts, msg.channel.id);
        } else if (msg.reply_count > 0) {
            // This is a parent message of a thread
            threadTsToFetch.set(msg.ts, msg.channel.id);
        }
    });

    // Fetch all identified threads in parallel
    const threadFetchPromises = Array.from(threadTsToFetch.entries()).map(([ts, channelId]) =>
        slackFetch('conversations.replies', token, 'GET', { channel: channelId, ts: ts }, signal)
            .then(data => data.messages || [])
            .catch(err => {
                if (err instanceof Error && err.name === 'AbortError') {
                    // Re-throw abort errors to be handled by the caller
                    throw err;
                }
                console.error(`스레드를 가져오는 데 실패했습니다 (ts: ${ts}):`, err);
                return []; // Return empty array on error to not fail the whole process
            })
    );
    
    const fetchedThreads = (await Promise.all(threadFetchPromises)).flat();

    // Separate standalone messages from messages that are part of threads
    const standaloneMessages = uniqueMessages.filter(msg => !msg.thread_ts && !(msg.reply_count > 0));

    // Combine standalone messages and fetched threads, then deduplicate by timestamp
    const allMessages = [...standaloneMessages, ...fetchedThreads];
    const finalUniqueMessages = Array.from(new Map(allMessages.map(msg => [msg.ts, msg])).values());

    // Group messages by thread
    const threads = new Map<string, any[]>();
    finalUniqueMessages.forEach(msg => {
        const threadKey = msg.thread_ts || msg.ts;
        if (!threads.has(threadKey)) {
            threads.set(threadKey, []);
        }
        threads.get(threadKey)!.push(msg);
    });

    // Format into parent-reply structure
    const conversations = Array.from(threads.values()).map(threadMessages => {
        threadMessages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        const parent = threadMessages[0];
        parent.replies = threadMessages.slice(1);
        return parent;
    });

    // Sort conversations by the timestamp of the parent message
    conversations.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    return conversations;
};