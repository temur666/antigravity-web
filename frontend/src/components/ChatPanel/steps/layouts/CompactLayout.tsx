/**
 * CompactLayout — 折叠/展开的通用布局
 *
 * 覆盖: CommandStatusStep, ListDirectoryStep, SystemStep
 */
import { useState, type ReactNode } from 'react';

interface Props {
    label: ReactNode;
    className?: string;
    /** step-compact 按钮的额外 className，如 "system" */
    compactClassName?: string;
    children: ReactNode;
}

export function CompactLayout({ label, className, compactClassName, children }: Props) {
    const [expanded, setExpanded] = useState(false);

    const compactCls = ['step-compact', compactClassName].filter(Boolean).join(' ');

    return (
        <div className={`step ${className || ''}`}>
            <button className={compactCls} onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>{label}</span>
            </button>
            {expanded && children}
        </div>
    );
}
