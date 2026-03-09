import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const em = step.errorMessage;
    if (!em) return null;

    const msg = em.error?.userErrorMessage || em.message || 'Unknown error';

    return (
        <div className={`thinking-block variant-error ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>Error</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    <pre>{msg}</pre>
                </div>
            )}
        </div>
    );
}
