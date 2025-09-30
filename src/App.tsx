import React, { useState, useCallback, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import { Workspace } from './types';
import { SlackIcon } from './components/icons/SlackIcon';
import { NotionIcon } from './components/icons/NotionIcon';
import { verifyToken } from './services/slackService';
import { ConnectionState } from './types';

const SLACK_TOKEN = process.env.SLACK_TOKEN;

const REQUIRED_SCOPES = ['search:read', 'channels:history', 'channels:read', 'team:read'];

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isLoading: true,
    workspace: null,
    error: null,
    hasAllPermissions: false,
  });

  useEffect(() => {
    const connectToSlack = async () => {
      if (!SLACK_TOKEN || (!SLACK_TOKEN.startsWith('xoxp-') && !SLACK_TOKEN.startsWith('xoxb-'))) {
        setConnectionState({
          isLoading: false,
          workspace: null,
          error: "A valid Slack token was not found in Vercel environment variables (VITE_SLACK_TOKEN). Please check your deployment settings.",
          hasAllPermissions: false,
        });
        return;
      }

      try {
        const workspaceInfo = await verifyToken(SLACK_TOKEN);
        const userScopes = new Set(workspaceInfo.scopes);
        const hasAll = REQUIRED_SCOPES.every(scope => userScopes.has(scope));

        setConnectionState({
          isLoading: false,
          workspace: workspaceInfo,
          error: null,
          hasAllPermissions: hasAll,
        });
      } catch (err) {
        setConnectionState({
          isLoading: false,
          workspace: null,
          error: err instanceof Error ? err.message : 'An unknown error occurred during connection.',
          hasAllPermissions: false,
        });
      }
    };

    connectToSlack();
  }, []);

  const handleRetry = useCallback(() => {
    // A simple page reload is sufficient to retry the connection.
    window.location.reload();
  }, []);

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
            Slack Conversation Summarizer
          </h1>
          <p className="text-lg text-gray-400">
            Turn scattered Slack threads into organized Notion documents with AI.
          </p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl shadow-indigo-500/10 p-6 sm:p-8">
          <Dashboard
            connectionState={connectionState}
            onRetry={handleRetry}
            slackToken={SLACK_TOKEN}
          />
        </div>
      </main>
      <footer className="w-full max-w-4xl text-center mt-12 text-gray-500 text-sm">
        <p>Built for productivity at Cinnamon Inc.</p>
        <p>&copy; 2024. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;