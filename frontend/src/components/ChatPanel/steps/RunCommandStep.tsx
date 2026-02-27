/**
 * RunCommandStep — 终端命令
 */
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function RunCommandStep({ step }: Props) {
    const rc = step.runCommand;
    if (!rc) return null;

    return (
        <div className="step step-run-command">
            <div className="step-label">💻 执行命令</div>
            {rc.cwd && <div className="step-cwd">📁 {rc.cwd}</div>}
            <pre className="step-command">{rc.command}</pre>
        </div>
    );
}
