/**
 * Step 类型定义
 *
 * 前端需要根据 step.type 渲染不同 UI。
 * 每种 step 类型有不同的 payload 字段。
 */

// ========== Step 状态 ==========

export type StepStatus =
    | 'CORTEX_STEP_STATUS_UNSPECIFIED'
    | 'CORTEX_STEP_STATUS_PENDING'
    | 'CORTEX_STEP_STATUS_GENERATING'
    | 'CORTEX_STEP_STATUS_DONE'
    | 'CORTEX_STEP_STATUS_ERROR';

// ========== Step 类型枚举 ==========

export type StepType =
    | 'CORTEX_STEP_TYPE_USER_INPUT'
    | 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
    | 'CORTEX_STEP_TYPE_VIEW_FILE'
    | 'CORTEX_STEP_TYPE_CODE_ACTION'
    | 'CORTEX_STEP_TYPE_RUN_COMMAND'
    | 'CORTEX_STEP_TYPE_COMMAND_STATUS'
    | 'CORTEX_STEP_TYPE_LIST_DIRECTORY'
    | 'CORTEX_STEP_TYPE_NOTIFY_USER'
    | 'CORTEX_STEP_TYPE_ERROR_MESSAGE'
    | 'CORTEX_STEP_TYPE_CHECKPOINT'
    | 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE'
    | 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY'
    | 'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS'
    | 'CORTEX_STEP_TYPE_TASK_BOUNDARY'
    | 'CORTEX_STEP_TYPE_SEARCH_WEB';

// ========== 隐藏的 Step 类型 ==========

export const HIDDEN_STEP_TYPES: StepType[] = [
    'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE',
    'CORTEX_STEP_TYPE_CONVERSATION_HISTORY',
    'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS',
    'CORTEX_STEP_TYPE_TASK_BOUNDARY',
];

// ========== Step Payload 类型 ==========

export interface UserInputPayload {
    items: Array<{ text?: string;[key: string]: unknown }>;
}

export interface ToolCall {
    name: string;
    argumentsJson: string;
    result?: string;
    [key: string]: unknown;
}

export interface PlannerResponsePayload {
    thinking?: string;
    response?: string;
    toolCalls?: ToolCall[];
    [key: string]: unknown;
}

export interface ViewFilePayload {
    filePath?: string;
    content?: string;
    startLine?: number;
    endLine?: number;
    [key: string]: unknown;
}

export interface CodeActionPayload {
    filePath?: string;
    diff?: string;
    description?: string;
    [key: string]: unknown;
}

export interface RunCommandPayload {
    command?: string;
    cwd?: string;
    [key: string]: unknown;
}

export interface CommandStatusPayload {
    output?: string;
    exitCode?: number;
    commandId?: string;
    [key: string]: unknown;
}

export interface ListDirectoryPayload {
    path?: string;
    entries?: Array<{ name: string; isDir: boolean; size?: number }>;
    [key: string]: unknown;
}

export interface NotifyUserPayload {
    message?: string;
    [key: string]: unknown;
}

export interface ErrorMessagePayload {
    message?: string;
    code?: string;
    [key: string]: unknown;
}

export interface CheckpointPayload {
    userIntent?: string;
    [key: string]: unknown;
}

export interface EphemeralMessagePayload {
    content?: string;
    [key: string]: unknown;
}

export interface ConversationHistoryPayload {
    content?: string;
    [key: string]: unknown;
}

export interface KnowledgeArtifactsPayload {
    content?: string;
    [key: string]: unknown;
}

export interface TaskBoundaryPayload {
    content?: string;
    [key: string]: unknown;
}

export interface SearchWebPayload {
    query?: string;
    results?: Array<{ title: string; url: string; snippet?: string }>;
    [key: string]: unknown;
}

// ========== Step 主类型 ==========

export interface Step {
    type: StepType;
    status: StepStatus;
    userInput?: UserInputPayload;
    plannerResponse?: PlannerResponsePayload;
    viewFile?: ViewFilePayload;
    codeAction?: CodeActionPayload;
    runCommand?: RunCommandPayload;
    commandStatus?: CommandStatusPayload;
    listDirectory?: ListDirectoryPayload;
    notifyUser?: NotifyUserPayload;
    errorMessage?: ErrorMessagePayload;
    checkpoint?: CheckpointPayload;
    ephemeralMessage?: EphemeralMessagePayload;
    conversationHistory?: ConversationHistoryPayload;
    knowledgeArtifacts?: KnowledgeArtifactsPayload;
    taskBoundary?: TaskBoundaryPayload;
    searchWeb?: SearchWebPayload;
}

// ========== 工具函数 ==========

/**
 * 从 Step type 枚举获取短名 (去掉 CORTEX_STEP_TYPE_ 前缀)
 */
export function getStepShortType(type: StepType): string {
    return type.replace('CORTEX_STEP_TYPE_', '');
}

/**
 * 判断 Step 是否属于隐藏类型
 */
export function isHiddenStep(step: Step): boolean {
    return HIDDEN_STEP_TYPES.includes(step.type);
}

/**
 * 从 Step 获取用户输入文本
 */
export function getUserInputText(step: Step): string {
    if (step.type !== 'CORTEX_STEP_TYPE_USER_INPUT') return '';
    const items = step.userInput?.items ?? [];
    return items.map(item => item.text ?? '').join('\n');
}
