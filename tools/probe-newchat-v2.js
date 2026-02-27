/**
 * probe-newchat-v2.js — 从 SSH 工作区窗口探测 New Chat API
 * 
 * 1. 连接 SSH 工作区
 * 2. 获取 CSRF token + 端口 (从工作区的 performance entries)
 * 3. 列出所有已知 API 方法
 * 4. 监听 "New Chat" 点击时的网络活动
 * 5. 暴力探测候选方法名
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const outputFile = path.join(__dirname, 'probe-newchat-v2-output.txt');

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
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };
    const save = () => fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');

    log('═'.repeat(80));
    log('探测 New Chat API (v2 — 从 SSH 工作区)');
    log('═'.repeat(80));
    log('');

    // 1. 找到 SSH 工作区
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const sshTarget = targets.find(t => t.type === 'page' && t.title && t.title.includes('SSH'));
    if (!sshTarget) {
        log('❌ 未找到 SSH 工作区');
        log('可用目标:');
        targets.filter(t => t.type === 'page').forEach(t => log(`  [${t.type}] ${t.title}`));
        save();
        return;
    }
    log(`✅ 找到 SSH 工作区: ${sshTarget.title}`);

    const ws = new WebSocket(sshTarget.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    log('✅ 已连接');

    // 2. 获取端口 + 所有 API 方法
    log('\n━━━ 从 performance entries 获取端口和 API 方法 ━━━');
    const perfResult = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = [];
        var methods = [];
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer') || e.name.includes('language_server')) {
                try {
                    var url = new URL(e.name);
                    var p = url.port;
                    if (ports.indexOf(p) === -1) ports.push(p);
                    if (methods.indexOf(url.pathname) === -1) methods.push(url.pathname);
                } catch {}
            }
        });
        return JSON.stringify({ ports, methods });
    })()`);

    if (!perfResult) {
        log('❌ 无法获取 performance entries');
        ws.close(); save(); return;
    }

    const perf = JSON.parse(perfResult);
    log(`端口: ${perf.ports.join(', ')}`);
    log(`已知 API 方法 (${perf.methods.length}):`);
    perf.methods.forEach(m => log(`  ${m}`));

    if (perf.ports.length === 0) {
        log('❌ 没有找到任何端口');
        ws.close(); save(); return;
    }

    // 3. 获取 CSRF Token — 开启 Network，触发一个请求
    log('\n━━━ 获取 CSRF Token ━━━');
    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 50000000 });

    const port = perf.ports[0];

    // 触发一个简单请求
    await cdpSend(ws, 'Runtime.evaluate', {
        expression: `fetch('https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }).then(r => r.status).catch(e => e.message)`,
        returnByValue: true, awaitPromise: true,
    }, 10000);

    // 等待并拦截 CSRF
    const csrfToken = await new Promise(resolve => {
        const handler = raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent') {
                    const csrf = msg.params.request.headers['x-codeium-csrf-token'];
                    if (csrf) {
                        ws.off('message', handler);
                        resolve(csrf);
                    }
                }
            } catch { }
        };
        ws.on('message', handler);
        setTimeout(() => { ws.off('message', handler); resolve(null); }, 8000);
    });

    if (!csrfToken) {
        log('❌ CSRF Token 获取失败');
        // 尝试其他端口
        for (const p of perf.ports.slice(1)) {
            log(`尝试端口 ${p}...`);
            await cdpSend(ws, 'Runtime.evaluate', {
                expression: `fetch('https://127.0.0.1:${p}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                }).then(r => r.status).catch(e => e.message)`,
                returnByValue: true, awaitPromise: true,
            }, 10000);
        }
        const csrfRetry = await new Promise(resolve => {
            const handler = raw => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.method === 'Network.requestWillBeSent') {
                        const csrf = msg.params.request.headers['x-codeium-csrf-token'];
                        if (csrf) { ws.off('message', handler); resolve(csrf); }
                    }
                } catch { }
            };
            ws.on('message', handler);
            setTimeout(() => { ws.off('message', handler); resolve(null); }, 5000);
        });
        if (!csrfRetry) {
            log('❌ 所有端口均无法获取 CSRF Token');
            ws.close(); save(); return;
        }
    }

    const csrf = csrfToken || '';
    log(`✅ CSRF: ${csrf.substring(0, 16)}...`);

    // 4. 监听 "New Chat" 点击时的网络活动
    log('\n━━━ 阶段 1: 监听 "New Chat" 网络活动 ━━━');

    const capturedRequests = [];
    const capturedRequestIds = new Map();
    const networkHandler = raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                const url = p.request.url;
                // 捕获所有 HTTPS 本地请求 (gRPC API)
                if (url.includes('127.0.0.1') || url.includes('localhost') || url.includes('LanguageServer')) {
                    const entry = {
                        requestId: p.requestId,
                        url,
                        method: p.request.method,
                        headers: p.request.headers,
                        postData: p.request.postData || null,
                    };
                    capturedRequests.push(entry);
                    capturedRequestIds.set(p.requestId, entry);
                    console.log(`  📡 ${p.request.method} ${url}`);
                }
            }
            if (msg.method === 'Network.responseReceived') {
                const entry = capturedRequestIds.get(msg.params.requestId);
                if (entry) {
                    entry.responseStatus = msg.params.response.status;
                    entry.responseHeaders = msg.params.response.headers;
                }
            }
            if (msg.method === 'Network.loadingFinished') {
                const entry = capturedRequestIds.get(msg.params.requestId);
                if (entry) entry._finished = true;
            }
        } catch { }
    };
    ws.on('message', networkHandler);

    // 清空已有请求
    capturedRequests.length = 0;

    // 点击 New Chat 按钮
    log('🖱️ 点击 "New Chat" 按钮...');
    const btnRaw = await cdpEval(ws, `(() => {
        let btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (!btn) btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), w: rect.width, h: rect.height });
    })()`);

    if (btnRaw) {
        const { x, y, w, h } = JSON.parse(btnRaw);
        log(`  按钮位置: (${x}, ${y}), 大小: ${w}x${h}`);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(50);
        await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        log('  ✅ 已点击');
    } else {
        log('  ⚠️ 未找到 New Chat 按钮');
    }

    log('⏳ 等待网络活动 (6 秒)...');
    await sleep(6000);

    ws.off('message', networkHandler);

    // 输出捕获的请求
    log(`\n📡 捕获到 ${capturedRequests.length} 个网络请求:`);
    for (const req of capturedRequests) {
        log(`\n  ${req.method} ${req.url}`);
        log(`    Status: ${req.responseStatus || 'pending'}`);
        if (req.postData) log(`    PostData: ${req.postData.substring(0, 1000)}`);
        // 显示关键 headers
        for (const [k, v] of Object.entries(req.headers || {})) {
            if (/csrf|codeium|connect-protocol|content-type/i.test(k)) {
                log(`    Header: ${k}: ${String(v).substring(0, 100)}`);
            }
        }

        // 获取 response body
        if (req._finished) {
            try {
                const bodyResult = await cdpSend(ws, 'Network.getResponseBody', { requestId: req.requestId }, 3000);
                const body = bodyResult.body || '';
                if (bodyResult.base64Encoded) {
                    const decoded = Buffer.from(body, 'base64').toString('utf-8');
                    log(`    Response (decoded, ${decoded.length} bytes): ${decoded.substring(0, 500)}`);
                } else {
                    log(`    Response (${body.length} bytes): ${body.substring(0, 500)}`);
                }
            } catch (e) {
                log(`    Response: <获取失败: ${e.message}>`);
            }
        }
    }

    // 5. 暴力探测候选方法名
    log('\n━━━ 阶段 2: 暴力探测候选 API 方法 ━━━');
    const candidateMethods = [
        'CreateCascade', 'CreateConversation', 'NewCascade', 'NewConversation',
        'StartCascade', 'StartConversation', 'InitCascade', 'InitConversation',
        'CreateCascadeTrajectory', 'CreateThread', 'NewChat', 'NewThread',
        'SendCascadeMessage', 'CascadeMessage', 'AppendCascadeMessage',
        'StreamCascade', 'StreamCascadeMessage', 'BeginCascade',
        'CreateCortexCascade', 'CreateNewTrajectory', 'CreateTrajectory',
        'ListMethods', 'GetServiceInfo', 'Reflect',
    ];

    const baseUrl = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService`;

    for (const method of candidateMethods) {
        const url = `${baseUrl}/${method}`;
        try {
            const res = await postAPI(url, {}, csrf);
            const tag = res.status === 404 ? '❌ 404' :
                res.status === 200 ? '✅ 200' :
                    res.status === 400 ? '⚠️ 400 (exists!)' :
                        res.status === 500 ? '⚠️ 500 (exists!)' :
                            `❓ ${res.status}`;
            if (res.status !== 404) {
                log(`  ${tag} — ${method}`);
                log(`    Body: ${res.body.substring(0, 500)}`);
            } else {
                log(`  ${tag} — ${method}`);
            }
        } catch (e) {
            log(`  ❌ Error — ${method}: ${e.message}`);
        }
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();
    save();
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
