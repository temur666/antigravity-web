/**
 * CodeActionStep — 代码编辑 diff
 */
import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function CodeActionStep({ step }: Props) {
    const [expanded, setExpanded] = useState(true);
    const ca = step.codeAction;
    if (!ca) return null;

    return (
        <div className="step step-code-action">
            <button className="step-compact" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>✏️ 编辑文件: {ca.filePath ?? '未知文件'}</span>
            </button>
            {ca.description && <div className="step-description">{ca.description}</div>}
            {expanded && ca.diff && (
                <pre className="step-diff">{ca.diff}</pre>
            )}
        </div>
    );
}
