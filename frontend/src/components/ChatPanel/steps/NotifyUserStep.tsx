/**
 * NotifyUserStep — 用户通知
 */
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function NotifyUserStep({ step }: Props) {
    const nu = step.notifyUser;
    if (!nu) return null;

    return (
        <div className="step step-notify-user">
            <div className="step-label">🔔 通知</div>
            <div className="step-content">{nu.message ?? '（无消息）'}</div>
        </div>
    );
}
