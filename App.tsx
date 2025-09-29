import React, { useState, useCallback } from 'react';
import Dashboard from './components/Dashboard';
import ConnectView from './components/ConnectView';
import { Workspace } from './types';
import { SlackIcon } from './components/icons/SlackIcon';
import { NotionIcon } from './components/icons/NotionIcon';
import { verifyToken } from './services/slackService';

const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [slackToken, setSlackToken] = useState<string | null>(null);

  const handleConnect = useCallback(async (token: string) => {
    const workspaceInfo = await verifyToken(token);
    setWorkspace(workspaceInfo);
    setSlackToken(token);
  }, []);

  const handleDisconnect = useCallback(() => {
    setWorkspace(null);
    setSlackToken(null);
  }, []);

  const renderContent = () => {
    if (workspace && slackToken) {
      return <Dashboard workspace={workspace} slackToken={slackToken} onDisconnect={handleDisconnect} />;
    }
    return <ConnectView onConnect={handleConnect} />;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <header className="w-full max-w-7xl flex items-center justify-center mb-8">
        <div className="flex items-center space-x-4">
          <SlackIcon className="h-10 w-10" />
          <div className="text-4xl font-thin text-gray-500 mx-2">+</div>
          <NotionIcon className="h-10 w-10" />
        </div>
      </header>
      <main className="w-full max-w-4xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-500">
            Slack 대화 요약기
          </h1>
          <p className="text-lg text-gray-400">
            흩어진 Slack 스레드를 AI로 체계적인 Notion 문서로 변환하세요.
          </p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl shadow-indigo-500/10 p-6 sm:p-8">
          {renderContent()}
        </div>
      </main>
      <footer className="w-full max-w-4xl text-center mt-12 text-gray-500 text-sm">
        <p>Cinnamon Inc.의 생산성 향상을 위해 제작되었습니다.</p>
        <p>&copy; 2024. 모든 권리 보유.</p>
      </footer>
    </div>
  );
};

export default App;