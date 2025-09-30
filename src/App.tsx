/// <reference types="vite/client" />
import React, { useState, useCallback, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import ConnectView from './components/ConnectView';
import PermissionsView from './components/PermissionsView';
import { Workspace } from './types';
import { SlackIcon } from './components/icons/SlackIcon';
import { NotionIcon } from './components/icons/NotionIcon';
import { verifyToken } from './services/slackService';
import { SpinnerIcon } from './components/icons/SpinnerIcon';

const ENV_SLACK_TOKEN = import.meta.env.VITE_SLACK_TOKEN;
const REQUIRED_SCOPES = ['search:read', 'channels:history', 'channels:read', 'team:read'];

const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [slackToken, setSlackToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [hasAllPermissions, setHasAllPermissions] = useState(false);

  const handleConnect = useCallback(async (token: string) => {
    setIsLoading(true);
    setConnectionError(null);
    setWorkspace(null);
    setSlackToken(null);
    setHasAllPermissions(false);

    try {
      const workspaceInfo = await verifyToken(token);
      const userScopes = new Set(workspaceInfo.scopes);
      const allPermissionsMet = REQUIRED_SCOPES.every(scope => userScopes.has(scope));

      setWorkspace(workspaceInfo);
      setSlackToken(token);
      setHasAllPermissions(allPermissionsMet);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '연결 중 알 수 없는 오류가 발생했습니다.';
      setConnectionError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Attempt to connect with environment variable token on initial load
  useEffect(() => {
    if (ENV_SLACK_TOKEN && (!ENV_SLACK_TOKEN.startsWith('xoxp-') && !ENV_SLACK_TOKEN.startsWith('xoxb-'))) {
        setConnectionError("Vercel 환경 변수(VITE_SLACK_TOKEN)에 유효하지 않은 Slack 토큰이 설정되어 있습니다.");
        setIsLoading(false);
        return;
    }

    if (ENV_SLACK_TOKEN) {
      handleConnect(ENV_SLACK_TOKEN);
    } else {
      setIsLoading(false); // No token, just show connect view
    }
  }, [handleConnect]);


  const handleDisconnect = useCallback(() => {
    setWorkspace(null);
    setSlackToken(null);
    setConnectionError(null);
    setHasAllPermissions(false);
  }, []);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px]">
          <SpinnerIcon className="animate-spin h-10 w-10 text-indigo-400 mb-4" />
          <p className="text-gray-300">Slack 워크스페이스에 연결 중입니다...</p>
        </div>
      );
    }

    if (workspace && slackToken) {
      if (hasAllPermissions) {
        return <Dashboard workspace={workspace} slackToken={slackToken} onDisconnect={handleDisconnect} />;
      } else {
        return <PermissionsView workspace={workspace} onBack={handleDisconnect} requiredScopes={REQUIRED_SCOPES} />;
      }
    }

    return <ConnectView onConnect={handleConnect} initialError={connectionError} />;
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