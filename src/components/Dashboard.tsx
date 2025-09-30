import React, { useState, useEffect, useRef } from 'react';
import { Channel, SearchParams, ConnectionState } from '../types';
import { summarizeDiscussions, analyzeQuery } from '../services/geminiService';
import { getPublicChannels, searchMessages } from '../services/slackService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { SearchIcon } from './icons/SearchIcon';
import MarkdownRenderer from './MarkdownRenderer';
import { AlertTriangleIcon } from './icons/AlertTriangleIcon';
import { XCircleIcon } from './icons/XCircleIcon';

interface DashboardProps {
  connectionState: ConnectionState;
  onRetry: () => void;
  slackToken: string | null;
}

const REQUIRED_SCOPES = ['search:read', 'channels:history', 'channels:read', 'team:read'];
const scopeDescriptions: Record<string, string> = {
    'search:read': 'Searches for messages in public channels based on keywords.',
    'channels:history': 'Reads messages from selected public channels.',
    'channels:read': 'Fetches the list of public channels in the workspace for selection.',
    'team:read': 'Fetches basic workspace information like name and icon.',
};

const Dashboard: React.FC<DashboardProps> = ({ connectionState, onRetry, slackToken }) => {
  const { isLoading, workspace, error, hasAllPermissions } = connectionState;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summary, setSummary] = useState('');
  const [naturalQuery, setNaturalQuery] = useState('Database migration plan discussed in the last 2 weeks');
  const [searchParams, setSearchParams] = useState<Omit<SearchParams, 'channels' | 'keyword'>>({
      startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0]
  });
  const [copySuccess, setCopySuccess] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [summaryViewMode, setSummaryViewMode] = useState<'preview' | 'markdown'>('preview');
  const [loadingMessage, setLoadingMessage] = useState('AI is thinking...');
  const [executedSearchKeyword, setExecutedSearchKeyword] = useState('');


  useEffect(() => {
    if (workspace && hasAllPermissions && slackToken) {
      setChannelsLoading(true);
      getPublicChannels(slackToken)
        .then(setChannels)
        .catch(err => {
          console.error("Failed to load channels:", err);
        })
        .finally(() => setChannelsLoading(false));
    }
  }, [workspace, hasAllPermissions, slackToken]);

  const handleChannelToggle = (channelId: string) => {
    setSelectedChannels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(channelId)) {
        newSet.delete(channelId);
      } else {
        newSet.add(channelId);
      }
      return newSet;
    });
  };
  
  const handleCancel = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
  };

  const handleGenerateSummary = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!naturalQuery.trim() || !slackToken) {
          alert('Please enter something to search for.');
          return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoadingSummary(true);
      setSummary('');
      setExecutedSearchKeyword('');
      setSummaryViewMode('preview');
      try {
        setLoadingMessage('Analyzing your request...');
        const keywords = await analyzeQuery(naturalQuery, controller.signal);
        
        if (keywords.length === 0) {
            throw new Error("AI could not extract search terms from the request.");
        }
        const searchKeyword = keywords.join(' ');

        const fullParams: SearchParams = {
          ...searchParams,
          keyword: searchKeyword,
          channels: Array.from(selectedChannels)
        };
        
        setLoadingMessage('Searching relevant Slack conversations...');
        const messages = await searchMessages(slackToken, fullParams, controller.signal);

        if (messages.length === 0) {
            setSummary("# No Results Found\n\nNo messages matched your search criteria. Try expanding the search query or date range.");
            setExecutedSearchKeyword(searchKeyword);
            setIsLoadingSummary(false);
            return;
        }

        const formattedMessages = messages.map(msg => ({
            user: msg.username || msg.user,
            timestamp: msg.ts,
            text: msg.text,
            permalink: msg.permalink,
            replies: (msg.replies || []).map((reply: any) => ({
                user: reply.username || reply.user,
                timestamp: reply.ts,
                text: reply.text,
            }))
        }));

        setLoadingMessage('Summarizing the findings...');
        const result = await summarizeDiscussions(fullParams, formattedMessages, controller.signal);
        setSummary(result);
        setExecutedSearchKeyword(searchKeyword);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('Summary generation was canceled by the user.');
            setSummary("Summary generation was canceled.");
        } else {
            console.error("Failed to generate summary:", error);
            setSummary(`Failed to generate summary: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`);
        }
      } finally {
        setIsLoadingSummary(false);
        abortControllerRef.current = null;
      }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const filteredChannels = channels.filter(channel =>
    channel.name.toLowerCase().includes(channelSearchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
            <SpinnerIcon className="animate-spin h-8 w-8 text-indigo-400 mb-4" />
            <p className="text-gray-300">Connecting to Slack workspace...</p>
        </div>
    );
  }

  if (error) {
      return (
          <div className="flex flex-col items-center justify-center text-center min-h-[300px]">
              <AlertTriangleIcon className="h-10 w-10 text-red-400 mb-4" />
              <h3 className="text-xl font-bold text-red-400">Connection Failed</h3>
              <p className="text-gray-400 mt-2 max-w-md">{error}</p>
              {error.includes("Vercel") && <p className="text-gray-500 mt-2 text-sm">Please check the <code>VITE_SLACK_TOKEN</code> environment variable in your Vercel dashboard and redeploy.</p>}
              <button
                  onClick={onRetry}
                  className="mt-6 inline-flex items-center justify-center bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors text-lg"
              >
                  Refresh to Retry
              </button>
          </div>
      );
  }

  if (workspace && !hasAllPermissions) {
      const userScopes = new Set(workspace.scopes);
      return (
          <div className="text-center flex flex-col items-center">
               <div className="flex items-center space-x-3 mb-4">
                  <img src={workspace.teamIcon} alt={workspace.name} className="h-10 w-10 rounded-md" />
                  <div>
                      <p className="font-semibold text-white text-left">{workspace.name}</p>
                      <p className="text-sm text-gray-400 text-left">Workspace Connected</p>
                  </div>
              </div>

              <h2 className="text-2xl font-bold text-red-400 mb-3">Insufficient Permissions</h2>
              <p className="text-gray-300 mb-6 max-w-2xl">
                  The provided token is missing some required permissions. To ensure the app functions correctly, you need to create a new token with all the required permissions listed below.
              </p>

              <div className="w-full max-w-lg mb-8 text-left">
                  <h3 className="text-lg font-semibold text-white mb-4">Required Permissions Status</h3>
                  <ul className="space-y-3">
                      {REQUIRED_SCOPES.map(scope => (
                           <li className="flex items-start space-x-4 p-3 bg-gray-700/50 rounded-lg" key={scope}>
                              <div>
                                  {userScopes.has(scope) ? (
                                      <CheckCircleIcon className="h-6 w-6 text-green-400 flex-shrink-0" />
                                  ) : (
                                      <XCircleIcon className="h-6 w-6 text-red-400 flex-shrink-0" />
                                  )}
                              </div>
                              <div>
                                  <code className="font-mono text-sm bg-gray-600 text-indigo-300 rounded px-1.5 py-0.5">{scope}</code>
                                  <p className="text-gray-400 text-sm mt-1">{scopeDescriptions[scope] || 'Required permission.'}</p>
                              </div>
                          </li>
                      ))}
                  </ul>
              </div>
              
              <button
                  onClick={onRetry}
                  className="inline-flex items-center justify-center bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors text-lg"
              >
                  Refresh to Retry
              </button>
          </div>
      );
  }

  if (workspace && hasAllPermissions) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-3">
            <img src={workspace.teamIcon} alt={workspace.name} className="h-10 w-10 rounded-md" />
            <div>
              <p className="font-semibold text-white">{workspace.name}</p>
              <p className="text-sm text-green-400">Workspace Connected</p>
            </div>
          </div>
        </div>

        <>
          <form onSubmit={handleGenerateSummary} className="mt-8">
            <div className="space-y-6">
              <div>
                <label htmlFor="natural-query" className="block text-sm font-medium text-gray-300 mb-1">What are you looking for?</label>
                <textarea 
                  id="natural-query" 
                  value={naturalQuery} 
                  onChange={e => setNaturalQuery(e.target.value)} 
                  className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500 min-h-[60px]" 
                  placeholder="e.g., Find the discussion about the database migration plan from last week" 
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div>
                    <label htmlFor="start-date" className="block text-sm font-medium text-gray-300 mb-1">Start Date</label>
                    <input type="date" id="start-date" value={searchParams.startDate} onChange={e => setSearchParams({...searchParams, startDate: e.target.value})} className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
                </div>
                 <div>
                    <label htmlFor="end-date" className="block text-sm font-medium text-gray-300 mb-1">End Date</label>
                    <input type="date" id="end-date" value={searchParams.endDate} onChange={e => setSearchParams({...searchParams, endDate: e.target.value})} className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Limit to specific channels (optional)</h4>
                <div className="relative mb-2">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                    <SearchIcon className="h-5 w-5 text-gray-400" />
                  </span>
                  <input
                    type="text"
                    value={channelSearchQuery}
                    onChange={e => setChannelSearchQuery(e.target.value)}
                    className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 pl-10 text-white focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Search channels..."
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    {channelsLoading && <p className="text-gray-400 text-sm col-span-full">Loading channels...</p>}
                    {!channelsLoading && filteredChannels.length > 0 && filteredChannels.map(channel => (
                        <label key={channel.id} className="flex items-center space-x-2 text-white cursor-pointer hover:bg-gray-700 p-1 rounded-md">
                            <input type="checkbox" checked={selectedChannels.has(channel.id)} onChange={() => handleChannelToggle(channel.id)} className="rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500" />
                            <span>#{channel.name}</span>
                        </label>
                    ))}
                     {!channelsLoading && filteredChannels.length === 0 && (
                        <p className="text-gray-400 text-sm col-span-full">No matching channels found.</p>
                    )}
                </div>
                <p className="text-xs text-gray-500 mt-1">If no channels are selected, all public channels will be searched.</p>
              </div>
              <div className="flex items-center gap-4">
                  <button 
                      type="submit" 
                      disabled={isLoadingSummary} 
                      className="flex-grow bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition-opacity flex items-center justify-center text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                      {isLoadingSummary && <SpinnerIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />}
                      {isLoadingSummary ? 'Generating Summary...' : 'Generate Summary'}
                  </button>
                  {isLoadingSummary && (
                      <button 
                          type="button" 
                          onClick={handleCancel} 
                          className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-colors flex-shrink-0"
                      >
                          Cancel
                      </button>
                  )}
              </div>
            </div>
          </form>
          
          {(isLoadingSummary || summary) && (
            <div className="mt-8">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Generated Summary</h2>
                  {summary && !isLoadingSummary && (
                    <div className="flex items-center space-x-1 bg-gray-700 p-1 rounded-lg">
                      <button
                        onClick={() => setSummaryViewMode('preview')}
                        className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${summaryViewMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => setSummaryViewMode('markdown')}
                        className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${summaryViewMode === 'markdown' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                      >
                        Markdown
                      </button>
                    </div>
                  )}
                </div>
                
                {executedSearchKeyword && !isLoadingSummary && (
                  <div className="mb-4 text-sm text-gray-400">
                    AI-analyzed search query: <code className="font-mono bg-gray-700 text-indigo-300 rounded px-1.5 py-1">{executedSearchKeyword}</code>
                  </div>
                )}

                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 relative min-h-[10rem]">
                  {isLoadingSummary && (
                    <div className="absolute inset-0 bg-gray-900/80 flex flex-col items-center justify-center rounded-lg">
                        <SpinnerIcon className="animate-spin h-8 w-8 text-indigo-400 mb-4" />
                        <p className="text-gray-300">{loadingMessage}</p>
                        <p className="text-gray-500 text-sm">Please wait a moment.</p>
                    </div>
                  )}
                  {summary && (
                      <>
                        <button onClick={handleCopy} className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 p-2 rounded-lg text-gray-300 transition-colors z-10">
                            {copySuccess ? <CheckCircleIcon className="h-5 w-5 text-green-400" /> : <ClipboardIcon className="h-5 w-5" />}
                        </button>
                        {summaryViewMode === 'preview' && !isLoadingSummary ? (
                          <MarkdownRenderer content={summary} />
                        ) : (
                          <pre className="whitespace-pre-wrap font-mono text-sm text-gray-200">{summary}</pre>
                        )}
                      </>
                  )}
                </div>
            </div>
          )}
        </>
      </div>
    );
  }

  return null;
};

export default Dashboard;