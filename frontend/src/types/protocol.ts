/**
 * types/protocol.ts — SSE + REST 协议类型定义
 *
 * 架构:
 *   - REST 请求/响应类型 → api-client.ts (唯一定义处)
 *   - SSE 推送事件类型 → 本文件
 *   - 共享数据模型 → 本文件
 */

import type { Step } from './step';
import type { CascadeConfig } from './config';

// ========== SSE 事件类型 (服务端 → 客户端推送) ==========

export interface EventStepAdded {
    type: 'event_step_added';
    cascadeId: string;
    stepIndex: number;
    step: Step;
    seq?: number;
}

export interface EventStepUpdated {
    type: 'event_step_updated';
    cascadeId: string;
    stepIndex: number;
    step: Step;
    seq?: number;
}

export interface EventStatusChanged {
    type: 'event_status_changed';
    cascadeId: string;
    from: string;
    to: string;
    seq?: number;
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
    seq?: number;
}

export interface EventBatch {
    type: 'events_batch';
    cascadeId: string;
    events: ServerMessage[];
}

// YOLO 事件
export interface EventYoloStatus {
    type: 'event_yolo_status';
    status: string;
    cascadeId?: string;
    task?: string;
    reason?: string;
    summary?: string;
    round?: number;
    elapsed?: number;
    message?: string;
}

export interface EventYoloRound {
    type: 'event_yolo_round';
    round: number;
    [key: string]: unknown;
}

export interface EventYoloStep {
    type: 'event_yolo_step';
    [key: string]: unknown;
}

export interface EventYoloError {
    type: 'event_yolo_error';
    message: string;
    [key: string]: unknown;
}

/**
 * 所有可能从 SSE 收到的消息类型
 */
export type ServerMessage =
    | EventStepAdded
    | EventStepUpdated
    | EventStatusChanged
    | EventLsStatus
    | EventMetadataUpdated
    | EventBatch
    | EventYoloStatus
    | EventYoloRound
    | EventYoloStep
    | EventYoloError;

// ========== 共享数据模型 ==========

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
    source?: string;          // ls | file | sqlite | index
    account?: string;         // 账号标识
    hasArchive?: boolean;     // 是否有归档 markdown
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
