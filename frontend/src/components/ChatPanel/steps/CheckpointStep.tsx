import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function CheckpointStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const cp = step.checkpoint;
    if (!cp) return null;

    const intent = cp.userIntent as string | undefined;
    const session = cp.sessionSummary as string | undefined;
    const codeChange = cp.codeChangeSummary as string | undefined;
    const hasContent = intent || session || codeChange;

    return (
        <div className={`thinking-block variant-checkpoint ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>Checkpoint</span>
            </button>
            {expanded && hasContent && (
                <div className="thinking-content">
                    {intent && <pre>{intent}</pre>}
                    {session && <pre>{session}</pre>}
                    {codeChange && <pre>{codeChange}</pre>}
                </div>
            )}
        </div>
    );
}
