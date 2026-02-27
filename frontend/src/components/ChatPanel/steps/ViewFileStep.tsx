/**
 * ViewFileStep — 文件查看
 */
import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ViewFileStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const vf = step.viewFile;
    if (!vf) return null;

    const lineRange = vf.startLine && vf.endLine
        ? ` (L${vf.startLine}-${vf.endLine})`
        : '';

    return (
        <div className="step step-view-file">
            <button className="step-compact" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>📄 查看文件: {vf.filePath}{lineRange}</span>
            </button>
            {expanded && vf.content && (
                <pre className="step-file-content">{vf.content}</pre>
            )}
        </div>
    );
}
