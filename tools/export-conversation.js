/**
 * export-conversation.js — 完整导出一个对话到 Markdown
 * 
 * 流程: SQLite/Manager DOM → CSRF Token → gRPC API → Markdown
 * Usage: node tools/export-conversation.js "AI Design Tool Development"
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const { getConversations } = require('../lib/conversations');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const searchTitle = process.argv[2] || 'AI Design Tool Development';

function postAPI(url, body, csrfToken) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const urlObj = new URL(url);
        const req = https.request({
            hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-codeium-csrf-token': csrfToken,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
        }, (res) => {
            let d = ''; res.on('data', chunk => d += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

async function connectManager() {
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    if (!manager) throw new Error('Manager 窗口未找到');
    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    return ws;
}

async function getCSRFAndPorts(ws) {
    await cdpSend(ws, 'Network.enable');
    // 获取可用端口
    const portResult = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(async () => {
            var entries = performance.getEntriesByType('resource');
            var ports = [];
            entries.forEach(function(e) {
                if (e.name.includes('LanguageServer')) {
                    try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
                }
            });
            if (ports.length > 0) {
                await fetch('https://127.0.0.1:' + ports[0] + '/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                });
            }
            return JSON.stringify(ports);
        })()`, returnByValue: true, awaitPromise: true,
    }, 10000);
    const ports = JSON.parse(portResult.result.value);

    // 拦截 CSRF
    const csrfToken = await new Promise(resolve => {
        const handler = raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent' && msg.params.request.headers['x-codeium-csrf-token']) {
                    ws.off('message', handler); resolve(msg.params.request.headers['x-codeium-csrf-token']);
                }
            } catch { }
        };
        ws.on('message', handler);
        setTimeout(() => resolve(null), 5000);
    });
    await cdpSend(ws, 'Network.disable');
    return { csrfToken, ports };
}

// 从 Manager DOM 获取对话 UUID（搜索标题）
async function findConversationInManager(ws, title) {
    const result = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(() => {
            var title = ${JSON.stringify(title)};
            // 在 Manager 侧边栏中搜索
            var items = document.querySelectorAll('.cursor-pointer');
            for (var i = 0; i < items.length; i++) {
                var text = (items[i].innerText || '').trim();
                if (text.includes(title)) {
                    // 尝试从 data 属性或链接获取 UUID
                    var el = items[i];
                    var uuid = el.getAttribute('data-id') || el.getAttribute('data-cascade-id') || '';
                    // 在文本中搜索 UUID 格式
                    var allText = el.outerHTML;
                    var uuidMatch = allText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
                    if (uuidMatch) uuid = uuidMatch[0];
                    return JSON.stringify({ found: true, text: text.substring(0, 100), uuid: uuid, index: i });
                }
            }
            return JSON.stringify({ found: false });
        })()`, returnByValue: true,
    });
    return JSON.parse(result.result.value);
}

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
            if (pr.rawThinkingText) {
                md.push('<details><summary>🧠 Thinking</summary>');
                md.push('');
                md.push(pr.rawThinkingText);
                md.push('');
                md.push('</details>');
                md.push('');
            }
            // 寻找所有可能含有回复文本的字段
            for (const key of Object.keys(pr)) {
                if (['rawThinkingText', 'metadata', 'messageId', 'stopReason', 'steps'].includes(key)) continue;
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
    console.log(`🔍 搜索: "${searchTitle}"`);

    // 1. 从 SQLite 搜
    const convResult = getConversations();
    let cascadeId = null;
    const sqlMatch = convResult.conversations.find(c => c.title?.includes(searchTitle));
    if (sqlMatch) {
        cascadeId = sqlMatch.id;
        console.log(`✅ SQLite 找到: ${sqlMatch.title} (${cascadeId})`);
    }

    // 2. 连接 Manager
    const ws = await connectManager();
    console.log('✅ Manager 已连接');

    // 如果 SQLite 没找到，从 Manager DOM 搜
    if (!cascadeId) {
        console.log('  SQLite 未找到，从 Manager DOM 搜索...');
        const domResult = await findConversationInManager(ws, searchTitle);
        if (domResult.found && domResult.uuid) {
            cascadeId = domResult.uuid;
            console.log(`✅ DOM 找到: "${domResult.text}" → ${cascadeId}`);
        } else if (domResult.found) {
            console.log(`⚠️ 找到标题但无 UUID，尝试从标题匹配 SSH 目录...`);
        }
    }

    // 3. 获取 CSRF + 端口
    console.log('\n🔑 获取 CSRF...');
    const { csrfToken, ports } = await getCSRFAndPorts(ws);
    ws.close();

    if (!csrfToken) { console.log('❌ CSRF 获取失败'); return; }
    console.log(`✅ CSRF: ${csrfToken.substring(0, 12)}...`);
    console.log(`✅ Ports: ${ports.join(', ')}`);

    if (!cascadeId) { console.log('❌ 未找到对话 UUID'); return; }

    // 4. 调用 gRPC API — 尝试所有端口
    let trajectoryData = null;
    for (const port of ports) {
        console.log(`\n📡 GetCascadeTrajectory (port ${port})...`);
        try {
            const res = await postAPI(
                `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory`,
                { cascadeId }, csrfToken
            );
            console.log(`  Status: ${res.status}, ${res.body.length} bytes`);
            if (res.status === 200 && res.body.length > 100) {
                trajectoryData = JSON.parse(res.body);
                console.log(`  ✅ 成功! ${trajectoryData.trajectory?.steps?.length || 0} steps`);
                break;
            }
        } catch (e) { console.log(`  ❌ ${e.message}`); }
    }

    if (!trajectoryData) { console.log('❌ 所有端口均失败'); return; }

    // 5. 格式化 → Markdown
    const title = sqlMatch?.title || searchTitle;
    const markdown = formatToMarkdown(trajectoryData, title);
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 60);
    const outputFile = path.join(__dirname, `${safeName}.md`);
    fs.writeFileSync(outputFile, markdown, 'utf-8');

    // 也保存原始 JSON
    const jsonFile = path.join(__dirname, `${safeName}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(trajectoryData, null, 2), 'utf-8');

    console.log(`\n✅ Markdown: ${outputFile} (${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB)`);
    console.log(`✅ JSON:     ${jsonFile} (${(fs.statSync(jsonFile).size / 1024).toFixed(1)} KB)`);
}

main().catch(err => console.error('Fatal:', err));
