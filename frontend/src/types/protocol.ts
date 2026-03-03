/**
 * WebSocket v2 协议类型定义
 *
 * 所有消息都有 type 字段。
 * 请求-响应: 客户端 req_* → 服务端 res_*
 * 服务端推送: event_*
 * 请求带可选 reqId，响应回带同一个 reqId
 */

import type { Step } from './step';
import type { CascadeConfig } from './config';

// ========== 请求类型 (客户端 → 服务端) ==========

export interface ReqStatus {
    type: 'req_status';
    reqId?: string;
}

export interface ReqConversations {
    type: 'req_conversations';
    reqId?: string;
    limit?: number;
    search?: string;
}

export interface ReqTrajectory {
    type: 'req_trajectory';
    reqId?: string;
    cascadeId: string;
}

export interface ReqNewChat {
    type: 'req_new_chat';
    reqId?: string;
}

export interface ReqSendMessage {
    type: 'req_send_message';
    reqId?: string;
    cascadeId: string;
    text: string;
    config?: Partial<CascadeConfig>;
    mentions?: Array<{ file: { absoluteUri: string } }>;
    media?: Array<{ mimeType: string; uri: string; thumbnail?: string }>;
}

export interface ReqSubscribe {
    type: 'req_subscribe';
    reqId?: string;
    cascadeId: string;
}

export interface ReqUnsubscribe {
    type: 'req_unsubscribe';
    reqId?: string;
    cascadeId: string;
}

export interface ReqSetConfig {
    type: 'req_set_config';
    reqId?: string;
    model?: string;
    agenticMode?: boolean;
    autoExecutionPolicy?: string;
    artifactReviewMode?: string;
    knowledgeEnabled?: boolean;
    ephemeralEnabled?: boolean;
    conversationHistoryEnabled?: boolean;
}

export interface ReqGetConfig {
    type: 'req_get_config';
    reqId?: string;
}

export interface ReqCancel {
    type: 'req_cancel';
    reqId?: string;
    cascadeId: string;
}

export type ClientMessage =
    | ReqStatus
    | ReqConversations
    | ReqTrajectory
    | ReqNewChat
    | ReqSendMessage
    | ReqSubscribe
    | ReqUnsubscribe
    | ReqSetConfig
    | ReqGetConfig
    | ReqCancel;

// ========== 响应类型 (服务端 → 客户端) ==========

export interface ResStatus {
    type: 'res_status';
    reqId?: string;
    ls: {
        connected: boolean;
        port: number | null;
        pid: number | null;
        version: string;
    };
    config: CascadeConfig;
    conversations: {
        total: number;
        running: number;
        subscribed: number;
    };
    polling: boolean;
    account: {
        email: string;
        tier: string;
    } | null;
    models: ModelInfo[];
    defaultModel: string | null;
}

export interface ResConversations {
    type: 'res_conversations';
    reqId?: string;
    total: number;
    conversations: ConversationSummary[];
}

export interface ResTrajectory {
    type: 'res_trajectory';
    reqId?: string;
    cascadeId: string;
    status: string;
    totalSteps: number;
    steps: Step[];
    metadata: GeneratorMetadata[];
}

export interface ResNewChat {
    type: 'res_new_chat';
    reqId?: string;
    cascadeId: string;
}

export interface ResSendMessage {
    type: 'res_send_message';
    reqId?: string;
    ok: boolean;
    cascadeId: string;
}

export interface ResSubscribe {
    type: 'res_subscribe';
    reqId?: string;
    cascadeId: string;
}

export interface ResUnsubscribe {
    type: 'res_unsubscribe';
    reqId?: string;
    cascadeId: string;
}

export interface ResConfig {
    type: 'res_config';
    reqId?: string;
    config: CascadeConfig;
}

export interface ResError {
    type: 'res_error';
    reqId?: string;
    code: string;
    message: string;
}

export interface ResCancel {
    type: 'res_cancel';
    reqId?: string;
    ok: boolean;
    cascadeId: string;
}

export type ServerMessage =
    | ResStatus
    | ResConversations
    | ResTrajectory
    | ResNewChat
    | ResSendMessage
    | ResSubscribe
    | ResUnsubscribe
    | ResConfig
    | ResError
    | ResCancel
    | EventStepAdded
    | EventStepUpdated
    | EventStatusChanged
    | EventLsStatus
    | EventMetadataUpdated;

// ========== 事件类型 (服务端推送) ==========

export interface EventStepAdded {
    type: 'event_step_added';
    cascadeId: string;
    stepIndex: number;
    step: Step;
}

export interface EventStepUpdated {
    type: 'event_step_updated';
    cascadeId: string;
    stepIndex: number;
    step: Step;
}

export interface EventStatusChanged {
    type: 'event_status_changed';
    cascadeId: string;
    from: string;
    to: string;
}

export interface EventLsStatus {
    type: 'event_ls_status';
    connected: boolean;
    port: number | null;
    pid: number | null;
}

export interface EventMetadataUpdated {
    type: 'event_metadata_updated';
    cascadeId: string;
    metadata: GeneratorMetadata[];
}

// ========== 共享类型 ==========

export type { CascadeConfig } from './config';

export interface ConversationSummary {
    id: string;
    title: string;
    updatedAt: string;
    sizeBytes: number;
    status?: string;          // IDLE | RUNNING | UNKNOWN
    stepCount?: number;
    createdAt?: string;
    lastUserInputTime?: string;
    workspace?: string;
    source?: string;          // ls | file | sqlite
}

export interface TokenUsage {
    model: string;
    inputTokens: string;
    outputTokens: string;
    responseOutputTokens?: string;
    cacheReadTokens?: string;
    apiProvider?: string;
    responseId?: string;
    [key: string]: unknown;
}

export interface GeneratorMetadata {
    stepIndices: number[];
    chatModel?: {
        model: string;
        usage: TokenUsage;
        timeToFirstToken?: string;
        streamingDuration?: string;
        completionConfig?: {
            maxTokens?: string;
            temperature?: number;
            topK?: string;
            topP?: number;
            [key: string]: unknown;
        };
        chatStartMetadata?: {
            createdAt?: string;
            contextWindowMetadata?: {
                estimatedTokensUsed?: number;
            };
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * 关联到单个 step 上的 usage 精简视图
 * 由 store 从 GeneratorMetadata + stepIndices 派生
 */
export interface StepUsageInfo {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    ttftMs: number;           // 首 token 延迟 (ms)
    streamingMs: number;      // 流式持续时间 (ms)
    contextTokensUsed: number;
    callIndex: number;        // 第几次模型调用 (1-based)
}

export interface ModelInfo {
    label: string;
    model: string;
    supportsImages: boolean;
    supportedMimeTypes: Record<string, boolean>;
    quota: number;
    tag: string;
}

export type { Step } from './step';
