/**
 * ViewCodeItemStep — 代码符号查看
 *
 * 全宽条形：📋 Viewed  functionName  in file.ts
 * 点击弹出 Modal 查看代码片段
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    step: Step;
}

export function ViewCodeItemStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const vci = step.viewCodeItem;
    if (!vci) return null;

    const filePath = vci.filePath || '';
    const fileName = filePath.split('/').pop() || '?';
    const nodes = vci.nodePaths?.join(', ') || '';
    const items = vci.items || [];

    return (
        <div className="step">
            <button
                className="step-tool-bar"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="tool-bar-icon">&#x1F4CB;</span>
                <span className="tool-bar-content">
                    <span className="tool-bar-action">Viewed</span>
                    <code className="tool-bar-query">{nodes}</code>
                    <span className="tool-bar-path">in {fileName}</span>
                </span>
                <span className="tool-bar-meta">{items.length} items</span>
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`Code: ${nodes}`}
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
            </Modal>
        </div>
    );
}
