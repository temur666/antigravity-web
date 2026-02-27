/**
 * ListDirectoryStep — 目录列表
 */
import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ListDirectoryStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const ld = step.listDirectory;
    if (!ld) return null;

    return (
        <div className="step step-list-directory">
            <button className="step-compact" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>📂 目录: {ld.path ?? '未知路径'}</span>
            </button>
            {expanded && ld.entries && (
                <ul className="step-dir-entries">
                    {ld.entries.map((entry, i) => (
                        <li key={i} className={entry.isDir ? 'dir' : 'file'}>
                            {entry.isDir ? '📁 ' : '📄 '}
                            {entry.name}
                            {entry.size !== undefined && !entry.isDir && ` (${entry.size}B)`}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
