import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const em = step.errorMessage;
    if (!em) return null;

    const err = em.error;

    // 折叠标题: 优先用 shortError 做摘要
    const summary = err?.shortError || em.message || 'Unknown error';

    return (
        <div className={`thinking-block variant-error ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>Error: {summary}</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    {err ? (
                        <>
                            {err.userErrorMessage && <pre>{err.userErrorMessage}</pre>}
                            {err.modelErrorMessage && <pre>{err.modelErrorMessage}</pre>}
                            {err.fullError && <pre>{err.fullError}</pre>}
                        </>
                    ) : (
                        <pre>{em.message ?? 'Unknown error'}</pre>
                    )}
                </div>
            )}
        </div>
    );
}
