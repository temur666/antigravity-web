/**
 * export-v2.js — 通过 CDP Fetch 拦截获取 CSRF，然后导出对话
 */
const { httpGet, cdpSend, sleep } = require('../lib/cdp');
const { clickAt } = require('../lib/ide');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const mgr = targets.find(t => t.type === 'page' && t.title === 'Manager');
    const ws = new WebSocket(mgr.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable');
    console.log('✅ Manager 已连接');

    // 方法: 用 Fetch domain 来拦截请求获取 CSRF
    // 先启用 Fetch 拦截
    await cdpSend(ws, 'Fetch.enable', {
        patterns: [{ urlPattern: '*LanguageServer*', requestStage: 'Request' }],
    });

    let csrf = null, port = null;
    const fetchHandler = (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Fetch.requestPaused') {
                const headers = msg.params.request.headers;
                if (headers['x-codeium-csrf-token']) {
                    csrf = headers['x-codeium-csrf-token'];
                    port = new URL(msg.params.request.url).port;
                    console.log(`✅ CSRF 拦截到: ${csrf}`);
                    console.log(`✅ Port: ${port}`);
                }
                // 继续请求
                cdpSend(ws, 'Fetch.continueRequest', { requestId: msg.params.requestId }).catch(() => { });
            }
        } catch { }
    };
    ws.on('message', fetchHandler);

    // 触发: 点击侧边栏中一个对话
    console.log('\n🖱️ 触发请求...');

    // 先获取当前可点击的元素
    const clickables = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(() => {
            var items = document.querySelectorAll('.cursor-pointer');
            var result = [];
            items.forEach(function(item, i) {
                var text = (item.innerText || '').trim().split(String.fromCharCode(10))[0];
                if (text.length > 5 && text.length < 60) {
                    var rect = item.getBoundingClientRect();
                    if (rect.width > 100 && rect.height > 20 && rect.y > 100) {
                        result.push({ i: i, t: text, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
                    }
                }
            });
            return JSON.stringify(result);
        })()`,
        returnByValue: true,
    });

    const items = JSON.parse(clickables.result.value);
    console.log(`找到 ${items.length} 个可点击对话:`);
    items.slice(0, 5).forEach(i => console.log(`  "${i.t}" (${i.x}, ${i.y})`));

    // 点击第一个看起来像对话的
    const target = items.find(i => !['Start conversation', 'Inbox', 'Open Workspace'].some(s => i.t.includes(s)));
    if (target) {
        console.log(`\n点击: "${target.t}"`);
        await clickAt(ws, target.x, target.y);
    }

    // 等待 CSRF
    console.log('等待 CSRF token...');
    for (let i = 0; i < 10 && !csrf; i++) {
        await sleep(500);
    }

    await cdpSend(ws, 'Fetch.disable').catch(() => { });
    ws.off('message', fetchHandler);

    if (!csrf) {
        console.log('❌ CSRF 未获取到');
        // 最后尝试: 直接从 Network 事件中查看已有的请求
        await cdpSend(ws, 'Network.disable');
        ws.close();
        return;
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    // 调用 API
    const cascadeId = '573834e1-3029-447c-9870-7021bcfd02a8';
    console.log(`\n📡 GetCascadeTrajectory for ${cascadeId}...`);

    for (const p of [port, '33071', '63243', '59513']) {
        try {
            const data = JSON.stringify({ cascadeId });
            const res = await new Promise((ok, fail) => {
                const req = https.request({
                    hostname: '127.0.0.1', port: p,
                    path: '/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data),
                        'x-codeium-csrf-token': csrf,
                        'connect-protocol-version': '1',
                    },
                    rejectUnauthorized: false,
                }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => ok({ s: r.statusCode, b: d })); });
                req.on('error', fail); req.write(data); req.end();
            });

            console.log(`  Port ${p}: ${res.s}, ${res.b.length} bytes`);

            if (res.s === 200 && res.b.length > 200) {
                // 保存 JSON
                fs.writeFileSync(path.join(__dirname, 'AI_Design_Tool_Development.json'), res.b, 'utf-8');
                console.log(`  ✅ JSON 已保存`);

                // 格式化 Markdown
                const traj = JSON.parse(res.b);
                const md = formatMD(traj);
                fs.writeFileSync(path.join(__dirname, 'AI_Design_Tool_Development.md'), md, 'utf-8');
                console.log(`  ✅ MD 已保存 (${(md.length / 1024).toFixed(1)} KB)`);
                break;
            }
        } catch (e) { console.log(`  Port ${p}: ${e.message}`); }
    }
}

function formatMD(data) {
    const t = data.trajectory;
    const md = [];
    md.push(`# AI Design Tool Development\n`);
    md.push(`> Cascade ID: \`${t.cascadeId}\`  `);
    md.push(`> Created: ${t.metadata?.createdAt || ''}  `);
    md.push(`> Steps: ${t.steps?.length || 0}\n`);
    md.push('---\n');

    let turn = 0;
    for (const step of (t.steps || [])) {
        const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
        if (type === 'USER_INPUT') {
            turn++;
            const ui = step.userInput || {};
            md.push(`## Turn ${turn}\n`);
            md.push(`### 👤 User\n`);
            md.push((ui.userResponse || ui.items?.map(i => i.text).join('\n') || '') + '\n');
        }
        if (type === 'PLANNER_RESPONSE') {
            const pr = step.plannerResponse || {};
            md.push(`### 🤖 Assistant\n`);
            if (pr.rawThinkingText) {
                md.push(`<details><summary>🧠 Thinking</summary>\n\n${pr.rawThinkingText}\n\n</details>\n`);
            }
            for (const [k, v] of Object.entries(pr)) {
                if (['rawThinkingText', 'metadata', 'messageId', 'stopReason', 'steps'].includes(k)) continue;
                if (typeof v === 'string' && v.length > 0) { md.push(v + '\n'); }
            }
            md.push('---\n');
        }
        if (type === 'SEARCH_WEB') {
            const sw = step.searchWeb || {};
            md.push(`#### 🔍 Search: ${sw.query || ''}\n`);
            for (const r of (sw.results || [])) md.push(`- [${r.title || ''}](${r.url || ''})`);
            md.push('');
        }
        if (type === 'CHECKPOINT' && step.checkpoint?.userIntent) {
            md.push(`> 📌 ${step.checkpoint.userIntent.split('\n')[0]}\n`);
        }
    }
    return md.join('\n');
}

main().catch(err => console.error('Fatal:', err));
