/**
 * ChatPanel — 对话面板主组件
 *
 * 支持两种浏览模式:
 *   - scroll: 传统直排滚动
 *   - paged:  微信读书式左右翻页（CSS multi-column + JS 计算）
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
    const pagedColumns = useAppStore(s => s.pagedColumns);
    const togglePagedColumns = useAppStore(s => s.togglePagedColumns);
    const loading = useAppStore(s => s.loading);
    const error = useAppStore(s => s.error);
    const setActiveConversation = useAppStore(s => s.setActiveConversation);

    // 滚动模式的 refs
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevLoadingRef = useRef(loading);
    const prevStepsLenRef = useRef(steps.length);
    const isNearBottomRef = useRef(true);

    // 翻页模式的 refs & state
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [hasNewContent, setHasNewContent] = useState(false);

    // 触摸滑动
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    const isPaged = viewMode === 'paged';

    // ---- 重算分页 ----
    const recalcPages = useCallback(() => {
        const content = contentRef.current;
        const viewport = viewportRef.current;
        if (!content || !viewport || !isPaged) return;

        const w = viewport.clientWidth;
        if (w === 0) return;

        const gap = pagedColumns === 2 ? 48 : 0;
        const stride = w + gap;

        const pages = Math.max(1, Math.ceil(content.scrollWidth / stride));
        setTotalPages(pages);

        // 如果当前页超出范围，修正
        setCurrentPage(prev => Math.min(prev, pages - 1));
    }, [isPaged, pagedColumns]);

    // ---- 应用 translateX ----
    useEffect(() => {
        const content = contentRef.current;
        const viewport = viewportRef.current;
        if (!content || !viewport || !isPaged) return;

        const w = viewport.clientWidth;
        const gap = pagedColumns === 2 ? 48 : 0;
        const stride = w + gap;
        content.style.transform = `translateX(-${currentPage * stride}px)`;
    }, [currentPage, isPaged, pagedColumns]);

    // ---- 设置列宽 & 重算 ----
    const COLUMN_GAP = 48; // 双栏间距
    useEffect(() => {
        if (!isPaged) return;

        const viewport = viewportRef.current;
        const content = contentRef.current;
        if (!viewport || !content) return;

        const apply = () => {
            const w = viewport.clientWidth;
            const h = viewport.clientHeight;
            if (pagedColumns === 2) {
                const colWidth = (w - COLUMN_GAP) / 2;
                content.style.columnWidth = `${colWidth}px`;
                content.style.columnGap = `${COLUMN_GAP}px`;
            } else {
                content.style.columnWidth = `${w}px`;
                content.style.columnGap = '0px';
            }
            content.style.height = `${h}px`;
            requestAnimationFrame(recalcPages);
        };

        apply();

        const ro = new ResizeObserver(apply);
        ro.observe(viewport);
        return () => ro.disconnect();
    }, [isPaged, pagedColumns, recalcPages]);

    // ---- 内容变化时重算 ----
    useEffect(() => {
        if (!isPaged) return;
        // 给排版一帧时间
        requestAnimationFrame(() => {
            requestAnimationFrame(recalcPages);
        });
    }, [steps.length, isPaged, recalcPages, loading, pagedColumns]);

    // ---- 模式切换时重置 ----
    useEffect(() => {
        if (isPaged) {
            setCurrentPage(0);
            setHasNewContent(false);
            requestAnimationFrame(() => {
                requestAnimationFrame(recalcPages);
            });
        } else {
            // 切回滚动模式，清理 inline styles
            const content = contentRef.current;
            if (content) {
                content.style.transform = '';
                content.style.columnWidth = '';
                content.style.columnGap = '';
                content.style.height = '';
            }
        }
    }, [isPaged, recalcPages]);

    // ---- 滚动模式：监听滚动位置 ----
    useEffect(() => {
        if (isPaged) return;
        const el = contentRef.current;
        if (!el) return;

        const THRESHOLD = 150;
        const onScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = el;
            const nearBottom = scrollHeight - scrollTop - clientHeight < THRESHOLD;
            isNearBottomRef.current = nearBottom;
            if (nearBottom) {
                setHasNewContent(false);
            }
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [isPaged]);

    // ---- 滚动模式：批量加载完成，跳到底部 ----
    useLayoutEffect(() => {
        const justFinishedLoading = prevLoadingRef.current && !loading;
        prevLoadingRef.current = loading;

        if (justFinishedLoading && steps.length) {
            isNearBottomRef.current = true;
            setHasNewContent(false);
            if (!isPaged) {
                bottomRef.current?.scrollIntoView({ behavior: 'instant' });
            } else {
                // 翻页模式：加载完跳到最后一页
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        recalcPages();
                        setCurrentPage(prev => {
                            const content = contentRef.current;
                            const viewport = viewportRef.current;
                            if (!content || !viewport) return prev;
                            const w = viewport.clientWidth;
                            const gap = pagedColumns === 2 ? 48 : 0;
                            const stride = w + gap;
                            const pages = Math.max(1, Math.ceil(content.scrollWidth / stride));
                            return pages - 1;
                        });
                    });
                });
            }
        }
    }, [steps.length, loading, isPaged, recalcPages]);

    // ---- 增量推送处理 ----
    useEffect(() => {
        const prev = prevStepsLenRef.current;
        prevStepsLenRef.current = steps.length;

        if (!loading && steps.length > prev && prev > 0) {
            if (isPaged) {
                // 翻页模式：不自动跳，显示提示
                const content = contentRef.current;
                const viewport = viewportRef.current;
                if (content && viewport) {
                    const w = viewport.clientWidth;
                    const gap = pagedColumns === 2 ? 48 : 0;
                    const stride = w + gap;
                    const newTotal = Math.max(1, Math.ceil(content.scrollWidth / stride));
                    const isOnLastPage = currentPage >= newTotal - 2; // 接近最后一页
                    if (!isOnLastPage) {
                        setHasNewContent(true);
                    }
                }
            } else {
                if (isNearBottomRef.current) {
                    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                } else {
                    setHasNewContent(true);
                }
            }
        }
    }, [steps.length, loading, isPaged, currentPage]);

    // ---- 翻页操作 ----
    const goToPage = useCallback((page: number) => {
        setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
    }, [totalPages]);

    const pageLeft = useCallback(() => {
        goToPage(currentPage - 1);
    }, [currentPage, goToPage]);

    const pageRight = useCallback(() => {
        goToPage(currentPage + 1);
    }, [currentPage, goToPage]);

    const jumpToEnd = useCallback(() => {
        setCurrentPage(totalPages - 1);
        setHasNewContent(false);
    }, [totalPages]);

    // ---- 键盘翻页 ----
    useEffect(() => {
        if (!isPaged) return;

        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                case 'PageUp':
                    e.preventDefault();
                    pageLeft();
                    break;
                case 'ArrowRight':
                case 'PageDown':
                case ' ':
                    e.preventDefault();
                    pageRight();
                    break;
                case 'Home':
                    e.preventDefault();
                    goToPage(0);
                    break;
                case 'End':
                    e.preventDefault();
                    jumpToEnd();
                    break;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isPaged, pageLeft, pageRight, goToPage, jumpToEnd]);

    // ---- 触摸滑动 ----
    useEffect(() => {
        if (!isPaged) return;
        const el = viewportRef.current;
        if (!el) return;

        const SWIPE_THRESHOLD = 50;

        const onTouchStart = (e: TouchEvent) => {
            const t = e.touches[0];
            touchStartRef.current = { x: t.clientX, y: t.clientY };
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!touchStartRef.current) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartRef.current.x;
            const dy = t.clientY - touchStartRef.current.y;
            touchStartRef.current = null;

            // 只在水平滑动幅度 > 垂直时触发翻页
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
                if (dx < 0) {
                    pageRight(); // 左滑 → 下一页
                } else {
                    pageLeft();  // 右滑 → 上一页
                }
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchend', onTouchEnd);
        };
    }, [isPaged, pageLeft, pageRight]);

    const cancelConversation = useAppStore(s => s.cancelConversation);
    const isRunning = conversationStatus === 'RUNNING';

    // ---- 空对话 ----
    if (!activeConversationId) {
        return (
            <div className="chat-panel">
                <div className="chat-panel-empty">
                    <div className="empty-icon">✦</div>
                    <h2>Antigravity Chat</h2>
                    <p>选择左侧对话或创建新对话开始</p>
                </div>
                <div className="chat-panel-fade" />
                <InputBox />
            </div>
        );
    }

    // ---- 渲染 steps 列表 ----
    const stepsContent = (
        <>
            {loading && <div className="chat-loading">加载中...</div>}
            {error && (
                <div className="chat-error">
                    {error}
                    <button
                        className="header-btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => setActiveConversation(null)}
                    >
                        返回首页
                    </button>
                </div>
            )}

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
        </>
    );

    return (
        <div className="chat-panel">
            <div className="chat-panel-header">
                <span className="conversation-id">{activeConversationId.slice(0, 8)}...</span>
                <span className={`conversation-status status-${conversationStatus.toLowerCase()}`}>
                    {conversationStatus}
                </span>
                {isRunning && (
                    <button
                        className="header-btn cancel-btn"
                        onClick={cancelConversation}
                        title="终止对话"
                    >
                        ■
                    </button>
                )}
            </div>

            {isPaged ? (
                /* ====== 翻页模式 ====== */
                <div className="paged-viewport" ref={viewportRef} data-columns={pagedColumns}>
                    <div className="paged-content" ref={contentRef}>
                        {stepsContent}
                    </div>
                </div>
            ) : (
                /* ====== 滚动模式 ====== */
                <div className="chat-panel-messages" ref={contentRef}>
                    {stepsContent}
                    <div ref={bottomRef} />
                </div>
            )}

            {/* 滚动模式：新内容提示 */}
            {!isPaged && hasNewContent && (
                <button
                    className="scroll-new-content-toast"
                    onClick={() => {
                        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                        setHasNewContent(false);
                    }}
                >
                    ↓ 有新内容
                </button>
            )}

            {/* 翻页浮层 */}
            {isPaged && (
                <PagedOverlay
                    currentPage={currentPage}
                    totalPages={totalPages}
                    hasNewContent={hasNewContent}
                    columns={pagedColumns}
                    onPageLeft={pageLeft}
                    onPageRight={pageRight}
                    onJumpToEnd={jumpToEnd}
                    onToggleColumns={togglePagedColumns}
                />
            )}

            <div className="chat-panel-fade" />
            <InputBox />
        </div>
    );
}
