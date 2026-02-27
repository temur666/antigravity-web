/**
 * UserInputStep — 用户消息
 */
import type { Step } from '@/types';
import { getUserInputText } from '@/types';

interface Props {
    step: Step;
}

export function UserInputStep({ step }: Props) {
    const text = getUserInputText(step);
    return (
        <div className="step step-user-input">
            <div className="step-label">👤 用户</div>
            <div className="step-content user-message">{text}</div>
        </div>
    );
}
