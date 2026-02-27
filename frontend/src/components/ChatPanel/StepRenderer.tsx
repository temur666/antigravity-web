/**
 * StepRenderer — 根据 step.type 分发到对应组件
 *
 * 这是纯粹的 type → component 映射，无业务逻辑。
 */
import type { Step } from '@/types';
import { isHiddenStep, getStepShortType } from '@/types';
import {
    UserInputStep,
    PlannerResponseStep,
    ViewFileStep,
    CodeActionStep,
    RunCommandStep,
    CommandStatusStep,
    ListDirectoryStep,
    NotifyUserStep,
    ErrorMessageStep,
    CheckpointStep,
    SearchWebStep,
    SystemStep,
} from './steps';

interface Props {
    step: Step;
    index: number;
    debugMode: boolean;
}

export function StepRenderer({ step, index, debugMode }: Props) {
    // 隐藏的 step 类型：非 debug 模式下不渲染
    if (isHiddenStep(step) && !debugMode) {
        return null;
    }

    return (
        <div className="step-wrapper" data-step-index={index} data-step-type={step.type}>
            {renderStep(step)}
        </div>
    );
}

function renderStep(step: Step) {
    switch (step.type) {
        case 'CORTEX_STEP_TYPE_USER_INPUT':
            return <UserInputStep step={step} />;
        case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
            return <PlannerResponseStep step={step} />;
        case 'CORTEX_STEP_TYPE_VIEW_FILE':
            return <ViewFileStep step={step} />;
        case 'CORTEX_STEP_TYPE_CODE_ACTION':
            return <CodeActionStep step={step} />;
        case 'CORTEX_STEP_TYPE_RUN_COMMAND':
            return <RunCommandStep step={step} />;
        case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
            return <CommandStatusStep step={step} />;
        case 'CORTEX_STEP_TYPE_LIST_DIRECTORY':
            return <ListDirectoryStep step={step} />;
        case 'CORTEX_STEP_TYPE_NOTIFY_USER':
            return <NotifyUserStep step={step} />;
        case 'CORTEX_STEP_TYPE_ERROR_MESSAGE':
            return <ErrorMessageStep step={step} />;
        case 'CORTEX_STEP_TYPE_CHECKPOINT':
            return <CheckpointStep step={step} />;
        case 'CORTEX_STEP_TYPE_SEARCH_WEB':
            return <SearchWebStep step={step} />;
        // 4 种系统消息 → 通用 SystemStep
        case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':
        case 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY':
        case 'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS':
        case 'CORTEX_STEP_TYPE_TASK_BOUNDARY':
            return <SystemStep step={step} />;
        default:
            return (
                <div className="step step-unknown">
                    <div className="step-label">⚠️ 未知类型: {getStepShortType(step.type)}</div>
                    <pre>{JSON.stringify(step, null, 2)}</pre>
                </div>
            );
    }
}
