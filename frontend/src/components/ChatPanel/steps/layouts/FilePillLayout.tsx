/**
 * FilePillLayout — 文件 Pill 按钮 + Modal 的通用布局
 *
 * 覆盖: ViewFileStep, CodeActionStep
 * 内置 renderFilename（扩展名着色）
 */
import './FilePillLayout.css';
import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    action: string;
    filePath: string;
    extra?: ReactNode;
    description?: string;
    modalTitle: string;
    children: ReactNode;
}

/** 渲染带有颜色后缀的文件名 */
function renderFilename(filename: string) {
    const parts = filename.split('.');
    if (parts.length > 1) {
        const ext = parts.pop()!;
        const base = parts.join('.');
        return (
            <>
                {base}.<span className={`ext pill-ext-${ext.toLowerCase()}`}>{ext}</span>
            </>
        );
    }
    return filename;
}

export function FilePillLayout({ action, filePath, extra, description, modalTitle, children }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const filename = filePath.split('/').pop() || filePath || '?';

    return (
        <div className="step">
            <button
                className="step-view-file-pill"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="pill-action">{action}</span>
                <span className="pill-filename">
                    {renderFilename(filename)}
                </span>
                {extra}
            </button>

            {description && <div className="step-description">{description}</div>}

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
