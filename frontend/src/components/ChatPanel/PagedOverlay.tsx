/**
 * PagedOverlay — 翻页模式浮层
 *
 * 显示：
 *   - 上翻 / 下翻按钮
 *   - 当前页码 "3 / 12"
 *   - "有新内容" 提示条（当不在底部时出现新 step）
 */
import { ChevronUp, ChevronDown, ArrowDown } from 'lucide-react';

interface Props {
    currentPage: number;
    totalPages: number;
    hasNewContent: boolean;
    onPageUp: () => void;
    onPageDown: () => void;
    onJumpToBottom: () => void;
}

export function PagedOverlay({
    currentPage,
    totalPages,
    hasNewContent,
    onPageUp,
    onPageDown,
    onJumpToBottom,
}: Props) {
    return (
        <div className="paged-overlay">
            {/* 翻页控件 */}
            <div className="paged-controls">
                <button
                    className="paged-btn"
                    onClick={onPageUp}
                    disabled={currentPage <= 1}
                    title="上一页 (PageUp)"
                >
                    <ChevronUp size={18} />
                </button>

                <span className="paged-indicator">
                    {currentPage} / {totalPages}
                </span>

                <button
                    className="paged-btn"
                    onClick={onPageDown}
                    disabled={currentPage >= totalPages}
                    title="下一页 (PageDown)"
                >
                    <ChevronDown size={18} />
                </button>
            </div>

            {/* 有新内容提示 */}
            {hasNewContent && (
                <button className="new-content-toast" onClick={onJumpToBottom}>
                    <ArrowDown size={14} />
                    <span>有新内容</span>
                </button>
            )}
        </div>
    );
}
