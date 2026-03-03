/**
 * PlannerResponseStep — AI 回复 (含 thinking + toolCalls)
 */
import { useState } from 'react';
import type { Step, ToolCall } from '@/types';
import { renderMarkdown } from '@/utils/markdown';
import { useAppStore } from '@/store';
import { formatTokenCount, formatDuration, shortenModelLabel } from '@/utils/metadata';

/**
 * 已有专属 Step UI 的工具名白名单。
 * 这些工具会由后续独立的 Step 来渲染，所以在 PlannerResponse 中跳过，
 * 避免同一操作在界面上重复出现。
 */
const TOOLS_WITH_DEDICATED_STEP = new Set([
    'run_command',
    'command_status',
    'view_file',
    'view_file_outline',
    'view_code_item',
    'write_to_file',
    'replace_file_content',
    'multi_replace_file_content',
    'list_dir',
    'find_by_name',
    'grep_search',
    'search_web',
]);

interface Props {
    step: Step;
    stepIndex: number;
}

export function PlannerResponseStep({ step, stepIndex }: Props) {
    const [showThinking, setShowThinking] = useState(false);
    const usage = useAppStore(s => s.stepUsageMap.get(stepIndex));
    const models = useAppStore(s => s.models);
    const pr = step.plannerResponse;
    if (!pr) return null;

    const isGenerating = step.status === 'CORTEX_STEP_STATUS_GENERATING';

    // 模型名映射: 用 store.models 查找 label，再缩短
    const resolveModelName = (rawModel: string): string => {
        const info = models.find(m => m.model === rawModel);
        return info ? shortenModelLabel(info.label) : rawModel;
    };

    return (
        <div className="step step-planner-response">
            <div className="step-label">
                AI {isGenerating && <span className="generating-indicator">生成中...</span>}
                {usage && !isGenerating && (
                    <span className="step-usage-inline">
                        <span className="usage-model">{resolveModelName(usage.model)}</span>
                        <span className="usage-sep">&middot;</span>
                        <span className="usage-ttft">{formatDuration(usage.ttftMs)}</span>
                        <span className="usage-sep">&middot;</span>
                        <span className="usage-tokens">{formatTokenCount(usage.outputTokens)} token</span>
                        <span className="usage-sep">&middot;</span>
                        <span className="usage-turn">Call {usage.callIndex}</span>
                    </span>
                )}
            </div>

            {/* Thinking 折叠块 */}
            {pr.thinking && (
                <div className={`thinking-block ${showThinking ? 'expanded' : ''}`}>
                    <button
                        className="thinking-toggle"
                        onClick={() => setShowThinking(!showThinking)}
                    >
                        <span className="thinking-chevron">{showThinking ? '▼' : '▶'}</span>
                        <span>思考过程</span>
                    </button>
                    {showThinking && (
                        <div className="thinking-content">
                            <pre>{pr.thinking}</pre>
                        </div>
                    )}
                </div>
            )}

            {/* 主回复 */}
            {pr.response && (
                <div
                    className="step-content ai-response"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(pr.response) }}
                />
            )}

            {/* Tool Calls — 过滤掉有专属 Step UI 的工具 */}
            {pr.toolCalls && pr.toolCalls.length > 0 && (() => {
                const visibleCalls = pr.toolCalls.filter(
                    tc => !TOOLS_WITH_DEDICATED_STEP.has(tc.name)
                );
                return visibleCalls.length > 0 ? (
                    <div className="tool-calls">
                        {visibleCalls.map((tc, i) => (
                            <ToolCallBlock key={i} toolCall={tc} />
                        ))}
                    </div>
                ) : null;
            })()}

            {/* 无内容时的 fallback */}
            {!pr.response && !pr.thinking && (!pr.toolCalls || pr.toolCalls.length === 0) && (
                <div className="step-content ai-response empty">（无内容）</div>
            )}
        </div>
    );
}

function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
    const [expanded, setExpanded] = useState(false);

    let parsedArgs: string | null = null;
    if (toolCall.argumentsJson) {
        try {
            parsedArgs = JSON.stringify(JSON.parse(toolCall.argumentsJson), null, 2);
        } catch {
            parsedArgs = toolCall.argumentsJson;
        }
    }

    return (
        <div className="tool-call-block">
            <button className="tool-call-header" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '▼' : '▶'}</span>
                <span className="tool-call-name">🔧 {toolCall.name}</span>
            </button>
            {expanded && parsedArgs && (
                <pre className="tool-call-args">{parsedArgs}</pre>
            )}
            {expanded && toolCall.result && (
                <div className="tool-call-result">
                    <div className="tool-call-result-label">结果:</div>
                    <pre>{typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}
