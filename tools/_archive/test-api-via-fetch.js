/**
 * test-api-via-manager-fetch.js  
 * 通过 Manager 窗口的 fetch 代理 API 调用，绕过 CSRF Token 问题
 * Manager 窗口中的 fetch 会自动附带 x-codeium-csrf-token header
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
    const targets = await httpGet('http://127.0.0.1:9000/json');

    // ==== Step 1: 从各窗口收集所有端口 ====
    console.log('═══ 收集所有 gRPC 端口 ═══\n');
    const allPorts = new Set();
    const portWindows = new Map(); // port -> window title

    for (const t of targets.filter(t => t.type === 'page')) {
        try {
            const ws = new WebSocket(t.webSocketDebuggerUrl);
            await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); setTimeout(() => j('timeout'), 3000); });
            await cdpSend(ws, 'Runtime.enable');
            const raw = await cdpEval(ws, `(() => {
                var entries = performance.getEntriesByType('resource');
                var ports = [];
                entries.forEach(function(e) {
                    if (e.name.includes('LanguageServer')) {
                        try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
                    }
                });
                return JSON.stringify(ports);
            })()`);
            const ports = JSON.parse(raw || '[]');
            ports.forEach(p => { allPorts.add(p); portWindows.set(p, t.title); });
            if (ports.length > 0) console.log(`  ${t.title}: ${ports.join(', ')}`);
            ws.close();
        } catch { }
    }

    console.log(`\n共发现 ${allPorts.size} 个端口: ${[...allPorts].join(', ')}`);

    // ==== Step 2: 连接 SSH 工作区，通过它的 fetch 代理测试 ====
    console.log('\n═══ 通过 SSH 工作区 fetch 代理测试 API ═══\n');

    const ssh = targets.find(t => t.type === 'page' && t.title && t.title.includes('SSH'));
    if (!ssh) { console.log('No SSH workspace'); return; }

    const ws = new WebSocket(ssh.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    console.log('Connected to:', ssh.title);

    // 获取 SSH 工作区自己的端口
    const sshPortRaw = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = [];
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer')) {
                try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
            }
        });
        return JSON.stringify(ports);
    })()`);
    const sshPorts = JSON.parse(sshPortRaw || '[]');
    const sshPort = sshPorts[0];
    console.log('SSH Port:', sshPort);

    // 通过工作区内 fetch 调用（浏览器自动带 CSRF）
    const methodsToTest = [
        { name: 'StartCascade', body: {} },
        { name: 'SendUserCascadeMessage', body: {} },
        { name: 'GetCascadeTrajectory', body: {} },
        { name: 'GetAgentScripts', body: {} },
        { name: 'GetCommandModelConfigs', body: {} },
        { name: 'ListPages', body: {} },
        { name: 'GetUnleashData', body: {} },
        { name: 'GetMcpServerStates', body: {} },
        { name: 'RefreshMcpServers', body: {} },
        // 猜测的
        { name: 'CreateCascade', body: {} },
        { name: 'NewCascade', body: {} },
        { name: 'InitCascade', body: {} },
    ];

    for (const { name, body } of methodsToTest) {
        const result = await cdpSend(ws, 'Runtime.evaluate', {
            expression: `(async () => {
                try {
                    var resp = await fetch('https://127.0.0.1:${sshPort}/exa.language_server_pb.LanguageServerService/${name}', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(${JSON.stringify(body)})
                    });
                    var text = await resp.text();
                    return JSON.stringify({ status: resp.status, body: text.substring(0, 1000) });
                } catch(e) { return JSON.stringify({ error: e.message }); }
            })()`,
            returnByValue: true, awaitPromise: true,
        }, 15000);

        const val = result.result?.value;
        if (!val) { console.log(`  ❓ ${name}: no result`); continue; }
        const data = JSON.parse(val);
        if (data.error) {
            console.log(`  ❌ ${name}: ${data.error}`);
        } else if (data.status === 404) {
            console.log(`  ❌ ${name}: 404`);
        } else {
            console.log(`  ${data.status === 200 ? '✅' : '⚠️'} ${name} [${data.status}]: ${data.body.substring(0, 300)}`);
        }
    }

    // ==== Step 3: 测试 StartCascade 的各种参数 ====
    console.log('\n═══ 测试 StartCascade 参数 ═══\n');

    const startCascadeTests = [
        { label: '空 body', body: {} },
        { label: 'workspacePath', body: { workspacePath: '/home/tiemuer' } },
        { label: 'cascadeId (new UUID)', body: { cascadeId: '00000000-0000-0000-0000-000000000001' } },
        { label: 'model', body: { model: 'MODEL_PLACEHOLDER_M37' } },
        { label: 'cascadeType', body: { cascadeType: 'CORTEX_TRAJECTORY_TYPE_CASCADE' } },
        { label: 'conversationId + workspacePath', body: { conversationId: '00000000-0000-0000-0000-000000000001', workspacePath: '/home/tiemuer' } },
    ];

    for (const { label, body } of startCascadeTests) {
        const result = await cdpSend(ws, 'Runtime.evaluate', {
            expression: `(async () => {
                try {
                    var resp = await fetch('https://127.0.0.1:${sshPort}/exa.language_server_pb.LanguageServerService/StartCascade', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(${JSON.stringify(body)})
                    });
                    var text = await resp.text();
                    return JSON.stringify({ status: resp.status, body: text.substring(0, 1000) });
                } catch(e) { return JSON.stringify({ error: e.message }); }
            })()`,
            returnByValue: true, awaitPromise: true,
        }, 15000);

        const val = result.result?.value;
        if (!val) { console.log(`  ❓ ${label}: no result`); continue; }
        const data = JSON.parse(val);
        console.log(`  ${label}: [${data.status}] ${(data.body || data.error || '').substring(0, 300)}`);
    }

    // ==== Step 4: 监听 New Chat 按钮 ====
    console.log('\n═══ 监听 New Chat 网络活动 ═══\n');

    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 50000000 });

    const captured = [];
    const nwHandler = raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                if (p.request.url.includes('127.0.0.1') && !p.request.url.includes(':9000')) {
                    captured.push({
                        url: p.request.url,
                        method: p.request.method,
                        postData: p.request.postData,
                    });
                    console.log('📡', p.request.method, p.request.url);
                    if (p.request.postData) console.log('   Body:', p.request.postData.substring(0, 500));
                }
            }
        } catch { }
    };
    ws.on('message', nwHandler);

    // 点击 New Chat
    const btnRaw = await cdpEval(ws, `(() => {
        let btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (!btn) btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
    })()`);

    if (btnRaw) {
        const { x, y } = JSON.parse(btnRaw);
        console.log('Clicking New Chat at', x, y);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(50);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        console.log('✅ Clicked');
    } else {
        console.log('❌ New Chat 按钮未找到');
    }

    console.log('Waiting 6 seconds...');
    await sleep(6000);
    ws.off('message', nwHandler);

    console.log(`\n═══ 捕获到 ${captured.length} 个请求 ═══`);
    for (const req of captured) {
        console.log(`  ${req.method} ${req.url}`);
        if (req.postData) console.log(`    Body: ${req.postData.substring(0, 500)}`);
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();
    console.log('\n✅ 完成');
}

main().catch(err => console.error('Fatal:', err));
