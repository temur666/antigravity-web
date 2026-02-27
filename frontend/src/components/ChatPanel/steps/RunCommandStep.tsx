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

    // 兼容不同的命令属性名 (解决空黑框问题)
    const cmdText = rc.command || (rc as Record<string, unknown>).commandLine as string || (rc as Record<string, unknown>).CommandLine as string || '';

    return (
        <div className="step step-run-command">
            <div className="terminal-card">
                <div className="terminal-card-header">
                    <div className="terminal-card-title">
                        <span className="terminal-icon">›_</span>
                        Local Shell
                    </div>
                    {rc.cwd && <div className="terminal-card-cwd" title={rc.cwd}>CWD: {rc.cwd}</div>}
                </div>
                <div className="terminal-card-body">
                    <div className="terminal-prompt">$</div>
                    <pre className="terminal-command">{cmdText}</pre>
                </div>
            </div>
        </div>
    );
}
