/**
 * PlannerResponseStep — AI 回复 (含 thinking + toolCalls)
 */
import { useState } from 'react';
import type { Step, ToolCall } from '@/types';
import { renderMarkdown } from '@/utils/markdown';

interface Props {
    step: Step;
}

export function PlannerResponseStep({ step }: Props) {
    const [showThinking, setShowThinking] = useState(false);
    const pr = step.plannerResponse;
    if (!pr) return null;

    const isGenerating = step.status === 'CORTEX_STEP_STATUS_GENERATING';

    return (
        <div className="step step-planner-response">
            <div className="step-label">
                🤖 AI {isGenerating && <span className="generating-indicator">生成中...</span>}
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

            {/* Tool Calls */}
            {pr.toolCalls && pr.toolCalls.length > 0 && (
                <div className="tool-calls">
                    {pr.toolCalls.map((tc, i) => (
                        <ToolCallBlock key={i} toolCall={tc} />
                    ))}
                </div>
            )}

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
