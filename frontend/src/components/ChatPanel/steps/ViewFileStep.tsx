/**
 * ViewFileStep — 文件查看
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { Modal } from '@/components/common/Modal/Modal';
import './ViewFileStep.css';

interface Props {
    step: Step;
}

// 获取文件后缀名对应的语言，用于简单的语法高亮标识或类名
function getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function ViewFileStep({ step }: Props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const vf = step.viewFile;
    if (!vf) return null;

    // 解析出文件名 (处理 filePath 可能未定义的情况)
    const filePath = vf.filePath || 'Unknown File';
    const filename = filePath.split('/').pop() || filePath;
    const extension = getFileExtension(filename);

    const lineRange = vf.startLine && vf.endLine
        ? `#L${vf.startLine}-${vf.endLine}`
        : '';

    // 渲染带有颜色后缀的文件名
    const renderFilename = () => {
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
    };

    return (
        <div className="step step-view-file">
            <button
                className="step-view-file-pill"
                onClick={() => setIsModalOpen(true)}
            >
                <span className="pill-action">Analyzed</span>
                <span className="pill-filename">
                    {renderFilename()}
                </span>
                {lineRange && <span className="pill-lines">{lineRange}</span>}
            </button>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={`${filePath} ${lineRange}`}
            >
                {vf.content ? (
                    <pre className="view-file-code">
                        <code className={extension ? `language-${extension}` : ''}>
                            {vf.content}
                        </code>
                    </pre>
                ) : (
                    <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '40px 0' }}>
                        无文件内容
                    </div>
                )}
            </Modal>
        </div>
    );
}
