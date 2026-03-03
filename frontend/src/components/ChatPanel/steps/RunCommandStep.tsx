/**
 * RunCommandStep — 终端命令（含输出）
 */
import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function RunCommandStep({ step }: Props) {
    const [showOutput, setShowOutput] = useState(false);
    const rc = step.runCommand;
    if (!rc) return null;

    // LS 真实字段: commandLine / proposedCommandLine / cwd
    const cmdText = rc.commandLine || rc.command || '';
    const cwd = rc.cwd || '';
    const output = rc.combinedOutput?.full || '';
    const exitCode = rc.exitCode;
    const exitOk = exitCode === 0 || exitCode === undefined;

    // waitMsBeforeAsync 可能是 string 或 number
    const waitMs = typeof rc.waitMsBeforeAsync === 'string'
        ? parseInt(rc.waitMsBeforeAsync, 10)
        : rc.waitMsBeforeAsync;

    return (
        <div className="step step-run-command">
            <div className="terminal-card">
                <div className="terminal-card-header">
                    <div className="terminal-card-title">
                        <span className="terminal-icon">&gt;_</span>
                        {cwd || 'LOCAL SHELL'}
                    </div>
                    <div className="terminal-card-meta">
                        {rc.shouldAutoRun === true && (
                            <span className="terminal-badge terminal-badge-auto">AutoRun</span>
                        )}
                        {typeof waitMs === 'number' && !isNaN(waitMs) && (
                            <span className="terminal-badge terminal-badge-wait">
                                Wait: {waitMs >= 1000 ? `${waitMs / 1000}s` : `${waitMs}ms`}
                            </span>
                        )}
                        {exitCode !== undefined && (
                            <span className={`terminal-badge ${exitOk ? 'terminal-badge-ok' : 'terminal-badge-fail'}`}>
                                exit: {exitCode}
                            </span>
                        )}
                    </div>
                </div>
                <div className="terminal-card-body">
                    <div className="terminal-prompt">$</div>
                    <pre className="terminal-command">{cmdText}</pre>
                </div>
                {/* 命令输出 */}
                {output && (
                    <>
                        <button
                            className="terminal-output-toggle"
                            onClick={() => setShowOutput(!showOutput)}
                        >
                            <span>{showOutput ? '▼' : '▶'}</span>
                            <span>OUTPUT</span>
                        </button>
                        {showOutput && (
                            <pre className="terminal-output">{output}</pre>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

