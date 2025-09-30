import React from 'react';
import { Workspace } from '../types';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';

interface PermissionsViewProps {
  workspace: Workspace;
  onBack: () => void;
  requiredScopes: string[];
}

const scopeDescriptions: Record<string, string> = {
    'search:read': '키워드를 기반으로 공개 채널에서 메시지를 검색합니다.',
    'channels:history': '선택한 특정 공개 채널의 메시지를 읽습니다.',
    'channels:read': '선택을 위해 워크스페이스의 공개 채널 목록을 가져옵니다.',
    'team:read': '워크스페이스의 이름, 아이콘 등 기본 정보를 가져옵니다.',
};

const PermissionsView: React.FC<PermissionsViewProps> = ({ workspace, onBack, requiredScopes }) => {
    const userScopes = new Set(workspace.scopes);
    return (
        <div className="text-center flex flex-col items-center">
            <div className="flex items-center space-x-3 mb-4">
                <img src={workspace.teamIcon} alt={workspace.name} className="h-10 w-10 rounded-md" />
                <div>
                    <p className="font-semibold text-white text-left">{workspace.name}</p>
                    <p className="text-sm text-gray-400 text-left">워크스페이스 연결됨</p>
                </div>
            </div>

            <h2 className="text-2xl font-bold text-red-400 mb-3">권한 부족</h2>
            <p className="text-gray-300 mb-6 max-w-2xl">
                제공된 토큰에 일부 필수 권한이 누락되었습니다. 앱이 올바르게 작동하려면 아래의 모든 필수 권한이 부여된 새 토큰을 생성해야 합니다.
            </p>

             <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-6 text-left mb-8">
                  <div>
                      <h3 className="text-lg font-semibold text-white mb-4">필수 권한 상태</h3>
                      <ul className="space-y-3">
                          {requiredScopes.map(scope => (
                               <li className="flex items-start space-x-4 p-3 bg-gray-700/50 rounded-lg" key={scope}>
                                  <div className="mt-1">
                                      {userScopes.has(scope) ? (
                                          <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0" />
                                      ) : (
                                          <XCircleIcon className="h-5 w-5 text-red-400 flex-shrink-0" />
                                      )}
                                  </div>
                                  <div>
                                      <code className="font-mono text-sm bg-gray-600 text-indigo-300 rounded px-1.5 py-0.5">{scope}</code>
                                      <p className="text-gray-400 text-xs mt-1">{scopeDescriptions[scope] || '필수 권한입니다.'}</p>
                                  </div>
                              </li>
                          ))}
                      </ul>
                  </div>
                   <div>
                      <h3 className="text-lg font-semibold text-white mb-4">현재 토큰 권한</h3>
                      {workspace.scopes.length > 0 ? (
                        <div className="bg-gray-700/50 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                           {workspace.scopes.map(scope => (
                              <code key={scope} className="font-mono text-sm bg-gray-600 text-indigo-300 rounded px-1.5 py-0.5 block truncate">{scope}</code>
                           ))}
                        </div>
                      ) : (
                        <div className="bg-red-900/50 border border-red-400/50 rounded-lg p-4 text-center h-full flex flex-col justify-center">
                           <p className="font-semibold text-red-300">감지된 권한 없음</p>
                           <p className="text-xs text-red-300/80 mt-1">토큰이 유효하지 않거나 CORS 프록시 문제일 수 있습니다.</p>
                        </div>
                      )}
                  </div>
              </div>
            
            <button
                onClick={onBack}
                className="inline-flex items-center justify-center bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors text-lg"
            >
                다른 토큰으로 재시도
            </button>
        </div>
    );
};

export default PermissionsView;
