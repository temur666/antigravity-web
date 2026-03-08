/**
 * CommandStatusStep — 命令输出
 */
import type { Step } from '@/types';
import { CompactLayout } from './layouts/CompactLayout';

interface Props {
    step: Step;
}

export function CommandStatusStep({ step }: Props) {
    const cs = step.commandStatus;
    if (!cs) return null;

    const exitOk = cs.exitCode === 0 || cs.exitCode === undefined;
    const output = cs.combined || cs.delta || '';
    const label = <>
        {exitOk ? '✅' : '❌'} 命令输出
        {cs.exitCode !== undefined && ` (exit: ${cs.exitCode})`}
    </>;

    return (
        <CompactLayout
            label={label}
            className={`step-command-status ${exitOk ? '' : 'error'}`}
        >
            {output && <pre className="step-output">{output}</pre>}
        </CompactLayout>
    );
}
