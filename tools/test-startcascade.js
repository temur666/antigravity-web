/**
 * test-startcascade.js — 通过 Manager 窗口 fetch 代理方式调用 StartCascade
 * 
 * 关键思路：Manager 窗口的 fetch 会自动附带 x-codeium-csrf-token
 * 但 Manager 的 performance entries 只有 59289 和 60432 (本地工作区)
 * SSH 工作区的端口是 36117
 * 
 * 策略：
 * 1. 从 Manager fetch 触发请求，通过 Network 拦截 CSRF token
 * 2. 用拦截到的 CSRF token 直接调用 SSH 端口的 StartCascade
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const https = require('https');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function main() {
    const targets = await httpGet('http://127.0.0.1:9000/json');

    // 找到各窗口
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    const ssh = targets.find(t => t.type === 'page' && t.title && t.title.includes('SSH'));
    const localWs = targets.find(t => t.type === 'page' && t.title && t.title.includes('antigravity-web'));

    if (!manager) { console.log('❌ No Manager'); return; }
    console.log('Manager found');

    // ==== Step 1: 连接 Manager，开启 Network 监听 ====
    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable');
    console.log('✅ Connected to Manager, Network enabled');

    // 获取 Manager 端口
    const mgrPortRaw = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = [];
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer')) {
                try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
            }
        });
        return JSON.stringify(ports);
    })()`);
    const mgrPorts = JSON.parse(mgrPortRaw || '[]');
    console.log('Manager ports:', mgrPorts);

    // ==== Step 2: 注册 CSRF 拦截器 ====
    let csrfToken = null;
    let csrfResolve = null;
    const csrfPromise = new Promise(resolve => {
        csrfResolve = resolve;
        setTimeout(() => resolve(null), 10000);
    });

    const networkHandler = raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const csrf = msg.params.request.headers['x-codeium-csrf-token'];
                if (csrf && !csrfToken) {
                    csrfToken = csrf;
                    console.log('🔑 CSRF intercepted:', csrf.substring(0, 20) + '...');
                    csrfResolve(csrf);
                }
            }
        } catch { }
    };
    ws.on('message', networkHandler);

    // ==== Step 3: 在 Manager 中点击一个对话来触发 API 请求 ====
    // Manager 的对话切换会触发 GetCascadeTrajectory，从中可以拿到 CSRF
    console.log('\n🖱️ 在 Manager 中触发 API 请求...');

    // 在 Manager 侧边栏中找到一个对话项并点击
    const clickResult = await cdpEval(ws, `(() => {
        // 找到侧边栏中的对话列表项
        var items = document.querySelectorAll('.cursor-pointer');
        for (var i = 0; i < items.length; i++) {
            var text = (items[i].innerText || '').trim();
            // 找一个看起来像对话标题的元素
            if (text.length > 5 && text.length < 200) {
                var rect = items[i].getBoundingClientRect();
                if (rect.width > 50 && rect.height > 10 && rect.y > 0) {
                    return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text: text.substring(0, 80) });
                }
            }
        }
        return null;
    })()`);

    if (clickResult) {
        const { x, y, text } = JSON.parse(clickResult);
        console.log(`  点击: "${text}" at (${x}, ${y})`);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(50);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else {
        // 备选：直接用 Manager 端口 fetch
        console.log('  未找到对话项，用 fetch 触发...');
        for (const p of mgrPorts) {
            await cdpSend(ws, 'Runtime.evaluate', {
                expression: `fetch('https://127.0.0.1:${p}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                }).then(r => r.status)`,
                returnByValue: true, awaitPromise: true,
            }, 10000);
        }
    }

    console.log('⏳ Waiting for CSRF token...');
    const csrf = await csrfPromise;
    ws.off('message', networkHandler);

    if (!csrf) {
        console.log('❌ CSRF Token 获取失败');

        // 最后尝试：直接在工作区窗口中用 fetch 代理（可能对本地工作区有效）
        if (localWs) {
            console.log('\n尝试从本地工作区 fetch...');
            const ws2 = new WebSocket(localWs.webSocketDebuggerUrl);
            await new Promise(r => ws2.on('open', r));
            await cdpSend(ws2, 'Runtime.enable');

            // 在本地工作区中直接调用 StartCascade (本地工作区端口 60432)
            const result = await cdpSend(ws2, 'Runtime.evaluate', {
                expression: `(async () => {
                    try {
                        var resp = await fetch('https://127.0.0.1:60432/exa.language_server_pb.LanguageServerService/StartCascade', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        var text = await resp.text();
                        return JSON.stringify({ status: resp.status, body: text.substring(0, 2000) });
                    } catch(e) { return JSON.stringify({ error: e.message }); }
                })()`,
                returnByValue: true, awaitPromise: true,
            }, 15000);
            console.log('Local workspace StartCascade result:', result.result?.value);
            ws2.close();
        }

        ws.close();
        return;
    }

    // ==== Step 4: 用 CSRF Token 测试 StartCascade ====
    console.log('\n═══ 测试 StartCascade ═══\n');

    // 测试所有端口
    const allPorts = [...new Set([...mgrPorts, '36117'])];

    for (const port of allPorts) {
        console.log(`\n--- Port ${port} ---`);

        // 空 body
        try {
            const res = await postAPI(
                `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/StartCascade`,
                {},
                csrf
            );
            console.log(`  StartCascade {}: [${res.status}] ${res.body.substring(0, 500)}`);
        } catch (e) { console.log(`  StartCascade: Error - ${e.message}`); }

        // SendUserCascadeMessage
        try {
            const res = await postAPI(
                `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`,
                {},
                csrf
            );
            console.log(`  SendUserCascadeMessage {}: [${res.status}] ${res.body.substring(0, 500)}`);
        } catch (e) { console.log(`  SendUserCascadeMessage: Error - ${e.message}`); }
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();
    console.log('\n✅ 完成');
}

main().catch(err => console.error('Fatal:', err));
