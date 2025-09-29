
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Workspace, Channel, SearchParams } from '../types';
import { summarizeDiscussions, analyzeQuery } from '../services/geminiService';
import { getPublicChannels, searchMessages } from '../services/slackService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { SearchIcon } from './icons/SearchIcon';
import MarkdownRenderer from './MarkdownRenderer';

interface DashboardProps {
  workspace: Workspace;
  onDisconnect: () => void;
  slackToken: string;
}

const Dashboard: React.FC<DashboardProps> = ({ workspace, onDisconnect, slackToken }) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summary, setSummary] = useState('');
  const [naturalQuery, setNaturalQuery] = useState('지난 2주간 논의된 데이터베이스 마이그레이션 계획');
  const [searchParams, setSearchParams] = useState<Omit<SearchParams, 'channels' | 'keyword'>>({
      startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0]
  });
  const [copySuccess, setCopySuccess] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [summaryViewMode, setSummaryViewMode] = useState<'preview' | 'markdown'>('preview');
  const [loadingMessage, setLoadingMessage] = useState('AI가 생각 중입니다...');
  const [executedSearchKeyword, setExecutedSearchKeyword] = useState('');


  useEffect(() => {
    setChannelsLoading(true);
    getPublicChannels(slackToken)
      .then(setChannels)
      .catch(err => {
        console.error("채널을 불러오는 데 실패했습니다:", err);
      })
      .finally(() => setChannelsLoading(false));
  }, [slackToken]);

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
      if (!naturalQuery.trim()) {
          alert('검색할 내용을 입력해주세요.');
          return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoadingSummary(true);
      setSummary('');
      setExecutedSearchKeyword('');
      setSummaryViewMode('preview');
      try {
        setLoadingMessage('사용자의 요청을 분석 중입니다...');
        const keywords = await analyzeQuery(naturalQuery, controller.signal);
        
        if (keywords.length === 0) {
            throw new Error("AI가 요청에서 검색어를 추출하지 못했습니다.");
        }
        const searchKeyword = keywords.join(' ');

        const fullParams: SearchParams = {
          ...searchParams,
          keyword: searchKeyword,
          channels: Array.from(selectedChannels)
        };
        
        setLoadingMessage('관련 Slack 대화를 검색 중입니다...');
        const messages = await searchMessages(slackToken, fullParams, controller.signal);

        if (messages.length === 0) {
            setSummary("# 검색 결과 없음\n\n검색 조건과 일치하는 메시지를 찾을 수 없습니다. 검색어나 날짜 범위를 넓혀보세요.");
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

        setLoadingMessage('검색된 내용을 요약 중입니다...');
        const result = await summarizeDiscussions(fullParams, formattedMessages, controller.signal);
        setSummary(result);
        setExecutedSearchKeyword(searchKeyword);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('Summary generation was canceled by the user.');
            setSummary("요약 생성이 취소되었습니다.");
        } else {
            console.error("요약 생성 실패:", error);
            setSummary(`요약 생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}`);
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3">
          <img src={workspace.teamIcon} alt={workspace.name} className="h-10 w-10 rounded-md" />
          <div>
            <p className="font-semibold text-white">{workspace.name}</p>
            <p className="text-sm text-gray-400">워크스페이스 연결됨</p>
          </div>
        </div>
        <button onClick={onDisconnect} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
          연결 해제
        </button>
      </div>

      <>
        <form onSubmit={handleGenerateSummary} className="mt-8">
          <div className="space-y-6">
            <div>
              <label htmlFor="natural-query" className="block text-sm font-medium text-gray-300 mb-1">무엇을 찾고 싶으신가요?</label>
              <textarea 
                id="natural-query" 
                value={naturalQuery} 
                onChange={e => setNaturalQuery(e.target.value)} 
                className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500 min-h-[60px]" 
                placeholder="예: 지난 주에 논의했던 데이터베이스 마이그레이션 계획에 대한 내용을 찾아줘" 
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div>
                  <label htmlFor="start-date" className="block text-sm font-medium text-gray-300 mb-1">시작일</label>
                  <input type="date" id="start-date" value={searchParams.startDate} onChange={e => setSearchParams({...searchParams, startDate: e.target.value})} className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
               <div>
                  <label htmlFor="end-date" className="block text-sm font-medium text-gray-300 mb-1">종료일</label>
                  <input type="date" id="end-date" value={searchParams.endDate} onChange={e => setSearchParams({...searchParams, endDate: e.target.value})} className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-2">특정 채널로 제한 (선택 사항)</h4>
              <div className="relative mb-2">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <SearchIcon className="h-5 w-5 text-gray-400" />
                </span>
                <input
                  type="text"
                  value={channelSearchQuery}
                  onChange={e => setChannelSearchQuery(e.target.value)}
                  className="w-full bg-gray-700 border-gray-600 rounded-lg p-2 pl-10 text-white focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="채널 검색..."
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                  {channelsLoading && <p className="text-gray-400 text-sm col-span-full">채널 로딩 중...</p>}
                  {!channelsLoading && filteredChannels.length > 0 && filteredChannels.map(channel => (
                      <label key={channel.id} className="flex items-center space-x-2 text-white cursor-pointer hover:bg-gray-700 p-1 rounded-md">
                          <input type="checkbox" checked={selectedChannels.has(channel.id)} onChange={() => handleChannelToggle(channel.id)} className="rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500" />
                          <span>#{channel.name}</span>
                      </label>
                  ))}
                   {!channelsLoading && filteredChannels.length === 0 && (
                      <p className="text-gray-400 text-sm col-span-full">일치하는 채널이 없습니다.</p>
                  )}
              </div>
              <p className="text-xs text-gray-500 mt-1">채널을 선택하지 않으면 모든 공개 채널에서 검색합니다.</p>
            </div>
            <div className="flex items-center gap-4">
                <button 
                    type="submit" 
                    disabled={isLoadingSummary} 
                    className="flex-grow bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition-opacity flex items-center justify-center text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isLoadingSummary && <SpinnerIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />}
                    {isLoadingSummary ? '요약 생성 중...' : '요약 생성'}
                </button>
                {isLoadingSummary && (
                    <button 
                        type="button" 
                        onClick={handleCancel} 
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-colors flex-shrink-0"
                    >
                        취소
                    </button>
                )}
            </div>
          </div>
        </form>
        
        {(isLoadingSummary || summary) && (
          <div className="mt-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">생성된 요약</h2>
                {summary && !isLoadingSummary && (
                  <div className="flex items-center space-x-1 bg-gray-700 p-1 rounded-lg">
                    <button
                      onClick={() => setSummaryViewMode('preview')}
                      className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${summaryViewMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                    >
                      미리보기
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
                  AI가 분석한 검색어: <code className="font-mono bg-gray-700 text-indigo-300 rounded px-1.5 py-1">{executedSearchKeyword}</code>
                </div>
              )}

              <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 relative min-h-[10rem]">
                {isLoadingSummary && (
                  <div className="absolute inset-0 bg-gray-900/80 flex flex-col items-center justify-center rounded-lg">
                      <SpinnerIcon className="animate-spin h-8 w-8 text-indigo-400 mb-4" />
                      <p className="text-gray-300">{loadingMessage}</p>
                      <p className="text-gray-500 text-sm">잠시만 기다려주세요.</p>
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
};

export default Dashboard;
