/**
 * CommandStatusStep — 命令输出
 */
import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function CommandStatusStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const cs = step.commandStatus;
    if (!cs) return null;

    const exitOk = cs.exitCode === 0 || cs.exitCode === undefined;

    return (
        <div className={`step step-command-status ${exitOk ? '' : 'error'}`}>
            <button className="step-compact" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>
                    {exitOk ? '✅' : '❌'} 命令输出
                    {cs.exitCode !== undefined && ` (exit: ${cs.exitCode})`}
                </span>
            </button>
            {expanded && cs.output && (
                <pre className="step-output">{cs.output}</pre>
            )}
        </div>
    );
}
