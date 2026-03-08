/**
 * ViewFileOutlineStep — 文件大纲展示
 */
import type { Step } from '@/types';
import { ToolBarLayout } from './layouts/ToolBarLayout';

interface Props {
    step: Step;
}

export function ViewFileOutlineStep({ step }: Props) {
    const vfo = step.viewFileOutline;
    if (!vfo) return null;

    const filePath = vfo.filePath || '?';
    const fileName = filePath.split('/').pop() || filePath;
    const itemCount = vfo.outlineItems?.length ?? 0;

    return (
        <ToolBarLayout
            icon="&#x1F4CB;"
            action="Outline"
            query={fileName}
            meta={`${itemCount} items`}
            modalTitle={`Outline: ${fileName}`}
        >
            <div className="search-results-modal">
                <div className="search-meta">
                    <span>File: <code>{filePath}</code></span>
                    {vfo.numLines != null && <span>{vfo.numLines} lines</span>}
                </div>
                {vfo.outlineItems && vfo.outlineItems.length > 0 ? (
                    <div className="search-results-list">
                        {vfo.outlineItems.map((item, i) => (
                            <div className="search-result-item" key={i}>
                                <pre className="result-content">
                                    {JSON.stringify(item, null, 2)}
                                </pre>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="search-empty">无大纲数据</div>
                )}
            </div>
        </ToolBarLayout>
    );
}
