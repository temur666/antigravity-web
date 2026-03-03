/**
 * CodeActionStep -- 代码编辑
 *
 * pill 样式：✏ Edited filename.ext
 * 点击弹出 Modal 查看 description + diff
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';

interface Props {
    step: Step;
}

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

export function CodeActionStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const ca = step.codeAction;
    if (!ca) return null;

    const filePath = ca.filePath || '';
    const filename = filePath.split('/').pop() || filePath || '?';

    return (
        <div className="step step-code-action">
            <button
                className="step-view-file-pill"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="pill-action">Edited</span>
                <span className="pill-filename">
                    {renderFilename(filename)}
                </span>
            </button>

            {ca.description && <div className="step-description">{ca.description}</div>}

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={filePath || 'Code Edit'}
            >
                <div className="code-action-modal">
                    {ca.description && (
                        <div className="code-action-desc">{ca.description}</div>
                    )}
                    {ca.diff ? (
                        <pre className="code-action-diff"><code>{ca.diff}</code></pre>
                    ) : (
                        <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '40px 0' }}>
                            无 diff 数据
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
}

