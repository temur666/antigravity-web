/**
 * MetadataPopover — 对话元数据弹出层
 *
 * 显示最新一轮 LLM 调用的 token 数据 + 连接状态。
 * 由 ChatPanel header 中的按钮触发。
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store';
import { formatTokenCount, formatDuration, shortenModelLabel } from '@/utils/metadata';

/** 从 metadata 数组提取最新一轮的 usage */
function safeInt(val?: string | number): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseInt(val, 10) || 0;
    return 0;
}

function parseDurationMs(duration?: string): number {
    if (!duration) return 0;
    const match = duration.match(/^([\d.]+)s$/);
    return match ? Math.round(parseFloat(match[1]) * 1000) : 0;
}

export function MetadataPopover() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const metadata = useAppStore(s => s.metadata);
    const storeModels = useAppStore(s => s.models);
    const lsConnected = useAppStore(s => s.lsConnected);
    const lsInfo = useAppStore(s => s.lsInfo);
    const account = useAppStore(s => s.account);
    const debugMode = useAppStore(s => s.debugMode);
    const toggleDebugMode = useAppStore(s => s.toggleDebugMode);

    // 最新一轮 LLM 调用的数据
    const latestCall = useMemo(() => {
        if (!metadata || metadata.length === 0) return null;
        // 从后往前找到第一个有 chatModel.usage 的条目
        for (let i = metadata.length - 1; i >= 0; i--) {
            if (metadata[i].chatModel?.usage) return metadata[i];
        }
        return null;
    }, [metadata]);

    const totalCalls = useMemo(() => {
        if (!metadata) return 0;
        return metadata.filter(gm => gm.chatModel?.usage).length;
    }, [metadata]);

    // 模型名映射
    const resolveModelName = (rawModel: string): string => {
        const info = storeModels.find(m => m.model === rawModel);
        return info ? shortenModelLabel(info.label) : rawModel;
    };

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // 提取最新调用数据
    const usage = latestCall?.chatModel?.usage;
    const inputTokens = safeInt(usage?.inputTokens);
    const outputTokens = safeInt(usage?.outputTokens);
    const cacheReadTokens = safeInt(usage?.cacheReadTokens);
    const model = usage?.model || latestCall?.chatModel?.model || '';
    const ttftMs = parseDurationMs(latestCall?.chatModel?.timeToFirstToken);
    const streamingMs = parseDurationMs(latestCall?.chatModel?.streamingDuration);
    const contextTokensUsed = latestCall?.chatModel?.chatStartMetadata?.contextWindowMetadata?.estimatedTokensUsed ?? 0;

    return (
        <div className="metadata-popover-anchor" ref={ref}>
            <button
                className="header-btn metadata-btn"
                onClick={() => setOpen(!open)}
                title="对话元数据"
            >
                &#123;&#125;
            </button>

            {open && (
                <div className="metadata-popover">
                    <div className="metadata-popover-title">最新一轮调用</div>

                    {!latestCall ? (
                        <div className="metadata-empty">暂无数据</div>
                    ) : (
                        <div className="metadata-grid">
                            <div className="metadata-item metadata-item-full">
                                <span className="metadata-label">模型</span>
                                <span className="metadata-value metadata-models">
                                    {resolveModelName(model)}
                                </span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Input</span>
                                <span className="metadata-value">{formatTokenCount(inputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Output</span>
                                <span className="metadata-value">{formatTokenCount(outputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Cache Read</span>
                                <span className="metadata-value">{formatTokenCount(cacheReadTokens)}</span>
                            </div>
                            {contextTokensUsed > 0 && (
                                <div className="metadata-item">
                                    <span className="metadata-label">Context</span>
                                    <span className="metadata-value">{formatTokenCount(contextTokensUsed)}</span>
                                </div>
                            )}
                            <div className="metadata-item">
                                <span className="metadata-label">TTFT</span>
                                <span className="metadata-value">{formatDuration(ttftMs)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Stream</span>
                                <span className="metadata-value">{formatDuration(streamingMs)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">总调用</span>
                                <span className="metadata-value">{totalCalls} 次</span>
                            </div>
                        </div>
                    )}

                    <div className="metadata-divider"></div>

                    <div className="metadata-status-section">
                        <div className={`status-indicator ${lsConnected ? 'connected' : 'disconnected'}`}>
                            <span className="status-dot" />
                            <span>
                                {lsConnected
                                    ? `LS 已连接 (Port:${lsInfo?.port})`
                                    : 'LS 未连接'}
                            </span>
                        </div>
                        {account && (
                            <div className="status-account">
                                {account.email} · {account.tier}
                            </div>
                        )}
                        <button
                            className={`status-debug-btn ${debugMode ? 'active' : ''}`}
                            onClick={toggleDebugMode}
                            title="切换 Debug 模式显示隐藏步骤"
                        >
                            Debug {debugMode ? 'ON' : 'OFF'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
