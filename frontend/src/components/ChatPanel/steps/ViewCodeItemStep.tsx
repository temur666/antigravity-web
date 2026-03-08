/**
 * ViewCodeItemStep — 代码符号查看
 */
import type { Step } from '@/types';
import { ToolBarLayout } from './layouts/ToolBarLayout';

interface Props {
    step: Step;
}

export function ViewCodeItemStep({ step }: Props) {
    const vci = step.viewCodeItem;
    if (!vci) return null;

    const filePath = vci.filePath || '';
    const fileName = filePath.split('/').pop() || '?';
    const nodes = vci.nodePaths?.join(', ') || '';
    const items = vci.items || [];

    return (
        <ToolBarLayout
            icon="&#x1F4CB;"
            action="Viewed"
            query={nodes}
            path={fileName}
            meta={`${items.length} items`}
            modalTitle={`Code: ${nodes}`}
        >
            <div className="search-results-modal">
                <div className="search-meta">
                    <span>File: <code>{filePath}</code></span>
                </div>
                {items.length > 0 ? (
                    <div className="code-items-list">
                        {items.map((item, i) => (
                            <div className="code-item" key={i}>
                                <div className="code-item-header">
                                    <span className="code-item-name">{item.nodeName}</span>
                                    <span className="code-item-type">{item.contextType}</span>
                                    <span className="code-item-range">L{item.startLine}-{item.endLine}</span>
                                </div>
                                {item.snippet && (
                                    <pre className="code-item-snippet"><code>{item.snippet}</code></pre>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="search-empty">无代码数据</div>
                )}
            </div>
        </ToolBarLayout>
    );
}
