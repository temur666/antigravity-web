/**
 * ChatPanel — 对话面板主组件
 *
 * 支持两种浏览模式:
 *   - scroll: 传统直排滚动（默认）
 *   - paged:  翻页模式，scroll-snap + 键盘/按钮翻页
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import { StepRenderer } from './StepRenderer';
import { InputBox } from './InputBox';
import { PagedOverlay } from './PagedOverlay';

export function ChatPanel() {
    const steps = useAppStore(s => s.steps);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const debugMode = useAppStore(s => s.debugMode);
    const viewMode = useAppStore(s => s.viewMode);
    const loading = useAppStore(s => s.loading);
    const error = useAppStore(s => s.error);

    const messagesRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevLoadingRef = useRef(loading);

    // 翻页状态（local state，纯 UI）
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [hasNewContent, setHasNewContent] = useState(false);
    const prevStepsLenRef = useRef(steps.length);

    // ---- 计算页码 ----
    const updatePageInfo = useCallback(() => {
        const el = messagesRef.current;
        if (!el || viewMode !== 'paged') return;

        const containerHeight = el.clientHeight;
        if (containerHeight === 0) return;

        const scrollableHeight = el.scrollHeight - containerHeight;
        const pages = Math.max(1, Math.ceil(scrollableHeight / containerHeight) + 1);
        const page = scrollableHeight > 0
            ? Math.min(pages, Math.round(el.scrollTop / containerHeight) + 1)
            : 1;

        setTotalPages(pages);
        setCurrentPage(page);
    }, [viewMode]);

    // ---- scroll 监听 → 更新页码 ----
    useEffect(() => {
        const el = messagesRef.current;
        if (!el || viewMode !== 'paged') return;

        const onScroll = () => {
            updatePageInfo();
            // 如果滚到底部了，清除"有新内容"提示
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            if (atBottom) setHasNewContent(false);
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [viewMode, updatePageInfo]);

    // ---- 内容变化时重算页码 ----
    useEffect(() => {
        updatePageInfo();
    }, [steps.length, viewMode, updatePageInfo]);

    // ---- 批量加载完成：绘制前同步跳到底部 ----
    useLayoutEffect(() => {
        const justFinishedLoading = prevLoadingRef.current && !loading;
        prevLoadingRef.current = loading;

        if (justFinishedLoading && steps.length) {
            bottomRef.current?.scrollIntoView({ behavior: 'instant' });
        }
    }, [steps.length, loading]);

    // ---- 增量推送处理 ----
    useEffect(() => {
        const prev = prevStepsLenRef.current;
        prevStepsLenRef.current = steps.length;

        if (!loading && steps.length > prev && prev > 0) {
            if (viewMode === 'paged') {
                // 翻页模式：不自动滚动，检查是否在最后一页
                const el = messagesRef.current;
                if (el) {
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
                    if (!atBottom) {
                        setHasNewContent(true);
                    } else {
                        // 已在底部，静默滚动到最底
                        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
                    }
                }
            } else {
                // 滚动模式：平滑滚到底部
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [steps.length, loading, viewMode]);

    // ---- 翻页操作 ----
    const pageUp = useCallback(() => {
        const el = messagesRef.current;
        if (!el) return;
        el.scrollBy({ top: -el.clientHeight, behavior: 'smooth' });
    }, []);

    const pageDown = useCallback(() => {
        const el = messagesRef.current;
        if (!el) return;
        el.scrollBy({ top: el.clientHeight, behavior: 'smooth' });
    }, []);

    const jumpToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        setHasNewContent(false);
    }, []);

    // ---- 键盘翻页 ----
    useEffect(() => {
        if (viewMode !== 'paged') return;

        const onKeyDown = (e: KeyboardEvent) => {
            // 如果焦点在输入框中，不拦截
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            switch (e.key) {
                case 'PageUp':
                case 'ArrowUp':
                    e.preventDefault();
                    pageUp();
                    break;
                case 'PageDown':
                case 'ArrowDown':
                case ' ':
                    e.preventDefault();
                    pageDown();
                    break;
                case 'Home':
                    e.preventDefault();
                    messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    break;
                case 'End':
                    e.preventDefault();
                    jumpToBottom();
                    break;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [viewMode, pageUp, pageDown, jumpToBottom]);

    // ---- 模式切换时重置状态 ----
    useEffect(() => {
        setHasNewContent(false);
        if (viewMode === 'paged') {
            // 切换到翻页模式时，计算一次页码
            requestAnimationFrame(updatePageInfo);
        }
    }, [viewMode, updatePageInfo]);

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

    const isPaged = viewMode === 'paged';
    const messagesClass = `chat-panel-messages${isPaged ? ' paged' : ''}`;

    return (
        <div className="chat-panel">
            <div className="chat-panel-header">
                <span className="conversation-id">{activeConversationId.slice(0, 8)}...</span>
                <span className={`conversation-status status-${conversationStatus.toLowerCase()}`}>
                    {conversationStatus}
                </span>
            </div>

            <div className={messagesClass} ref={messagesRef}>
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

            {/* 翻页模式浮层 */}
            {isPaged && (
                <PagedOverlay
                    currentPage={currentPage}
                    totalPages={totalPages}
                    hasNewContent={hasNewContent}
                    onPageUp={pageUp}
                    onPageDown={pageDown}
                    onJumpToBottom={jumpToBottom}
                />
            )}

            <InputBox />
        </div>
    );
}
