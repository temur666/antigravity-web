/**
 * MetadataPopover — 对话级元数据弹出层
 *
 * 显示当前对话的 token 消耗汇总、模型列表、平均 TTFT 等。
 * 由 ChatPanel header 中的按钮触发。
 */
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store';
import { buildConversationUsageSummary, formatTokenCount, formatDuration, shortenModelLabel } from '@/utils/metadata';

export function MetadataPopover() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const metadata = useAppStore(s => s.metadata);
    const storeModels = useAppStore(s => s.models);
    const steps = useAppStore(s => s.steps);

    const summary = buildConversationUsageSummary(metadata);
    const hasData = summary.totalCalls > 0;

    // 轮次: USER_INPUT step 的数量
    const turnCount = steps.filter(s => s.type === 'CORTEX_STEP_TYPE_USER_INPUT').length;

    // 模型名映射: 用 store.models 查找 label，再缩短
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
                    <div className="metadata-popover-title">对话元数据</div>

                    {!hasData ? (
                        <div className="metadata-empty">暂无数据</div>
                    ) : (
                        <div className="metadata-grid">
                            <div className="metadata-item">
                                <span className="metadata-label">轮次</span>
                                <span className="metadata-value">{turnCount}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">模型调用</span>
                                <span className="metadata-value">{summary.totalCalls} 次</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Input Tokens</span>
                                <span className="metadata-value">{formatTokenCount(summary.totalInputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Output Tokens</span>
                                <span className="metadata-value">{formatTokenCount(summary.totalOutputTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Cache Read</span>
                                <span className="metadata-value">{formatTokenCount(summary.totalCacheReadTokens)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">平均 TTFT</span>
                                <span className="metadata-value">{formatDuration(summary.avgTtftMs)}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">总生成时间</span>
                                <span className="metadata-value">{formatDuration(summary.totalStreamingMs)}</span>
                            </div>
                            {summary.models.length > 0 && (
                                <div className="metadata-item metadata-item-full">
                                    <span className="metadata-label">使用模型</span>
                                    <span className="metadata-value metadata-models">
                                        {summary.models.map(m => resolveModelName(m)).join(', ')}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

