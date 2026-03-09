import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function ErrorMessageStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const em = step.errorMessage;
    if (!em) return null;

    // 根据内容是否包含容量问题决定标题
    const isCapacityError = em.message?.includes('capacity') || em.message?.includes('503');
    const title = isCapacityError ? '模型调度延迟或服务不可用' : '执行遇到错误';

    return (
        <div className={`thinking-block variant-error ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>⚠️ {em.code ? `[${em.code}] ` : ''}{title}</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '12px', color: '#fbbf24', marginBottom: '12px', whiteSpace: 'pre-wrap' }}>
                        {em.message ?? '未知错误'}
                    </pre>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="step-compact" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.3)' }}>降级至轻量模型</button>
                        <button className="step-compact" style={{ background: 'rgba(255, 255, 255, 0.05)' }}>立即重试</button>
                    </div>
                </div>
            )}
        </div>
    );
}
