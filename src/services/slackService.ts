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
            throw new Error('Slack API error: ratelimited');
        }
        const retryAfterSeconds = parseInt(response.headers.get('Retry-After') || '1', 10);
        console.warn(`Slack API rate limited. Retrying after ${retryAfterSeconds} seconds... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000));
        continue; // Go to the next iteration to retry
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      const data = await response.json();
      if (!data.ok) {
        console.error(`Slack API Error (${endpoint}):`, data.error);
        throw new Error(`Slack API Error: ${data.error}`);
      }
      return data; // Success, exit loop and function.
    } else {
      const text = await response.text();
      console.error(`Non-JSON response from Slack API (${endpoint}):`, text);
      throw new Error(`Failed to fetch data from Slack API. Server returned a non-JSON response.`);
    }
  }
  // This is a fallback, but the loop should handle the final error throw.
  throw new Error('Slack API request failed after multiple retries.');
};


/**
 * Wraps a promise with a timeout.
 * @param promise The promise to wrap.
 * @param ms The timeout duration in milliseconds.
 * @param errorMessage The error message to throw on timeout.
 * @returns A new promise that either resolves with the original promise's value or rejects on timeout.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMessage = 'Operation timed out.'): Promise<T> => {
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
 * Verifies a Slack token and fetches basic workspace information with a 20-second timeout.
 * It also retrieves the token's permission scopes from the response headers.
 * @param token The Slack user token (`xoxp-...`).
 * @returns A promise that resolves to a Workspace object, including scopes.
 */
export const verifyToken = async (token: string): Promise<Workspace> => {
  try {
    const response = await withTimeout(
      fetch(`${CORS_PROXY}${SLACK_API_URL}/auth.test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
      }),
      20000, // 20-second timeout
      'Slack API connection timed out. Check your token, network connection, or proxy settings.'
    );

    // For user tokens (xoxp-), scopes are returned in this header.
    // For bot tokens (xoxb-), scopes are in 'x-oauth-bot-scopes'
    const userScopes = response.headers.get('x-oauth-scopes');
    const botScopes = response.headers.get('x-oauth-bot-scopes');
    const scopesHeader = userScopes || botScopes;
    const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
    
    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Slack API Error: ${data.error}`);
    }

    // `auth.test` doesn't provide the team icon, so we fetch it separately.
    const teamInfoResponse = await slackFetch('team.info', token, 'GET', { team: data.team_id });
    const teamIcon = teamInfoResponse.team?.icon?.image_132 || '';

    return {
      id: data.team_id,
      name: data.team,
      teamIcon: teamIcon,
      scopes: scopes,
    };
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error('An unknown error occurred during token validation.');
  }
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
                console.error(`Failed to fetch thread (ts: ${ts}):`, err);
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