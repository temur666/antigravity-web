/**
 * PagedOverlay — 翻页模式浮层（左右翻页 + 单双栏切换）
 *
 * 底部居中：左翻 | 页码 | 右翻 | 栏数切换
 * + "有新内容" 提示
 */
import { ChevronLeft, ChevronRight, ArrowRight, Columns2, Square } from 'lucide-react';

interface Props {
    currentPage: number;
    totalPages: number;
    hasNewContent: boolean;
    columns: 1 | 2;
    onPageLeft: () => void;
    onPageRight: () => void;
    onJumpToEnd: () => void;
    onToggleColumns: () => void;
}

export function PagedOverlay({
    currentPage,
    totalPages,
    hasNewContent,
    columns,
    onPageLeft,
    onPageRight,
    onJumpToEnd,
    onToggleColumns,
}: Props) {
    return (
        <div className="paged-overlay">
            {/* 有新内容提示 */}
            {hasNewContent && (
                <button className="new-content-toast" onClick={onJumpToEnd}>
                    <span>有新内容</span>
                    <ArrowRight size={14} />
                </button>
            )}

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

                <span className="paged-divider" />

                <button
                    className={`paged-btn ${columns === 2 ? 'active' : ''}`}
                    onClick={onToggleColumns}
                    title={columns === 1 ? '切换双栏' : '切换单栏'}
                >
                    {columns === 1 ? <Columns2 size={16} /> : <Square size={16} />}
                </button>
            </div>
        </div>
    );
}
