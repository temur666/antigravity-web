/**
 * ToolBarLayout — 工具条 + Modal 的通用布局
 *
 * 覆盖: GrepSearchStep, FindStep, ViewFileOutlineStep, ViewCodeItemStep
 */
import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    icon: string;
    action: string;
    query: string;
    path?: string;
    meta: string;
    modalTitle: string;
    children: ReactNode;
}

export function ToolBarLayout({ icon, action, query, path, meta, modalTitle, children }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <div className="step">
            <button
                className="step-tool-bar"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="tool-bar-icon">{icon}</span>
                <span className="tool-bar-content">
                    <span className="tool-bar-action">{action}</span>
                    <code className="tool-bar-query">{query}</code>
                    {path && <span className="tool-bar-path">in {path}</span>}
                </span>
                <span className="tool-bar-meta">{meta}</span>
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={modalTitle}
            >
                {children}
            </Modal>
        </div>
    );
}
