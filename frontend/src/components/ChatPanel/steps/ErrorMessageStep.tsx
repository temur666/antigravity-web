/**
 * ErrorMessageStep — 错误信息
 */
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const em = step.errorMessage;
    if (!em) return null;

    return (
        <div className="step step-error-message">
            <div className="step-label">❌ 错误</div>
            {em.code && <div className="step-error-code">[{em.code}]</div>}
            <div className="step-content error">{em.message ?? '未知错误'}</div>
        </div>
    );
}
