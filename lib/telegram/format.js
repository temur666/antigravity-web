/**
 * lib/telegram/format.js — Step 数据 → Telegram HTML 格式化
 *
 * 将 v2 trajectory step 数据转换为 Telegram 可用的 HTML 子集。
 *
 * Telegram 支持的标签: <b> <i> <s> <code> <pre> <a> <blockquote>
 *
 * 数据源: Controller 返回的 step 数组（gRPC GetCascadeTrajectory 结果）
 * 每个 step 有 type (StepType) 和 status (StepStatus)。
 */

const { esc, truncateForTG } = require('./utils');

// ========== Step 类型常量 ==========

const HIDDEN_TYPES = [
    'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE',
    'CORTEX_STEP_TYPE_CONVERSATION_HISTORY',
    'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS',
    'CORTEX_STEP_TYPE_TASK_BOUNDARY',
];

// ========== 工具 Icon 映射 ==========

const STEP_ICONS = {
    'CORTEX_STEP_TYPE_USER_INPUT': '👤',
    'CORTEX_STEP_TYPE_PLANNER_RESPONSE': '🤖',
    'CORTEX_STEP_TYPE_VIEW_FILE': '📖',
    'CORTEX_STEP_TYPE_CODE_ACTION': '✏️',
    'CORTEX_STEP_TYPE_RUN_COMMAND': '⚡',
    'CORTEX_STEP_TYPE_COMMAND_STATUS': '📋',
    'CORTEX_STEP_TYPE_LIST_DIRECTORY': '📂',
    'CORTEX_STEP_TYPE_NOTIFY_USER': '💬',
    'CORTEX_STEP_TYPE_ERROR_MESSAGE': '❗',
    'CORTEX_STEP_TYPE_CHECKPOINT': '🔖',
    'CORTEX_STEP_TYPE_SEARCH_WEB': '🔍',
};

const FILE_ICONS = {
    js: '📜', jsx: '📜', ts: '📜', tsx: '📜', mjs: '📜', cjs: '📜',
    css: '🎨', scss: '🎨', less: '🎨',
    json: '⚙️', yaml: '⚙️', yml: '⚙️', toml: '⚙️',
    md: '📝', mdx: '📝', txt: '📝',
    html: '🌐', xml: '🌐', svg: '🌐',
    py: '🐍', rs: '🦀', go: '🐹',
};

function getFileIcon(filePath) {
    if (!filePath) return '📄';
    const ext = filePath.split('.').pop()?.toLowerCase();
    return FILE_ICONS[ext] || '📄';
}

function getStepIcon(type) {
    return STEP_ICONS[type] || '🔧';
}

// ========== Markdown → Telegram HTML (简化版) ==========

/**
 * 将 Markdown 文本转换为 Telegram HTML 子集
 * @param {string} md
 * @returns {string}
 */
function mdToTgHtml(md) {
    if (!md) return '';

    let text = md;

    // 保护代码块
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        const langAttr = lang ? ` language="${esc(lang)}"` : '';
        codeBlocks.push(`<pre${langAttr}>${esc(code.trimEnd())}</pre>`);
        return `\x00CB${idx}\x00`;
    });

    // 保护行内代码
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(`<code>${esc(code)}</code>`);
        return `\x00IC${idx}\x00`;
    });

    // 处理各行
    const lines = text.split('\n');
    const processed = [];

    for (const line of lines) {
        if (/\x00CB\d+\x00/.test(line)) { processed.push(line.trim()); continue; }
        if (/^-{3,}$/.test(line.trim())) { processed.push('───'); continue; }

        const headingMatch = line.match(/^#{1,6}\s*(.+)$/);
        if (headingMatch) { processed.push(`<b>${processInline(headingMatch[1])}</b>`); continue; }

        const quoteMatch = line.match(/^>\s+(.*)$/);
        if (quoteMatch) { processed.push(`<blockquote>${processInline(quoteMatch[1])}</blockquote>`); continue; }

        const ulMatch = line.match(/^[-*]\s+(.+)$/);
        if (ulMatch) { processed.push(`• ${processInline(ulMatch[1])}`); continue; }

        const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) { processed.push(`${olMatch[1]}. ${processInline(olMatch[2])}`); continue; }

        processed.push(processInline(line));
    }

    text = processed.join('\n');
    text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // 还原代码块
    codeBlocks.forEach((block, idx) => { text = text.replace(`\x00CB${idx}\x00`, block); });
    inlineCodes.forEach((code, idx) => { text = text.replace(`\x00IC${idx}\x00`, code); });

    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
}

/**
 * 处理行内 Markdown 格式
 * @param {string} text
 * @returns {string}
 */
function processInline(text) {
    text = esc(text);
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    text = text.replace(/(?<!\*)\*([^\s*](?:.*?[^\s*])?)\*(?!\*)/g, '<i>$1</i>');
    text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
    text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    return text;
}

// ========== Step → Telegram HTML ==========

/**
 * 格式化单个 step 为 Telegram HTML
 * @param {object} step
 * @returns {string|null} null 表示隐藏/跳过此 step
 */
