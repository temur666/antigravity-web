/**
 * export-latest.js — 自动导出最新的对话到 Markdown 文件
 * 
 * 使用 lib/api.js 统一 API 层 + lib/conversations.js 获取对话列表
 * Usage: node tools/export-latest.js
 */
const api = require('../lib/api');
const { getConversations } = require('../lib/conversations');
const fs = require('fs');
const path = require('path');

function formatToMarkdown(data, title) {
    const t = data.trajectory;
    const md = [];
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
            // Thinking 内容（兼容 rawThinkingText 和 thinking 两种字段名）
            const thinkingText = pr.rawThinkingText || pr.thinking || '';
            if (thinkingText) {
                const durationLabel = pr.thinkingDuration ? ` (${pr.thinkingDuration})` : '';
                md.push(`<details><summary>🧠 Thinking${durationLabel}</summary>`);
                md.push('');
                md.push(thinkingText);
                md.push('');
                md.push('</details>');
                md.push('');
            }
            // 排除内部/二进制/已处理的字段，只输出人类可读的文本字段
            const skipKeys = new Set([
                'rawThinkingText', 'thinking',           // 已在上方 details 中展示
                'thinkingSignature',                      // 密码学签名（base64 二进制数据）
                'thinkingDuration',                       // 已在 thinking summary 中展示
                'modifiedResponse',                       // 通常和 response 重复
                'metadata', 'messageId', 'stopReason',    // 内部字段
                'steps', 'toolCalls',                     // 结构化数据，非文本
            ]);
            for (const key of Object.keys(pr)) {
                if (skipKeys.has(key)) continue;
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

        // Tool calls
        if (type === 'TOOL_CALL') {
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

        if (type === 'TOOL_RESULT') {
            const tr = step.toolResult;
            if (!tr) continue;
            const output = tr.output || tr.result || '';
            const outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
            if (outputStr.length > 0 && outputStr.length < 300) {
                md.push(`> Tool output: ${outputStr.substring(0, 200)}`);
                md.push('');
            } else if (outputStr.length >= 300) {
                md.push(`<details><summary>Tool output (${outputStr.length} chars)</summary>\n\n\`\`\`\n${outputStr.substring(0, 2000)}\n\`\`\`\n\n</details>`);
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

async function main() {
    // 1. 从 SQLite 获取对话列表
    console.log('📋 获取对话列表...');
    const convResult = getConversations();

    if (convResult.error) {
        console.log(`❌ ${convResult.error}`);
        return;
    }

    if (convResult.conversations.length === 0) {
        console.log('❌ 没有找到任何对话');
        return;
    }

    // 优先选择本地工作区对话（非 SSH/WSL），因为远程对话可能不在本地 API 可达范围
    const localConvs = convResult.conversations.filter(c =>
        c.title && c.title.length > 0 && c.workspace && !c.workspace.includes('SSH') && !c.workspace.includes('WSL')
    );
    const latest = localConvs[0] || convResult.conversations.find(c => c.title && c.title.length > 0) || convResult.conversations[0];

    console.log(`\n📌 最新对话:`);
    console.log(`  标题: ${latest.title || '(无标题)'}`);
    console.log(`  ID:   ${latest.id}`);
    console.log(`  步骤: ${latest.stepCount}`);
    console.log(`  更新: ${latest.updatedAt}`);
    console.log(`  工作区: ${latest.workspace}`);

    // 显示前5个对话供参考
    console.log(`\n📋 最近 5 个对话:`);
    convResult.conversations.slice(0, 5).forEach((c, i) => {
        console.log(`  [${i}] ${c.title || '(无标题)'} — ${c.updatedAt || '?'}`);
    });

    // 2. 初始化 API 层 (自动获取端口 + CSRF)
    console.log('\n🔌 初始化 API...');
    try {
        await api.init();
    } catch (e) {
        console.log(`⚠️ 自动初始化失败: ${e.message}`);
        console.log('  尝试手动触发...');

        // 尝试用 Fetch 拦截方式
        const { httpGet, cdpSend, sleep } = require('../lib/cdp');
        const WebSocket = require('ws');
        const targets = await httpGet('http://127.0.0.1:9000/json');
        const page = targets.find(t => t.type === 'page' && t.url && t.url.includes('workbench.html'))
            || targets.find(t => t.type === 'page');

        if (!page) { console.log('❌ 没有可用的 CDP 页面'); return; }
        console.log(`  连接到: ${page.title}`);

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(r => ws.on('open', r));
        await cdpSend(ws, 'Runtime.enable');
        await cdpSend(ws, 'Network.enable');

        // 先设置 CSRF 拦截 handler，再触发 fetch（避免错过 Network 事件）
        const csrfPromise = new Promise(resolve => {
            const handler = raw => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.method === 'Network.requestWillBeSent' && msg.params.request.headers['x-codeium-csrf-token']) {
                        ws.off('message', handler);
                        const port = new URL(msg.params.request.url).port;
                        resolve({ csrf: msg.params.request.headers['x-codeium-csrf-token'], port });
                    }
                } catch { }
            };
            ws.on('message', handler);
            setTimeout(() => { ws.off('message', handler); resolve(null); }, 10000);
        });

        // 触发 fetch 请求（不 await，让 Network 事件能被捕获）
        cdpSend(ws, 'Runtime.evaluate', {
            expression: `(async () => {
                var entries = performance.getEntriesByType('resource');
                var ports = [];
                entries.forEach(function(e) {
                    if (e.name.includes('LanguageServer')) {
                        try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
                    }
                });
                for (var i = 0; i < ports.length; i++) {
                    try {
                        await fetch('https://127.0.0.1:' + ports[i] + '/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                        });
                    } catch {}
                }
                return JSON.stringify(ports);
            })()`, returnByValue: true, awaitPromise: true,
        }, 15000).catch(() => { });

        // 等待 CSRF
        console.log('  等待 CSRF token...');
        const csrf = await csrfPromise;

        await cdpSend(ws, 'Network.disable').catch(() => { });
        ws.close();

        if (!csrf) { console.log('❌ CSRF 获取失败'); return; }

        api.registerEndpoint(csrf.port, csrf.csrf, { windowTitle: page.title });
        api.setActivePort(csrf.port);
        console.log(`✅ 手动注册端口 ${csrf.port}, CSRF: ${csrf.csrf.substring(0, 12)}...`);
    }

    const status = api.getStatus();
    console.log(`✅ API 状态: ${status.endpoints.length} 端口, 活跃: ${status.activePort}`);

    // 3. 获取对话内容
    const cascadeId = latest.id;
    console.log(`\n📡 获取对话内容 (${cascadeId})...`);

    let trajectoryData;
    try {
        trajectoryData = await api.getTrajectory(cascadeId);
    } catch (e) {
        console.log(`❌ 获取失败: ${e.message}`);
        return;
    }

    if (!trajectoryData || !trajectoryData.trajectory) {
        console.log('❌ 返回数据为空');
        return;
    }

    console.log(`✅ 获取到 ${trajectoryData.trajectory.steps?.length || 0} 个步骤`);

    // 4. 格式化 → Markdown
    const title = latest.title || 'Untitled';
    const markdown = formatToMarkdown(trajectoryData, title);
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 60);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputFile = path.join(__dirname, `${safeName}_${timestamp}.md`);
    fs.writeFileSync(outputFile, markdown, 'utf-8');

    // 也保存原始 JSON
    const jsonFile = path.join(__dirname, `${safeName}_${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(trajectoryData, null, 2), 'utf-8');

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ 导出完成!`);
    console.log(`  📄 Markdown: ${outputFile}`);
    console.log(`     (${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB)`);
    console.log(`  📦 JSON:     ${jsonFile}`);
    console.log(`     (${(fs.statSync(jsonFile).size / 1024).toFixed(1)} KB)`);
    console.log(`${'═'.repeat(60)}`);
}

main().catch(err => console.error('Fatal:', err));
