/**
 * get-csrf-and-test.js — 从 Manager 获取 CSRF，然后测试 SSH 端口的 StartCascade
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

    // === Part 1: 从 SSH 工作区获取端口和 API 方法 ===
    const ssh = targets.find(t => t.type === 'page' && t.title && t.title.includes('SSH'));
    if (!ssh) { console.log('No SSH workspace'); return; }

    const ws1 = new WebSocket(ssh.webSocketDebuggerUrl);
    await new Promise(r => ws1.on('open', r));
    await cdpSend(ws1, 'Runtime.enable');
    console.log('Connected to SSH workspace:', ssh.title);

    const perfRaw = await cdpEval(ws1, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = [], methods = [];
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer')) {
                try {
                    var url = new URL(e.name);
                    if (ports.indexOf(url.port) === -1) ports.push(url.port);
                    if (methods.indexOf(url.pathname) === -1) methods.push(url.pathname);
                } catch {}
            }
        });
        return JSON.stringify({ ports, methods });
    })()`);
    const perf = JSON.parse(perfRaw);
    console.log('SSH 端口:', perf.ports);
    console.log('SSH API 方法:', perf.methods);

    // 获取 CSRF - 直接在 SSH 工作区中监听
    await cdpSend(ws1, 'Network.enable');

    let csrfFromSSH = null;
    const sshHandler = raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const csrf = msg.params.request.headers['x-codeium-csrf-token'];
                if (csrf && !csrfFromSSH) {
                    csrfFromSSH = csrf;
                    console.log('SSH CSRF found:', csrf.substring(0, 20) + '...');
                }
            }
        } catch { }
    };
    ws1.on('message', sshHandler);

    // 触发请求
    for (const port of perf.ports) {
        console.log('Triggering fetch on port', port, '...');
        const fetchRes = await cdpSend(ws1, 'Runtime.evaluate', {
            expression: `(async () => {
                try {
                    var resp = await fetch('https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{}'
                    });
                    return 'status:' + resp.status;
                } catch(e) { return 'error:' + e.message; }
            })()`,
            returnByValue: true, awaitPromise: true,
        }, 10000);
        console.log('  Result:', fetchRes.result?.value);
    }

    await sleep(3000);
    ws1.off('message', sshHandler);

    // === Part 2: 如果SSH没拿到，从 Manager 获取 CSRF ===
    let csrf = csrfFromSSH;

    if (!csrf) {
        console.log('\nSSH CSRF not found, trying Manager...');
        const mgr = targets.find(t => t.type === 'page' && t.title === 'Manager');
        if (!mgr) { console.log('No Manager'); ws1.close(); return; }

        const ws2 = new WebSocket(mgr.webSocketDebuggerUrl);
        await new Promise(r => ws2.on('open', r));
        await cdpSend(ws2, 'Runtime.enable');
        await cdpSend(ws2, 'Network.enable');
        console.log('Connected to Manager');

        // 获取 Manager 中的端口
        const mgrPerf = await cdpEval(ws2, `(() => {
            var entries = performance.getEntriesByType('resource');
            var ports = [];
            entries.forEach(function(e) {
                if (e.name.includes('LanguageServer')) {
                    try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
                }
            });
            return JSON.stringify(ports);
        })()`);
        const mgrPorts = JSON.parse(mgrPerf || '[]');
        console.log('Manager 端口:', mgrPorts);

        // 触发请求
        for (const p of mgrPorts) {
            await cdpSend(ws2, 'Runtime.evaluate', {
                expression: `fetch('https://127.0.0.1:${p}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                }).then(r => r.status).catch(e => e.message)`,
                returnByValue: true, awaitPromise: true,
            }, 10000);
        }

        csrf = await new Promise(resolve => {
            const h = raw => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.method === 'Network.requestWillBeSent' && msg.params.request.headers['x-codeium-csrf-token']) {
                        ws2.off('message', h); resolve(msg.params.request.headers['x-codeium-csrf-token']);
                    }
                } catch { }
            };
            ws2.on('message', h);
            setTimeout(() => { ws2.off('message', h); resolve(null); }, 5000);
        });
        console.log('Manager CSRF:', csrf ? csrf.substring(0, 20) + '...' : 'null');
        ws2.close();
    }

    if (!csrf) {
        console.log('❌ 无法获取 CSRF Token');
        ws1.close();
        return;
    }

    // === Part 3: 用 CSRF Token 测试 SSH 端口上的方法 ===
    const sshPort = perf.ports[0];
    const baseUrl = `https://127.0.0.1:${sshPort}/exa.language_server_pb.LanguageServerService`;

    console.log('\n═══ 测试 API 方法 ═══');
    console.log('CSRF:', csrf.substring(0, 20) + '...');
    console.log('Port:', sshPort);

    // 测试 StartCascade
    console.log('\n--- StartCascade (空 body) ---');
    try {
        const res = await postAPI(`${baseUrl}/StartCascade`, {}, csrf);
        console.log('Status:', res.status);
        console.log('Body:', res.body.substring(0, 2000));
    } catch (e) { console.log('Error:', e.message); }

    // 测试 SendUserCascadeMessage
    console.log('\n--- SendUserCascadeMessage (空 body) ---');
    try {
        const res = await postAPI(`${baseUrl}/SendUserCascadeMessage`, {}, csrf);
        console.log('Status:', res.status);
        console.log('Body:', res.body.substring(0, 2000));
    } catch (e) { console.log('Error:', e.message); }

    // 测试其他可能的方法
    const extras = [
        'CreateCascade', 'CreateConversation', 'NewCascade',
        'InitCascade', 'GetCascadeTrajectory', 'RefreshMcpServers',
        'GetCommandModelConfigs', 'ListPages', 'GetUnleashData',
    ];
    console.log('\n--- 探测其他方法 ---');
    for (const method of extras) {
        try {
            const res = await postAPI(`${baseUrl}/${method}`, {}, csrf);
            const tag = res.status === 404 ? '404' :
                res.status === 200 ? '✅200' :
                    res.status === 400 ? '⚠️400' :
                        res.status === 500 ? '⚠️500' : res.status;
            if (res.status !== 404) {
                console.log(`  ${tag} ${method}: ${res.body.substring(0, 200)}`);
            } else {
                console.log(`  ${tag} ${method}`);
            }
        } catch (e) { console.log(`  ERR ${method}: ${e.message}`); }
    }

    // === Part 4: 监听 New Chat 按钮网络活动 ===
    console.log('\n═══ 监听 New Chat 网络活动 ═══');

    const captured = [];
    const nwHandler = raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                if (p.request.url.includes('127.0.0.1') && !p.request.url.includes('9000')) {
                    captured.push({
                        url: p.request.url,
                        method: p.request.method,
                        postData: p.request.postData,
                        headers: p.request.headers,
                    });
                    console.log('📡', p.request.method, p.request.url);
                    if (p.request.postData) console.log('   PostData:', p.request.postData.substring(0, 300));
                }
            }
        } catch { }
    };
    ws1.on('message', nwHandler);

    // 点击 New Chat
    const btnRaw = await cdpEval(ws1, `(() => {
        let btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (!btn) btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
    })()`);

    if (btnRaw) {
        const { x, y } = JSON.parse(btnRaw);
        console.log('Clicking New Chat at', x, y);
        await cdpSend(ws1, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(50);
        await cdpSend(ws1, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else {
        console.log('❌ New Chat 按钮未找到');
    }

    console.log('Waiting 6 seconds...');
    await sleep(6000);
    ws1.off('message', nwHandler);

    console.log('\n═══ 捕获到', captured.length, '个请求 ═══');
    for (const req of captured) {
        console.log(`${req.method} ${req.url}`);
        if (req.postData) console.log(`  PostData: ${req.postData.substring(0, 500)}`);
    }

    await cdpSend(ws1, 'Network.disable');
    ws1.close();
    console.log('\n✅ 完成');
}

main().catch(err => console.error('Fatal:', err));
