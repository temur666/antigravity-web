/**
 * utils/metadata.ts — GeneratorMetadata 解析工具
 *
 * 从 GeneratorMetadata 数组中提取:
 *   - stepUsageMap: stepIndex → StepUsageInfo (关联到单个 step)
 *   - conversationUsageSummary: 对话级汇总
 *
 * 纯函数，无副作用。
 */

import type { GeneratorMetadata, StepUsageInfo } from '@/types';

// ========== 工具函数 ==========

/**
 * 解析 "1.602242664s" 格式为毫秒数
 */
function parseDurationMs(duration?: string): number {
    if (!duration) return 0;
    const match = duration.match(/^([\d.]+)s$/);
    return match ? Math.round(parseFloat(match[1]) * 1000) : 0;
}

/**
 * 安全解析字符串为数字 (LS 返回的 token 数是字符串)
 */
function safeInt(val?: string | number): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseInt(val, 10) || 0;
    return 0;
}

/**
 * 格式化模型名 (去掉 MODEL_ 前缀，缩短显示)
 */
export function formatModelName(model: string): string {
    return model
        .replace(/^MODEL_/, '')
        .replace(/^PLACEHOLDER_/, '');
}

// ========== 核心 API ==========

/**
 * 从 GeneratorMetadata 数组构建 stepIndex → StepUsageInfo 映射
 */
export function buildStepUsageMap(metadata: GeneratorMetadata[]): Map<number, StepUsageInfo> {
    const map = new Map<number, StepUsageInfo>();
    if (!metadata || metadata.length === 0) return map;

    for (const gm of metadata) {
        if (!gm.stepIndices || !gm.chatModel?.usage) continue;

        const usage = gm.chatModel.usage;
        const info: StepUsageInfo = {
            model: formatModelName(usage.model || gm.chatModel.model || ''),
            inputTokens: safeInt(usage.inputTokens),
            outputTokens: safeInt(usage.outputTokens),
            cacheReadTokens: safeInt(usage.cacheReadTokens),
            ttftMs: parseDurationMs(gm.chatModel.timeToFirstToken),
            streamingMs: parseDurationMs(gm.chatModel.streamingDuration),
            contextTokensUsed: gm.chatModel.chatStartMetadata?.contextWindowMetadata?.estimatedTokensUsed ?? 0,
        };

        // 将同一条 metadata 关联到它产生的所有 step
        for (const idx of gm.stepIndices) {
            map.set(idx, info);
        }
    }

    return map;
}

// ========== 对话级汇总 ==========

export interface ConversationUsageSummary {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCalls: number;
    avgTtftMs: number;
    totalStreamingMs: number;
    models: string[];             // 去重后的模型列表
}

/**
 * 从 GeneratorMetadata 数组计算对话级汇总
 */
export function buildConversationUsageSummary(metadata: GeneratorMetadata[]): ConversationUsageSummary {
    const summary: ConversationUsageSummary = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCalls: 0,
        avgTtftMs: 0,
        totalStreamingMs: 0,
        models: [],
    };

    if (!metadata || metadata.length === 0) return summary;

    const modelSet = new Set<string>();
    let totalTtft = 0;
    let ttftCount = 0;

    for (const gm of metadata) {
        if (!gm.chatModel?.usage) continue;

        const usage = gm.chatModel.usage;
        summary.totalInputTokens += safeInt(usage.inputTokens);
        summary.totalOutputTokens += safeInt(usage.outputTokens);
        summary.totalCacheReadTokens += safeInt(usage.cacheReadTokens);
        summary.totalCalls++;

        const ttft = parseDurationMs(gm.chatModel.timeToFirstToken);
        if (ttft > 0) {
            totalTtft += ttft;
            ttftCount++;
        }

        summary.totalStreamingMs += parseDurationMs(gm.chatModel.streamingDuration);

        const modelName = formatModelName(usage.model || gm.chatModel.model || '');
        if (modelName) modelSet.add(modelName);
    }

    summary.avgTtftMs = ttftCount > 0 ? Math.round(totalTtft / ttftCount) : 0;
    summary.models = [...modelSet];

    return summary;
}

// ========== 格式化辅助 ==========

/**
 * 格式化 token 数为可读字符串 (1234 → "1.2K")
 */
export function formatTokenCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
}

/**
 * 格式化毫秒为可读字符串 (1602 → "1.6s")
 */
export function formatDuration(ms: number): string {
    if (ms <= 0) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
