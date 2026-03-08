/**
 * ViewFileStep — 文件查看
 */
import type { Step } from '@/types';
import { FilePillLayout } from './layouts/FilePillLayout';

interface Props {
    step: Step;
}

export function ViewFileStep({ step }: Props) {
    const vf = step.viewFile;
    if (!vf) return null;

    const filePath = vf.filePath || 'Unknown File';
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const lineRange = vf.startLine && vf.endLine ? `#L${vf.startLine}-${vf.endLine}` : '';

    return (
        <FilePillLayout
            action="Analyzed"
            filePath={filePath}
            extra={lineRange ? <span className="pill-lines">{lineRange}</span> : undefined}
            modalTitle={`${filePath} ${lineRange}`}
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
        </FilePillLayout>
    );
}
