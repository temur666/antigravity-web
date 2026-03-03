/**
 * PagedOverlay — 翻页模式浮层（左右翻页）
 *
 * 底部居中：左翻 | 页码 | 右翻
 * + "有新内容" 提示
 */
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';

interface Props {
    currentPage: number;
    totalPages: number;
    hasNewContent: boolean;
    onPageLeft: () => void;
    onPageRight: () => void;
    onJumpToEnd: () => void;
}

export function PagedOverlay({
    currentPage,
    totalPages,
    hasNewContent,
    onPageLeft,
    onPageRight,
    onJumpToEnd,
}: Props) {
    return (
        <div className="paged-overlay">
            {/* 翻页控件 */}
            <div className="paged-controls">
                <button
                    className="paged-btn"
                    onClick={onPageLeft}
                    disabled={currentPage <= 0}
                    title="上一页 (←)"
                >
                    <ChevronLeft size={18} />
                </button>

                <span className="paged-indicator">
                    {currentPage + 1} / {totalPages}
                </span>

                <button
                    className="paged-btn"
                    onClick={onPageRight}
                    disabled={currentPage >= totalPages - 1}
                    title="下一页 (→)"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* 有新内容提示 */}
            {hasNewContent && (
                <button className="new-content-toast" onClick={onJumpToEnd}>
                    <span>有新内容</span>
                    <ArrowRight size={14} />
                </button>
            )}
        </div>
    );
}
