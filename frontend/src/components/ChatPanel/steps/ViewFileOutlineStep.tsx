/**
 * ViewFileOutlineStep — 文件大纲展示
 *
 * 全宽条形设计：📋 Outline filename    N items
 * 点击弹出 Modal 查看大纲详情
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    step: Step;
}

export function ViewFileOutlineStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const vfo = step.viewFileOutline;
    if (!vfo) return null;

    const filePath = vfo.filePath || '?';
    const fileName = filePath.split('/').pop() || filePath;
    const itemCount = vfo.outlineItems?.length ?? 0;

    return (
        <div className="step">
            <button
                className="step-tool-bar"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="tool-bar-icon">&#x1F4CB;</span>
                <span className="tool-bar-content">
                    <span className="tool-bar-action">Outline</span>
                    <code className="tool-bar-query">{fileName}</code>
                </span>
                <span className="tool-bar-meta">{itemCount} items</span>
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`Outline: ${fileName}`}
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
            </Modal>
        </div>
    );
}
