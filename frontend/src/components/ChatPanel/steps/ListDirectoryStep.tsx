/**
 * ListDirectoryStep — 目录列表
 */
import type { Step } from '@/types';
import { CompactLayout } from './layouts/CompactLayout';

interface Props {
    step: Step;
}

export function ListDirectoryStep({ step }: Props) {
    const ld = step.listDirectory;
    if (!ld) return null;

    return (
        <CompactLayout
            label={<>📂 目录: {ld.path ?? '未知路径'}</>}
            className="step-list-directory"
        >
            {ld.entries && (
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
        </CompactLayout>
    );
}
