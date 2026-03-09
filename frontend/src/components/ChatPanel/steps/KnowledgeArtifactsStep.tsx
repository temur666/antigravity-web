import { useState } from 'react';
import type { Step } from '@/types';

interface Props {
    step: Step;
}

export function KnowledgeArtifactsStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const content = step.knowledgeArtifacts?.content;
    if (!content) return null;

    return (
        <div className={`thinking-block variant-knowledge ${expanded ? 'expanded' : ''}`}>
            <button
                className="thinking-toggle"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="thinking-chevron">{expanded ? '▼' : '▶'}</span>
                <span>💡 提炼新知识</span>
            </button>
            {expanded && (
                <div className="thinking-content">
                    <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '12px', color: '#34d399', marginBottom: '12px', whiteSpace: 'pre-wrap' }}>
                        {content}
                    </pre>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="step-compact" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>✅ 一键归档</button>
                    </div>
                </div>
            )}
        </div>
    );
}
