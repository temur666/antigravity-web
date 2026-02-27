/**
 * format-clean.js — 清理格式化 trajectory JSON 到干净的 Markdown
 * 去除重复内容、Base64 乱码、时间戳噪音
 */
const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.join(__dirname, 'AI_Design_Tool_Development.json');
const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const t = data.trajectory;

const md = [];
const title = process.argv[3] || 'AI Design Tool Development';

md.push(`# ${title}`);
md.push('');
md.push(`> **Cascade ID**: \`${t.cascadeId}\`  `);
md.push(`> **Created**: ${t.metadata?.createdAt || ''}  `);
md.push(`> **Steps**: ${(t.steps || []).length}`);
md.push('');
md.push('---');
md.push('');

let turn = 0;
const seenContent = new Set();

function isJunk(text) {
    if (!text || text.length === 0) return true;
    const trimmed = text.trim();
    // Base64 encoded blocks
    if (/^[A-Za-z0-9+/=]{50,}$/.test(trimmed)) return true;
    // Duration strings like "6.507s"
    if (/^\d+\.\d+s$/.test(trimmed)) return true;
    return false;
}

function dedup(text) {
    // 检查是否是重复内容
    const sig = text.trim().substring(0, 200);
    if (seenContent.has(sig)) return true;
    seenContent.add(sig);
    return false;
}

for (const step of (t.steps || [])) {
    const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

    if (type === 'USER_INPUT') {
        turn++;
        const ui = step.userInput || {};
        const userText = ui.userResponse || (ui.items || []).map(i => i.text).filter(Boolean).join('\n') || '';
        if (!userText) continue;

        md.push(`## Turn ${turn}`);
        md.push('');
        md.push('### 👤 User');
        md.push('');
        md.push(userText);
        md.push('');
    }

    if (type === 'PLANNER_RESPONSE') {
        const pr = step.plannerResponse || {};

        // 收集正文内容
        const bodyParts = [];
        for (const [k, v] of Object.entries(pr)) {
            if (['rawThinkingText', 'thinking', 'metadata', 'messageId', 'stopReason', 'steps'].includes(k)) continue;
            if (typeof v === 'string' && v.length > 0 && !isJunk(v)) {
                bodyParts.push(v);
            }
        }

        // 合并正文，去重
        const fullBody = bodyParts.join('\n\n');
        if (fullBody.length === 0 && !pr.rawThinkingText) continue;
        if (fullBody.length > 0 && dedup(fullBody)) continue;

        md.push('### 🤖 Assistant');
        md.push('');

        // Thinking
        if (pr.rawThinkingText) {
            md.push('<details><summary>🧠 Thinking</summary>');
            md.push('');
            md.push(pr.rawThinkingText);
            md.push('');
            md.push('</details>');
            md.push('');
        }

        // Body
        if (fullBody) {
            md.push(fullBody);
            md.push('');
        }

        // Stop reason (only non-normal)
        if (pr.stopReason && !pr.stopReason.includes('STOP_PATTERN')) {
            md.push(`*${pr.stopReason.replace('STOP_REASON_', '')}*`);
            md.push('');
        }

        md.push('---');
        md.push('');
    }

    if (type === 'SEARCH_WEB') {
        const sw = step.searchWeb || {};
        if (sw.query) {
            md.push(`#### 🔍 Web Search: ${sw.query}`);
            md.push('');
            for (const r of (sw.results || [])) {
                md.push(`- [${r.title || 'Link'}](${r.url || '#'})`);
            }
            md.push('');
        }
    }

    if (type === 'CHECKPOINT' && step.checkpoint?.userIntent) {
        md.push(`> 📌 **${step.checkpoint.userIntent.split('\n')[0]}**`);
        md.push('');
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

const result = md.join('\n');
const outputFile = inputFile.replace(/\.json$/, '.md');
fs.writeFileSync(outputFile, result, 'utf-8');
console.log(`✅ 保存到: ${outputFile}`);
console.log(`   大小: ${(result.length / 1024).toFixed(1)} KB`);
console.log(`   行数: ${result.split('\n').length}`);
console.log(`   Turns: ${turn}`);
