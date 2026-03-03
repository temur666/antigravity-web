/**
 * FindStep — 文件查找结果展示
 *
 * 全宽条形设计：📂 Find "pattern"    N results
 * 点击弹出 Modal 查看详情
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    step: Step;
}

export function FindStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const fd = step.find;
    if (!fd) return null;

    const pattern = fd.pattern || '?';
    const dir = fd.searchDirectory || '';
    const shortDir = dir.split('/').pop() || dir;
    const total = fd.totalResults ?? 0;

    return (
        <div className="step">
            <button
                className="step-tool-bar"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="tool-bar-icon">&#x1F4C2;</span>
                <span className="tool-bar-content">
                    <span className="tool-bar-action">Find</span>
                    <code className="tool-bar-query">{pattern}</code>
                    {shortDir && <span className="tool-bar-path">in {shortDir}</span>}
                </span>
                <span className="tool-bar-meta">{total} results</span>
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`Find: ${pattern}`}
            >
                <div className="search-results-modal">
                    <div className="search-meta">
                        <span>Directory: <code>{dir}</code></span>
                        <span>{total} files</span>
                    </div>
                    <div className="search-empty">文件列表详情暂未返回</div>
                </div>
            </Modal>
        </div>
    );
}
