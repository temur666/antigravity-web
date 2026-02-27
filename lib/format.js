/**
 * lib/format.js — 数据格式化（纯函数，无副作用）
 *
 * 将 API 返回的原始数据转换为人类可读的格式。
 * 所有函数都是 data → string，不做 I/O。
 */

/**
 * 需要从 plannerResponse 中过滤的字段
 * 这些字段对人类阅读无意义（二进制签名、重复内容、内部 ID 等）
 */
const PLANNER_SKIP_KEYS = new Set([
    'rawThinkingText', 'thinking',       // 已单独展示在 <details> 中
    'thinkingSignature',                  // 密码学签名 (base64 二进制)
    'thinkingDuration',                   // 已展示在 thinking 标题中
    'modifiedResponse',                   // 通常和 response 重复
    'metadata', 'messageId', 'stopReason', // 内部字段
    'steps', 'toolCalls',                 // 结构化数据
]);

/**
 * 将 trajectory 数据转为 Markdown
 * @param {object} data - API 返回的 trajectory 数据 { trajectory: { ... } }
 * @param {string} title - 对话标题
 * @param {object} [options]
 * @param {boolean} [options.includeToolCalls=true] - 是否包含工具调用
 * @param {boolean} [options.includeThinking=true] - 是否包含思考过程
 * @param {number} [options.maxToolOutputLength=2000] - 工具输出最大长度
 * @returns {string} Markdown 字符串
 */
function toMarkdown(data, title, options = {}) {
    const includeToolCalls = options.includeToolCalls !== false;
    const includeThinking = options.includeThinking !== false;
    const maxToolOutput = options.maxToolOutputLength || 2000;

    const t = data.trajectory;
    if (!t) return `# ${title}\n\n> ⚠️ No trajectory data\n`;

    const md = [];
    md.push(`# ${title}`);
    md.push('');
    md.push(`> **Cascade ID**: \`${t.cascadeId || ''}\`  `);
    md.push(`> **Created**: ${t.metadata?.createdAt || ''}  `);
    md.push(`> **Steps**: ${t.steps?.length || 0}  `);
    md.push('');
    md.push('---');
    md.push('');

    let turn = 0;
    for (const step of (t.steps || [])) {
        const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

        if (type === 'USER_INPUT') {
            turn++;
            const ui = step.userInput;
            if (!ui) continue;
            md.push(`## Turn ${turn}`);
            md.push('');
            md.push('### 👤 User');
            md.push('');
            md.push(ui.userResponse || ui.items?.map(i => i.text).join('\n') || '');
            md.push('');
        }

        if (type === 'PLANNER_RESPONSE') {
            const pr = step.plannerResponse;
            if (!pr) continue;
            md.push('### 🤖 Assistant');
            md.push('');

            // Thinking (折叠展示)
            if (includeThinking) {
                const thinkingText = pr.rawThinkingText || pr.thinking || '';
                if (thinkingText) {
                    const dur = pr.thinkingDuration ? ` (${pr.thinkingDuration})` : '';
                    md.push(`<details><summary>🧠 Thinking${dur}</summary>`);
                    md.push('');
                    md.push(thinkingText);
                    md.push('');
                    md.push('</details>');
                    md.push('');
                }
            }

            // 回复正文
            for (const key of Object.keys(pr)) {
                if (PLANNER_SKIP_KEYS.has(key)) continue;
                const val = pr[key];
                if (typeof val === 'string' && val.length > 0) {
                    md.push(val);
                    md.push('');
                }
            }

            if (pr.stopReason && !pr.stopReason.includes('STOP_PATTERN')) {
                md.push(`*${pr.stopReason.replace('STOP_REASON_', '')}*`);
                md.push('');
            }
            md.push('---');
            md.push('');
        }

        if (type === 'SEARCH_WEB') {
            const sw = step.searchWeb;
            if (!sw) continue;
            md.push('#### 🔍 Web Search');
            md.push('');
            if (sw.query) md.push(`**Query**: ${sw.query}`);
            if (sw.results) {
                for (const r of sw.results) {
                    md.push(`- [${r.title || ''}](${r.url || ''})`);
                }
            }
            md.push('');
        }

        if (type === 'CHECKPOINT' && step.checkpoint?.userIntent) {
            md.push(`> 📌 **${step.checkpoint.userIntent.split('\n')[0]}**`);
            md.push('');
        }

        if (includeToolCalls && type === 'TOOL_CALL') {
            const tc = step.toolCall;
            if (!tc) continue;
            const toolName = tc.toolName || tc.name || 'unknown';
            md.push(`#### 🔧 Tool: ${toolName}`);
            md.push('');
            if (tc.input) {
                const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2);
                if (inputStr.length < 500) {
                    md.push('```');
                    md.push(inputStr);
                    md.push('```');
                } else {
                    md.push(`<details><summary>Input (${inputStr.length} chars)</summary>\n\n\`\`\`\n${inputStr}\n\`\`\`\n\n</details>`);
                }
                md.push('');
            }
        }

        if (includeToolCalls && type === 'TOOL_RESULT') {
            const tr = step.toolResult;
            if (!tr) continue;
            const output = tr.output || tr.result || '';
            const outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
            if (outputStr.length > 0 && outputStr.length < 300) {
                md.push(`> Tool output: ${outputStr.substring(0, 200)}`);
                md.push('');
            } else if (outputStr.length >= 300) {
                md.push(`<details><summary>Tool output (${outputStr.length} chars)</summary>\n\n\`\`\`\n${outputStr.substring(0, maxToolOutput)}\n\`\`\`\n\n</details>`);
                md.push('');
            }
        }
    }

    // Metadata
    md.push('---');
    md.push('');
    md.push('## Metadata');
    md.push('');
    for (const gm of (t.generatorMetadata || [])) {
        const usage = gm.chatModel?.usage;
        if (usage) {
            md.push(`- **Model**: \`${usage.model || ''}\``);
            md.push(`  - Input: ${usage.inputTokens || 0} tokens, Output: ${usage.outputTokens || 0} tokens`);
            md.push(`  - Provider: ${usage.apiProvider || ''}`);
        }
    }

    return md.join('\n');
}

