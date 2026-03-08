/**
 * GrepSearchStep — 搜索结果展示
 */
import type { Step } from '@/types';
import { ToolBarLayout } from './layouts/ToolBarLayout';

interface Props {
    step: Step;
}

export function GrepSearchStep({ step }: Props) {
    const gs = step.grepSearch;
    if (!gs) return null;

    const query = gs.query || '?';
    const searchPath = gs.searchPath || '';
    const shortPath = searchPath.split('/').pop() || searchPath;
    const total = gs.totalResults ?? gs.results?.length ?? 0;

    return (
        <ToolBarLayout
            icon="&#x1F50D;"
            action="Searched"
            query={query}
            path={shortPath}
            meta={`${total} results`}
            modalTitle={`Search: ${query}`}
        >
            <div className="search-results-modal">
                <div className="search-meta">
                    <span>Path: <code>{searchPath}</code></span>
                    <span>{total} matches</span>
                </div>
                {gs.results && gs.results.length > 0 ? (
                    <div className="search-results-list">
                        {gs.results.map((r, i) => (
                            <div className="search-result-item" key={i}>
                                <span className="result-file">{r.file || '?'}</span>
                                <span className="result-line">:{r.lineNumber}</span>
                                <pre className="result-content">{r.lineContent}</pre>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="search-empty">无匹配结果</div>
                )}
            </div>
        </ToolBarLayout>
    );
}
