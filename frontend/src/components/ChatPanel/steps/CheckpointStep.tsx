/**
 * CheckpointStep — 检查点
 */
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function CheckpointStep({ step }: Props) {
    const cp = step.checkpoint;
    if (!cp) return null;

    return (
        <div className="step step-checkpoint">
            <div className="step-label">🏁 检查点</div>
            {cp.userIntent && <div className="step-content">{cp.userIntent}</div>}
        </div>
    );
}
