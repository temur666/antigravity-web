/**
 * CodeActionStep — 代码编辑
 */
import type { Step } from '@/types';
import { FilePillLayout } from './layouts/FilePillLayout';

interface Props {
    step: Step;
}

export function CodeActionStep({ step }: Props) {
    const ca = step.codeAction;
    if (!ca) return null;

    const filePath = ca.filePath || '';

    return (
        <FilePillLayout
            action="Edited"
            filePath={filePath}
            description={ca.description}
            modalTitle={filePath || 'Code Edit'}
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
        </FilePillLayout>
    );
}
