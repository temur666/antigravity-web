/**
 * FindStep — 文件查找结果展示
 */
import type { Step } from '@/types';
import { ToolBarLayout } from './layouts/ToolBarLayout';

interface Props {
    step: Step;
}

export function FindStep({ step }: Props) {
    const fd = step.find;
    if (!fd) return null;

    const pattern = fd.pattern || '?';
    const dir = fd.searchDirectory || '';
    const shortDir = dir.split('/').pop() || dir;
    const total = fd.totalResults ?? 0;

    return (
        <ToolBarLayout
            icon="&#x1F4C2;"
            action="Find"
            query={pattern}
            path={shortDir}
            meta={`${total} results`}
            modalTitle={`Find: ${pattern}`}
        >
            <div className="search-results-modal">
                <div className="search-meta">
                    <span>Directory: <code>{dir}</code></span>
                    <span>{total} files</span>
                </div>
                <div className="search-empty">文件列表详情暂未返回</div>
            </div>
        </ToolBarLayout>
    );
}
