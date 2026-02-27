/**
 * 配置类型定义
 */

export interface CascadeConfig {
    model: string;
    agenticMode: boolean;
    autoExecutionPolicy: AutoExecutionPolicy;
    artifactReviewMode: ArtifactReviewMode;
    knowledgeEnabled: boolean;
    ephemeralEnabled: boolean;
    conversationHistoryEnabled: boolean;
}

export type AutoExecutionPolicy =
    | 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'
    | 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'
    | 'CASCADE_COMMANDS_AUTO_EXECUTION_CAUTIOUS';

export type ArtifactReviewMode =
    | 'ARTIFACT_REVIEW_MODE_TURBO'
    | 'ARTIFACT_REVIEW_MODE_NORMAL'
    | 'ARTIFACT_REVIEW_MODE_STRICT';

export const DEFAULT_CONFIG: CascadeConfig = {
    model: 'MODEL_PLACEHOLDER_M18',
    agenticMode: true,
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
    knowledgeEnabled: true,
    ephemeralEnabled: true,
    conversationHistoryEnabled: true,
};

/** 配置项元数据 — 供 ConfigPanel 渲染用 */
export const CONFIG_META: Record<keyof CascadeConfig, {
    label: string;
    description: string;
    inputType: 'select' | 'toggle';
    options?: Array<{ value: string; label: string }>;
}> = {
    model: {
        label: '模型',
        description: '对话使用的 AI 模型',
        inputType: 'select',
        options: [], // 动态从 res_status.models 填充
    },
    agenticMode: {
        label: 'Agentic 模式',
        description: '启用后 AI 可以主动执行工具调用',
        inputType: 'toggle',
    },
    autoExecutionPolicy: {
        label: '自动执行策略',
        description: '控制命令是否自动执行',
        inputType: 'select',
        options: [
            { value: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER', label: '激进 (Eager)' },
            { value: 'CASCADE_COMMANDS_AUTO_EXECUTION_CAUTIOUS', label: '谨慎 (Cautious)' },
            { value: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF', label: '关闭 (Off)' },
        ],
    },
    artifactReviewMode: {
        label: '文件审查模式',
        description: '控制 AI 修改文件的审查级别',
        inputType: 'select',
        options: [
            { value: 'ARTIFACT_REVIEW_MODE_TURBO', label: 'Turbo (自动通过)' },
            { value: 'ARTIFACT_REVIEW_MODE_NORMAL', label: '普通' },
            { value: 'ARTIFACT_REVIEW_MODE_STRICT', label: '严格' },
        ],
    },
    knowledgeEnabled: {
        label: '知识库',
        description: '启用知识库上下文',
        inputType: 'toggle',
    },
    ephemeralEnabled: {
        label: '临时消息',
        description: '启用临时系统消息',
        inputType: 'toggle',
    },
    conversationHistoryEnabled: {
        label: '对话历史',
        description: '启用跨对话的历史上下文',
        inputType: 'toggle',
    },
};
