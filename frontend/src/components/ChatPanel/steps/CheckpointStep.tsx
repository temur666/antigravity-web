import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function CheckpointStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const cp = step.checkpoint;
    if (!cp) return null;

    return (
        <div className={`thinking-block variant-checkpoint ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>🏁 检查点：状态挂起</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    {cp.userIntent && <div style={{ fontSize: '13px', color: '#e4e4e7', marginBottom: '12px' }}>{cp.userIntent}</div>}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="step-compact" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', borderColor: 'rgba(99, 102, 241, 0.3)' }}>注入锦囊并继续</button>
                        <button className="step-compact" style={{ background: 'rgba(255, 255, 255, 0.05)' }}>继续执行</button>
                    </div>
                </div>
            )}
        </div>
    );
}