function formatStep(step) {
    if (!step || !step.type) return null;
    if (HIDDEN_TYPES.includes(step.type)) return null;

    const icon = getStepIcon(step.type);

    switch (step.type) {
        case 'CORTEX_STEP_TYPE_USER_INPUT': {
            const items = step.userInput?.items || [];
            const text = items.map(i => i.text || '').join('\n').trim();
            return `${icon} <b>User:</b> ${esc(text || '(空)')}`;
        }

        case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE': {
            const parts = [];
            const pr = step.plannerResponse || {};

            // Thinking
            if (pr.thinking) {
                const clean = pr.thinking.substring(0, 500);
                parts.push(`<blockquote expandable>💭 ${esc(clean)}</blockquote>`);
            }

            // Tool calls
            if (pr.toolCalls && pr.toolCalls.length > 0) {
                for (const tc of pr.toolCalls) {
                    parts.push(`🔧 <i>${esc(tc.name || 'tool')}</i>`);
                }
            }

            // Response
            if (pr.response) {
                parts.push(mdToTgHtml(pr.response));
            }

            return parts.length > 0 ? parts.join('\n') : null;
        }

        case 'CORTEX_STEP_TYPE_VIEW_FILE': {
            const vf = step.viewFile || {};
            const fileIcon = getFileIcon(vf.filePath);
            const lines = vf.startLine && vf.endLine ? ` L${vf.startLine}-${vf.endLine}` : '';
            return `${icon} Read ${fileIcon}<code>${esc(vf.filePath || '?')}</code>${lines}`;
        }

        case 'CORTEX_STEP_TYPE_CODE_ACTION': {
            const ca = step.codeAction || {};
            const fileIcon = getFileIcon(ca.filePath);
            const desc = ca.description ? ` — ${esc(ca.description.substring(0, 80))}` : '';
            return `${icon} Edited ${fileIcon}<code>${esc(ca.filePath || '?')}</code>${desc}`;
        }

        case 'CORTEX_STEP_TYPE_RUN_COMMAND': {
            const rc = step.runCommand || {};
            const cmd = rc.command || '?';
            return `${icon} Ran command\n<pre>${esc(cmd)}</pre>`;
        }

        case 'CORTEX_STEP_TYPE_COMMAND_STATUS': {
            const cs = step.commandStatus || {};
            const output = (cs.output || '').substring(0, 300);
            const exit = cs.exitCode != null ? ` (exit: ${cs.exitCode})` : '';
            return `📋 Command output${exit}\n<pre>${esc(output)}</pre>`;
        }

        case 'CORTEX_STEP_TYPE_LIST_DIRECTORY': {
            const ld = step.listDirectory || {};
            const entries = ld.entries || [];
            const count = entries.length;
            return `${icon} Listed <code>${esc(ld.path || '?')}</code> (${count} entries)`;
        }

        case 'CORTEX_STEP_TYPE_NOTIFY_USER': {
            const nu = step.notifyUser || {};
            return `${icon} ${mdToTgHtml(nu.message || '')}`;
        }

        case 'CORTEX_STEP_TYPE_ERROR_MESSAGE': {
            const em = step.errorMessage || {};
            return `${icon} <b>Error:</b> ${esc(em.message || '未知错误')}`;
        }

        case 'CORTEX_STEP_TYPE_CHECKPOINT': {
            const cp = step.checkpoint || {};
            return `${icon} Checkpoint: ${esc(cp.userIntent || '')}`;
        }

        case 'CORTEX_STEP_TYPE_SEARCH_WEB': {
            const sw = step.searchWeb || {};
            const results = sw.results || [];
            const lines = [`${icon} Search: <b>${esc(sw.query || '?')}</b>`];
            for (const r of results.slice(0, 3)) {
                lines.push(`  • <a href="${esc(r.url || '#')}">${esc(r.title || '?')}</a>`);
            }
            if (results.length > 3) lines.push(`  <i>...+${results.length - 3} more</i>`);
            return lines.join('\n');
        }

        default:
            return null;
    }
}

/**
 * 格式化多个 steps (增量) 为 Telegram HTML
 * 只显示有意义的 step，过滤隐藏类型
 * @param {Array} steps
 * @returns {string}
 */
function formatSteps(steps) {
    if (!steps || steps.length === 0) return '(无内容)';

    const parts = [];
    for (const step of steps) {
        const text = formatStep(step);
        if (text) parts.push(text);
    }
    return parts.join('\n\n') || '(无可显示内容)';
}

/**
 * 从完整 steps 数组中提取最后一段 AI 回复 (从最后一个 USER_INPUT 之后的所有 step)
 * @param {Array} steps
 * @returns {string}
 */
function formatLastReply(steps) {
    if (!steps || steps.length === 0) return '(空对话)';

    // 找最后一个 USER_INPUT 的位置
    let lastUserIdx = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].type === 'CORTEX_STEP_TYPE_USER_INPUT') {
            lastUserIdx = i;
            break;
        }
    }

    const replySteps = lastUserIdx >= 0 ? steps.slice(lastUserIdx + 1) : steps;
    return formatSteps(replySteps);
}

