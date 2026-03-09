/**
 * SystemStep — 系统消息 (多种隐藏类型的通用组件)
 *
 * 覆盖:
 *   - EPHEMERAL_MESSAGE
 *   - CONVERSATION_HISTORY
 *   - KNOWLEDGE_ARTIFACTS
 *   - TASK_BOUNDARY
 *   - CODE_ACKNOWLEDGEMENT
 */
import type { Step } from '@/types';
import { getStepShortType } from '@/types';
import { CompactLayout } from './layouts/CompactLayout';

interface Props {
    step: Step;
}

const STEP_ICONS: Record<string, string> = {
    EPHEMERAL_MESSAGE: '💬',
    CONVERSATION_HISTORY: '📚',
    TASK_BOUNDARY: '🔲',
    KNOWLEDGE_GENERATION: '🧠',
};

export function SystemStep({ step }: Props) {
    const shortType = getStepShortType(step.type);
    const icon = STEP_ICONS[shortType] ?? '⚙️';

    const content =
        step.ephemeralMessage?.content ??
        step.conversationHistory?.content ??
        step.taskBoundary?.content ??
        null;

    return (
        <CompactLayout
            label={<>{icon} {shortType.replace(/_/g, ' ').toLowerCase()}</>}
            className="step-system"
            compactClassName="system"
        >
            {content
                ? <pre className="step-system-content">{content}</pre>
                : <div className="step-system-content empty">（无内容）</div>
            }
        </CompactLayout>
    );
}
