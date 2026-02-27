/**
 * reformat-json.js — 从已有的 JSON 文件重新生成干净的 Markdown
 * Usage: node tools/reformat-json.js [json文件路径]
 */
const fs = require('fs');
const path = require('path');

const jsonFile = process.argv[2] || path.join(__dirname, 'API New Chat Creation_2026-02-26T07-20-26.json');
const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const t = data.trajectory;

const md = [];
const title = t.metadata?.title || path.basename(jsonFile, '.json');
md.push(`# ${title}`);
md.push('');
md.push(`> **Cascade ID**: \`${t.cascadeId}\`  `);
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
        const skipKeys = new Set([
            'rawThinkingText', 'thinking', 'thinkingSignature', 'thinkingDuration',
            'modifiedResponse', 'metadata', 'messageId', 'stopReason', 'steps', 'toolCalls',
        ]);
        for (const key of Object.keys(pr)) {
            if (skipKeys.has(key)) continue;
            const val = pr[key];
            if (typeof val === 'string' && val.length > 0) {
                md.push(val);
                md.push('');
            }
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
            for (const r of sw.results) { md.push(`- [${r.title || ''}](${r.url || ''})`); }
        }
        md.push('');
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
    }
}

const outFile = jsonFile.replace(/\.json$/, '_clean.md');
fs.writeFileSync(outFile, md.join('\n'), 'utf-8');
console.log(`✅ 已生成: ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