/**
 * 格式化完整对话为 Telegram HTML (用于 /readall)
 * @param {Array} steps
 * @param {string} [title]
 * @returns {string}
 */
function formatFullConversation(steps, title) {
    const header = title ? `📌 <b>${esc(title)}</b>\n\n` : '';
    const body = formatSteps(steps);
    return header + body;
}

/**
 * 格式化完整对话为 Markdown 文件内容 (用于长对话导出)
 * @param {Array} steps
 * @param {string} [title]
 * @returns {string}
 */
function formatConversationMarkdown(steps, title) {
    const lines = [];
    lines.push(`# ${title || '对话导出'}`);
    lines.push('');

    const visibleSteps = (steps || []).filter(s => !HIDDEN_TYPES.includes(s.type));
    lines.push(`> 共 ${visibleSteps.length} 个可见步骤`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const step of visibleSteps) {
        const type = step.type.replace('CORTEX_STEP_TYPE_', '');
        const icon = getStepIcon(step.type);
        lines.push(`## ${icon} ${type}`);
        lines.push('');

        switch (step.type) {
            case 'CORTEX_STEP_TYPE_USER_INPUT': {
                const items = step.userInput?.items || [];
                const text = items.map(i => i.text || '').join('\n').trim();
                lines.push(text || '_(空)_');
                break;
            }
            case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE': {
                const pr = step.plannerResponse || {};
                if (pr.thinking) {
                    lines.push('<details>');
                    lines.push(`<summary>Thinking</summary>\n\n${pr.thinking}\n`);
                    lines.push('</details>');
                    lines.push('');
                }
                if (pr.toolCalls?.length > 0) {
                    for (const tc of pr.toolCalls) {
                        lines.push(`> Tool: ${tc.name}`);
                    }
                    lines.push('');
                }
                if (pr.response) lines.push(pr.response);
                break;
            }
            case 'CORTEX_STEP_TYPE_CODE_ACTION': {
                const ca = step.codeAction || {};
                lines.push(`File: \`${ca.filePath || '?'}\``);
                if (ca.description) lines.push(ca.description);
                if (ca.diff) lines.push('```diff\n' + ca.diff + '\n```');
                break;
            }
            case 'CORTEX_STEP_TYPE_RUN_COMMAND': {
                const rc = step.runCommand || {};
                lines.push('```bash\n' + (rc.command || '?') + '\n```');
                break;
            }
            case 'CORTEX_STEP_TYPE_COMMAND_STATUS': {
                const cs = step.commandStatus || {};
                if (cs.output) lines.push('```\n' + cs.output.substring(0, 2000) + '\n```');
                if (cs.exitCode != null) lines.push(`Exit code: ${cs.exitCode}`);
                break;
            }
            default: {
                const text = formatStep(step);
                if (text) lines.push(text.replace(/<[^>]+>/g, ''));
                break;
            }
        }
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * 流式更新时的草稿文本 (纯文本, 用于 sendMessageDraft)
 * @param {Array} newSteps - 本次新增/更新的 steps
 * @returns {string}
 */
function formatDraftText(newSteps) {
    if (!newSteps || newSteps.length === 0) return '⏳ 处理中...';

    const parts = [];
    for (const step of newSteps) {
        if (HIDDEN_TYPES.includes(step.type)) continue;

        switch (step.type) {
            case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE': {
                const pr = step.plannerResponse || {};
                if (pr.thinking) parts.push(`💭 ${pr.thinking.substring(0, 200)}`);
                if (pr.toolCalls?.length > 0) {
                    parts.push(pr.toolCalls.map(tc => `🔧 ${tc.name}`).join('\n'));
                }
                if (pr.response) parts.push(pr.response.substring(0, 800));
                break;
            }
            case 'CORTEX_STEP_TYPE_CODE_ACTION': {
                const ca = step.codeAction || {};
                parts.push(`✏️ Editing ${ca.filePath || '?'}`);
                break;
            }
            case 'CORTEX_STEP_TYPE_RUN_COMMAND': {
                const rc = step.runCommand || {};
                parts.push(`⚡ $ ${rc.command || '?'}`);
                break;
            }
            case 'CORTEX_STEP_TYPE_VIEW_FILE': {
                const vf = step.viewFile || {};
                parts.push(`📖 Reading ${vf.filePath || '?'}`);
                break;
            }
            default: {
                const icon = getStepIcon(step.type);
                const type = step.type.replace('CORTEX_STEP_TYPE_', '');
                parts.push(`${icon} ${type}`);
            }
        }
    }

    parts.push('▌'); // 打字光标
    return parts.join('\n\n').substring(0, 4096);
}

module.exports = {
    formatStep,
    formatSteps,
    formatLastReply,
    formatFullConversation,
    formatConversationMarkdown,
    formatDraftText,
    mdToTgHtml,
    truncateForTG,
    HIDDEN_TYPES,
};
