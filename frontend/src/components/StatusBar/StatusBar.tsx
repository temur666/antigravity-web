/**
 * StatusBar — LS 连接状态 + 账号信息 + Debug 开关
 */
import { useAppStore } from '@/store';

export function StatusBar() {
    const lsConnected = useAppStore(s => s.lsConnected);
    const lsInfo = useAppStore(s => s.lsInfo);
    const account = useAppStore(s => s.account);
    const debugMode = useAppStore(s => s.debugMode);
    const toggleDebugMode = useAppStore(s => s.toggleDebugMode);

    return (
        <div className="status-bar">
            {/* LS 状态 */}
            <div className={`status-indicator ${lsConnected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" />
                <span>
                    {lsConnected
                        ? `LS 已连接 (Port:${lsInfo?.port})`
                        : 'LS 未连接'}
                </span>
            </div>

            {/* 账号 */}
            {account && (
                <div className="status-account">
                    {account.email} · {account.tier}
                </div>
            )}

            {/* Debug 开关 */}
            <button
                className={`status-debug-btn ${debugMode ? 'active' : ''}`}
                onClick={toggleDebugMode}
                title="切换 Debug 模式显示隐藏步骤"
            >
                🐛 Debug {debugMode ? 'ON' : 'OFF'}
            </button>
        </div>
    );
}
