import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const em = step.errorMessage;
    if (!em) return null;

    const title = em.code ? `[${em.code}] 错误` : '错误';

    return (
        <div className={`thinking-block variant-error ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>{title}</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    <pre>{em.message ?? '未知错误'}</pre>
                </div>
            )}
        </div>
    );
}

