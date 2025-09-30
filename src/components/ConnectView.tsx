import React, { useState, useEffect } from 'react';
import { SpinnerIcon } from './icons/SpinnerIcon';

interface ConnectViewProps {
  onConnect: (token: string) => Promise<void>;
  initialError?: string | null;
}

const RequiredPermission: React.FC<{ scope: string; description: string }> = ({ scope, description }) => (
  <li className="flex items-start space-x-3">
    <svg className="h-6 w-6 text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
    <div>
      <code className="font-mono text-sm bg-gray-700/50 text-indigo-300 rounded px-1 py-0.5">{scope}</code>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  </li>
);

const ConnectView: React.FC<ConnectViewProps> = ({ onConnect, initialError }) => {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken.startsWith('xoxp-') && !trimmedToken.startsWith('xoxb-')) {
        setError("유효한 Slack 사용자('xoxp-') 또는 봇('xoxb-') 토큰을 입력해주세요.");
        return;
    }
    setIsLoading(true);
    setError(null);
    // The parent component (App.tsx) will handle the connection logic
    // and subsequent state changes (including unmounting this component).
    await onConnect(trimmedToken);
    
    // This part might not be reached if the component unmounts quickly,
    // but it's good practice to handle the local loading state.
    setIsLoading(false);
  };

  return (
    <div className="text-center flex flex-col items-center">
      <h2 className="text-2xl font-bold text-white mb-4">Slack 워크스페이스 연결</h2>
      <p className="text-gray-400 mb-6 max-w-2xl">
        시작하려면 Slack 사용자(xoxp-) 또는 봇(xoxb-) OAuth 토큰을 제공해주세요. 이 토큰은 요약 생성을 위해 공개 채널 메시지에 안전하게 접근하는 데 사용됩니다. 토큰은 현재 세션에만 사용되며 저희 서버에 저장되지 않습니다.
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-lg mb-8">
        <div className="flex flex-col space-y-4">
            <div>
                <label htmlFor="slack-token" className="sr-only">Slack 사용자 또는 봇 토큰</label>
                <input
                    id="slack-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full bg-gray-900 border-gray-600 rounded-lg p-3 text-white focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                    placeholder="여기에 'xoxp-' 또는 'xoxb-'로 시작하는 토큰을 붙여넣으세요"
                    disabled={isLoading}
                />
            </div>
            <button
                type="submit"
                disabled={isLoading || !token}
                className="inline-flex items-center justify-center bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isLoading && <SpinnerIcon className="animate-spin -ml-1 mr-3 h-5 w-5" />}
                {isLoading ? '연결 중...' : 'Slack에 연결'}
            </button>
            {error && <p className="text-red-400 mt-2 text-sm">{error}</p>}
        </div>
      </form>
      
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 w-full max-w-lg mb-8 text-left">
          <h3 className="text-lg font-semibold text-white mb-4">필요한 권한</h3>
          <p className="text-sm text-gray-400 mb-4">토큰에 다음 스코프가 포함되어 있는지 확인하세요:</p>
          <ul className="space-y-4">
              <RequiredPermission scope="search:read" description="키워드를 기반으로 공개 채널에서 메시지를 검색합니다." />
              <RequiredPermission scope="channels:history" description="선택한 특정 공개 채널의 메시지를 읽습니다." />
              <RequiredPermission scope="channels:read" description="선택을 위해 워크스페이스의 공개 채널 목록을 가져옵니다." />
              <RequiredPermission scope="team:read" description="워크스페이스의 이름, 아이콘 등 기본 정보를 가져옵니다." />
          </ul>
          <p className="text-xs text-gray-500 mt-4">참고: 사용자 ID를 이름에 매핑하기 위해 <code className="font-mono text-xs bg-gray-700/50 text-indigo-300 rounded px-1">users:read</code> 스코프도 권장되지만, 기본 기능에 필수는 아닙니다.</p>
      </div>
    </div>
  );
};

export default ConnectView;
