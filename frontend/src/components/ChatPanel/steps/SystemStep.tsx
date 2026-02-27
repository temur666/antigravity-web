/**
 * SystemStep — 系统消息 (4种隐藏类型的通用组件)
 *
 * 覆盖:
 *   - EPHEMERAL_MESSAGE
 *   - CONVERSATION_HISTORY
 *   - KNOWLEDGE_ARTIFACTS
 *   - TASK_BOUNDARY
 */
import { useState } from 'react';
import type { Step } from '@/types';
import { getStepShortType } from '@/types';

interface Props {
    step: Step;
}

const STEP_ICONS: Record<string, string> = {
    EPHEMERAL_MESSAGE: '💬',
    CONVERSATION_HISTORY: '📚',
    KNOWLEDGE_ARTIFACTS: '🧠',
    TASK_BOUNDARY: '🔲',
};

export function SystemStep({ step }: Props) {
    const [expanded, setExpanded] = useState(false);
    const shortType = getStepShortType(step.type);
    const icon = STEP_ICONS[shortType] ?? '⚙️';

    // 从不同 payload 提取 content
    const content =
        step.ephemeralMessage?.content ??
        step.conversationHistory?.content ??
        step.knowledgeArtifacts?.content ??
        step.taskBoundary?.content ??
        null;

    return (
        <div className="step step-system">
            <button className="step-compact system" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span>{icon} {shortType.replace(/_/g, ' ').toLowerCase()}</span>
            </button>
            {expanded && content && (
                <pre className="step-system-content">{content}</pre>
            )}
            {expanded && !content && (
                <div className="step-system-content empty">（无内容）</div>
            )}
        </div>
    );
}
