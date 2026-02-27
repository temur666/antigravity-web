/**
 * probe-newchat-api.js — 探测 Antigravity 的 gRPC API 中是否有创建新对话的方法
 *
 * 策略:
 * 1. 连接 Manager 窗口
 * 2. 获取 CSRF token + 端口
 * 3. 探测 LanguageServerService 上的各种可能的 method name
 * 4. 在 Manager 中监听点击 "New Chat" 时触发的网络请求
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const outputFile = path.join(__dirname, 'probe-newchat-output.txt');

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

    log('═'.repeat(80));
    log('探测 Antigravity gRPC API — New Chat 方法');
    log('═'.repeat(80));
    log('');

    // 1. 连接 Manager
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    if (!manager) { log('❌ Manager 未找到'); return; }

    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    log('✅ 已连接 Manager');

    // 2. 获取端口
    const portResult = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(async () => {
            var entries = performance.getEntriesByType('resource');
            var ports = [];
            entries.forEach(function(e) {
                if (e.name.includes('LanguageServer')) {
                    try { var p = new URL(e.name).port; if (ports.indexOf(p) === -1) ports.push(p); } catch {}
                }
            });
            return JSON.stringify(ports);
        })()`, returnByValue: true, awaitPromise: true,
    }, 10000);
    const ports = JSON.parse(portResult.result.value);
    log(`✅ 端口: ${ports.join(', ')}`);

    // 3. 获取 CSRF Token — 触发一个简单请求
    await cdpSend(ws, 'Network.enable');
    if (ports.length > 0) {
        await cdpSend(ws, 'Runtime.evaluate', {
            expression: `fetch('https://127.0.0.1:${ports[0]}/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            })`, returnByValue: true, awaitPromise: true,
        }, 10000);
    }

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

    if (!csrfToken) { log('❌ CSRF Token 获取失败'); ws.close(); return; }
    log(`✅ CSRF: ${csrfToken.substring(0, 12)}...`);

    // 4. 探查所有 performance entries 中的 API 方法
    log('\n━━━ 所有 LanguageServer API 方法 (from performance entries) ━━━');
    const allMethods = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var methods = new Set();
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer')) {
                try {
                    var url = new URL(e.name);
                    methods.add(url.pathname);
                } catch {}
            }
        });
        return JSON.stringify(Array.from(methods));
    })()`);
    const methodList = JSON.parse(allMethods);
    log(`发现 ${methodList.length} 个不同的 API 路径:`);
    methodList.forEach(m => log(`  ${m}`));

    // 5. 尝试一系列可能的 API 方法名
    log('\n━━━ 探测可能的 New Chat API 方法 ━━━');
    const candidateMethods = [
        'CreateCascade',
        'CreateConversation',
        'NewCascade',
        'NewConversation',
        'NewChat',
        'CreateThread',
        'StartCascade',
        'StartConversation',
        'InitCascade',
        'InitConversation',
        'BeginCascade',
        'CreateCortexCascade',
        'CreateCascadeTrajectory',
        'CreateNewTrajectory',
        'SendCascadeMessage',
        'CascadeMessage',
        'AppendCascadeMessage',
        'StreamCascade',
        'StreamCascadeMessage',
        'ListCascadeMethods',
        'ListMethods',
        'GetServiceInfo',
        // 反射服务
        'grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo',
        'grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
    ];

    const port = ports[0];
    const baseUrl = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService`;

    for (const method of candidateMethods) {
        let url;
        if (method.includes('/')) {
            url = `https://127.0.0.1:${port}/${method}`;
        } else {
            url = `${baseUrl}/${method}`;
        }

        try {
            const res = await postAPI(url, {}, csrfToken);
            const statusInfo = res.status === 404 ? '❌ 404' :
                res.status === 200 ? '✅ 200' :
                    res.status === 400 ? '⚠️ 400 (方法存在!)' :
                        res.status === 500 ? '⚠️ 500 (方法可能存在!)' :
                            `❓ ${res.status}`;

            if (res.status !== 404) {
                log(`  ${statusInfo} — ${method}`);
                log(`    Body: ${res.body.substring(0, 500)}`);
            } else {
                log(`  ${statusInfo} — ${method}`);
            }
        } catch (e) {
            log(`  ❌ Error — ${method}: ${e.message}`);
        }
    }

    // 6. 在工作区中拦截 "New Chat" 按钮点击时的网络请求
    log('\n━━━ 监听 "New Chat" 按钮触发的网络请求 ━━━');

    // 找到工作区
    const workspaces = targets.filter(t =>
        t.type === 'page' &&
        t.url && t.url.includes('workbench.html') &&
        !t.url.includes('workbench-jetski-agent')
    );

    if (workspaces.length > 0) {
        const wsTarget = workspaces[0];
        const ws2 = new WebSocket(wsTarget.webSocketDebuggerUrl);
        await new Promise(r => ws2.on('open', r));
        await cdpSend(ws2, 'Runtime.enable');
        await cdpSend(ws2, 'Network.enable', { maxTotalBufferSize: 50000000 });
        log(`✅ 已连接工作区: ${wsTarget.title}`);

        const networkRequests = [];
        ws2.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent') {
                    const p = msg.params;
                    if (p.request.url.includes('LanguageServer') ||
                        p.request.url.includes('Cascade') ||
                        p.request.url.includes('cascade') ||
                        p.request.url.includes('conversation')) {
                        networkRequests.push({
                            url: p.request.url,
                            method: p.request.method,
                            headers: p.request.headers,
                            postData: p.request.postData || null,
                        });
                        console.log(`  📡 Intercepted: ${p.request.method} ${p.request.url}`);
                    }
                }
            } catch { }
        });

        // 也在 Manager 上开启 Network 监听
        await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 50000000 });
        const managerRequests = [];
        const managerHandler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent') {
                    const p = msg.params;
                    if (p.request.url.includes('LanguageServer') ||
                        p.request.url.includes('Cascade') ||
                        p.request.url.includes('cascade') ||
                        p.request.url.includes('conversation') ||
                        p.request.url.includes('Reactive')) {
                        managerRequests.push({
                            url: p.request.url,
                            method: p.request.method,
                            headers: p.request.headers,
                            postData: p.request.postData || null,
                        });
                        console.log(`  📡 Manager Intercepted: ${p.request.method} ${p.request.url}`);
                    }
                }
            } catch { }
        };
        ws.on('message', managerHandler);

        // 清空记录
        networkRequests.length = 0;
        managerRequests.length = 0;

        log('\n🖱️ 正在点击 "New Chat" 按钮...');

        // 在工作区中点击新建对话按钮
        const newChatBtn = await cdpEval(ws2, `(() => {
            let btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (!btn) btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
            if (!btn) return null;
            const rect = btn.getBoundingClientRect();
            return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
        })()`);

        if (newChatBtn) {
            const { x, y } = JSON.parse(newChatBtn);
            // 使用 CDP 的 Input.dispatchMouseEvent
            await cdpSend(ws2, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
            await sleep(50);
            await cdpSend(ws2, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
            log(`  ✅ 已点击 (${x}, ${y})`);
        } else {
            log('  ⚠️ 未找到 New Chat 按钮');
        }

        // 等待网络活动
        log('⏳ 等待网络活动 (5 秒)...');
        await sleep(5000);

        // 输出捕获到的请求
        log(`\n📡 工作区网络请求: ${networkRequests.length} 个`);
        for (const req of networkRequests) {
            log(`  ${req.method} ${req.url}`);
            if (req.postData) log(`    PostData: ${req.postData.substring(0, 500)}`);
            // 重要 headers
            for (const [k, v] of Object.entries(req.headers || {})) {
                if (/csrf|codeium|connect-protocol/i.test(k)) {
                    log(`    Header: ${k}: ${v.substring(0, 100)}`);
                }
            }
        }

        log(`\n📡 Manager 网络请求: ${managerRequests.length} 个`);
        for (const req of managerRequests) {
            log(`  ${req.method} ${req.url}`);
            if (req.postData) log(`    PostData: ${req.postData.substring(0, 500)}`);
            for (const [k, v] of Object.entries(req.headers || {})) {
                if (/csrf|codeium|connect-protocol/i.test(k)) {
                    log(`    Header: ${k}: ${v.substring(0, 100)}`);
                }
            }
        }

        ws.off('message', managerHandler);
        await cdpSend(ws2, 'Network.disable');
        ws2.close();
    } else {
        log('⚠️ 未找到工作区窗口');
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
