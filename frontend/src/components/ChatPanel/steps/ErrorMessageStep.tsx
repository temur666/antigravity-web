import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const em = step.errorMessage;
    if (!em) return null;

    // API 原始结构: errorMessage.error.{ userErrorMessage, shortError, fullError }
    const err = em.error;
    const shortLabel = err?.shortError || em.message || 'Error';
    const userMsg = err?.userErrorMessage;
    const fullErr = err?.fullError;

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
                    {userMsg && <pre>{userMsg}</pre>}
                    <pre>{shortLabel}</pre>
                    {fullErr && <pre>{fullErr}</pre>}
                </div>
            )}
        </div>
    );
}

