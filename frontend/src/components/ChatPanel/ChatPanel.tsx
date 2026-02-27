/**
 * ChatPanel — 对话面板主组件
 *
 * 渲染当前对话的所有 steps + 输入框
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAppStore } from '@/store';
import { StepRenderer } from './StepRenderer';
import { InputBox } from './InputBox';

export function ChatPanel() {
    const steps = useAppStore(s => s.steps);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const debugMode = useAppStore(s => s.debugMode);
    const loading = useAppStore(s => s.loading);
    const error = useAppStore(s => s.error);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevLoadingRef = useRef(loading);

    // 批量加载完成：绘制前同步跳到底部，避免闪烁
    useLayoutEffect(() => {
        const justFinishedLoading = prevLoadingRef.current && !loading;
        prevLoadingRef.current = loading;

        if (justFinishedLoading && steps.length) {
            bottomRef.current?.scrollIntoView({ behavior: 'instant' });
        }
    }, [steps.length, loading]);

    // 增量推送：绘制后平滑滚动
    const prevStepsLenRef = useRef(steps.length);
    useEffect(() => {
        const prev = prevStepsLenRef.current;
        prevStepsLenRef.current = steps.length;

        if (!loading && steps.length > prev && prev > 0) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [steps.length, loading]);

    if (!activeConversationId) {
        return (
            <div className="chat-panel">
                <div className="chat-panel-empty">
                    <div className="empty-icon">✦</div>
                    <h2>Antigravity Chat</h2>
                    <p>选择左侧对话或创建新对话开始</p>
                </div>
                <InputBox />
            </div>
        );
    }

    return (
        <div className="chat-panel">
            <div className="chat-panel-header">
                <span className="conversation-id">{activeConversationId.slice(0, 8)}...</span>
                <span className={`conversation-status status-${conversationStatus.toLowerCase()}`}>
                    {conversationStatus}
                </span>
            </div>

            <div className="chat-panel-messages">
                {loading && <div className="chat-loading">加载中...</div>}
                {error && <div className="chat-error">{error}</div>}

                {steps.map((step, index) => (
                    <StepRenderer
                        key={`${index}-${step.type}`}
                        step={step}
                        index={index}
                        debugMode={debugMode}
                    />
                ))}

                {conversationStatus === 'RUNNING' && (
                    <div className="chat-typing">
                        <span>●</span><span>●</span><span>●</span>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            <InputBox />
        </div>
    );
}