/**
 * 将对话列表转为格式化表格字符串
 * @param {Array} conversations - 对话列表
 * @param {object} [options]
 * @param {number} [options.limit] - 最大显示数量
 * @returns {string}
 */
function formatConversationList(conversations, options = {}) {
    const limit = options.limit || conversations.length;
    const list = conversations.slice(0, limit);
    const lines = [];

    lines.push(`总共 ${conversations.length} 个对话${limit < conversations.length ? `，显示前 ${limit} 个` : ''}：`);
    lines.push('');

    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const ws = c.workspace ? ` [${c.workspace.split('/').pop()}]` : '';
        const time = c.updatedAt ? new Date(c.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '?';
        lines.push(`  [${i}] ${c.title || '(无标题)'}${ws}`);
        lines.push(`      ID: ${c.id}  步骤: ${c.stepCount || '?'}  更新: ${time}`);
    }

    return lines.join('\n');
}

/**
 * 提取对话的摘要信息
 * @param {object} data - trajectory 数据
 * @returns {object} { turns, totalSteps, models, created }
 */
function extractMetadata(data) {
    const t = data.trajectory;
    if (!t) return { turns: 0, totalSteps: 0, models: [], created: null };

    let turns = 0;
    for (const step of (t.steps || [])) {
        if ((step.type || '').includes('USER_INPUT')) turns++;
    }

    const models = [];
    for (const gm of (t.generatorMetadata || [])) {
        const model = gm.chatModel?.usage?.model;
        if (model && !models.includes(model)) models.push(model);
    }

    return {
        turns,
        totalSteps: t.steps?.length || 0,
        models,
        created: t.metadata?.createdAt || null,
    };
}

module.exports = {
    toMarkdown,
    formatConversationList,
    extractMetadata,
    PLANNER_SKIP_KEYS,
};
