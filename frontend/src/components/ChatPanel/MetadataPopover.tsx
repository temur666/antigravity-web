/**
 * MetadataPopover — 对话元数据弹出层
 *
 * 显示最新一轮 LLM 调用的 token 数据 + 连接状态。
 * 由 ChatPanel header 中的按钮触发。
 */
import './MetadataPopover.css';
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
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const conversationStatus = useAppStore(s => s.conversationStatus);


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

    // 累加所有轮次的 token（每轮都包含完整对话历史，token 是累积的）
    const cumulativeStats = useMemo(() => {
        if (!metadata || metadata.length === 0) return null;
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let lastModel = '';
        let lastTtftMs = 0;
        let lastStreamingMs = 0;
        let lastContextTokensUsed = 0;

        for (const gm of metadata) {
            const usage = gm.chatModel?.usage;
            if (!usage) continue;
            inputTokens += safeInt(usage.inputTokens);
            outputTokens += safeInt(usage.outputTokens);
            cacheReadTokens += safeInt(usage.cacheReadTokens);
            lastModel = usage.model || gm.chatModel?.model || lastModel;
            lastTtftMs = parseDurationMs(gm.chatModel?.timeToFirstToken) || lastTtftMs;
            lastStreamingMs = parseDurationMs(gm.chatModel?.streamingDuration) || lastStreamingMs;
            lastContextTokensUsed = gm.chatModel?.chatStartMetadata?.contextWindowMetadata?.estimatedTokensUsed ?? lastContextTokensUsed;
        }

        return { inputTokens, outputTokens, cacheReadTokens, model: lastModel, ttftMs: lastTtftMs, streamingMs: lastStreamingMs, contextTokensUsed: lastContextTokensUsed };
    }, [metadata]);

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
                    {activeConversationId && (
                        <>
                            <div className="metadata-grid">
                                <div className="metadata-item metadata-item-full">
                                    <span className="metadata-label">对话 ID</span>
                                    <span className="metadata-value" style={{ fontSize: 11 }}>{activeConversationId}</span>
                                </div>
                                <div className="metadata-item">
                                    <span className="metadata-label">状态</span>
                                    <span className="metadata-value">{conversationStatus}</span>
                                </div>
                            </div>
                            <div className="metadata-divider" />
                        </>
                    )}

                    <div className="metadata-popover-title">对话统计</div>

                    {!cumulativeStats ? (
                        <div className="metadata-empty">暂无数据</div>
                    ) : (
                        <div className="metadata-grid">
                            <div className="metadata-item metadata-item-full">
                                <span className="metadata-label">模型</span>
                                <span className="metadata-value metadata-models">
                                    {resolveModelName(cumulativeStats.model)}
                                </span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Input</span>
                                <span className="metadata-value">{formatTokenCount(cumulativeStats.inputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Output</span>
                                <span className="metadata-value">{formatTokenCount(cumulativeStats.outputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Cache Read</span>
                                <span className="metadata-value">{formatTokenCount(cumulativeStats.cacheReadTokens)}</span>
                            </div>
                            {cumulativeStats.contextTokensUsed > 0 && (
                                <div className="metadata-item">
                                    <span className="metadata-label">Context</span>
                                    <span className="metadata-value">{formatTokenCount(cumulativeStats.contextTokensUsed)}</span>
                                </div>
                            )}
                            <div className="metadata-item">
                                <span className="metadata-label">TTFT (最新)</span>
                                <span className="metadata-value">{formatDuration(cumulativeStats.ttftMs)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Stream (最新)</span>
                                <span className="metadata-value">{formatDuration(cumulativeStats.streamingMs)}</span>
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
