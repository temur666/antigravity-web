/**
 * GrepSearchStep — 搜索结果展示
 *
 * 全宽条形设计：🔍 Searched "query" in path    N results
 * 点击弹出 Modal 查看详细匹配结果
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    step: Step;
}

export function GrepSearchStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const gs = step.grepSearch;
    if (!gs) return null;

    const query = gs.query || '?';
    const searchPath = gs.searchPath || '';
    const shortPath = searchPath.split('/').pop() || searchPath;
    const total = gs.totalResults ?? gs.results?.length ?? 0;

    return (
        <div className="step">
            <button
                className="step-tool-bar"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="tool-bar-icon">&#x1F50D;</span>
                <span className="tool-bar-content">
                    <span className="tool-bar-action">Searched</span>
                    <code className="tool-bar-query">{query}</code>
                    {shortPath && <span className="tool-bar-path">in {shortPath}</span>}
                </span>
                <span className="tool-bar-meta">{total} results</span>
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`Search: ${query}`}
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
            </Modal>
        </div>
    );
}
