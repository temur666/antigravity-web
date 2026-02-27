/**
 * get-trajectory.js — 使用正确的 CSRF token 和 API 获取对话内容
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { httpGet, cdpSend, cdpEval } = require('../lib/cdp');
const WebSocket = require('ws');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function postAPI(url, body, csrfToken) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const urlObj = new URL(url);
        const req = https.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-codeium-csrf-token': csrfToken,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: responseData, headers: res.headers }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    // 1. 从 Manager 获取 CSRF token
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable');

    // 等一下抓取一个existing request的header
    let csrfToken = null;
    let port = null;

    // 尝试从 cookies 或存储中获取 CSRF
    const csrfFromPage = await cdpEval(ws, `(() => {
        // 检查 cookies
        var cookies = document.cookie;
        // 检查 localStorage / sessionStorage
        var csrf = null;
        try { csrf = localStorage.getItem('x-codeium-csrf-token'); } catch {}
        try { if (!csrf) csrf = sessionStorage.getItem('x-codeium-csrf-token'); } catch {}
        return JSON.stringify({ cookies: cookies, csrf: csrf });
    })()`);
    console.log('Page storage:', csrfFromPage);

    // 从 Network 拦截获取
    const csrfPromise = new Promise((resolve) => {
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent') {
                    const h = msg.params.request.headers;
                    if (h['x-codeium-csrf-token']) {
                        const tok = h['x-codeium-csrf-token'];
                        const url = new URL(msg.params.request.url);
                        ws.off('message', handler);
                        resolve({ token: tok, port: url.port });
                    }
                }
            } catch { }
        };
        ws.on('message', handler);
        // 也设超时 - 如果3秒内没抓到就手动触发
        setTimeout(() => resolve(null), 3000);
    });

    // 触发一个请求来获取 CSRF (用 UpdateConversationAnnotations)
    const triggerResult = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(async () => {
            // 找到performance entries里的端口
            var entries = performance.getEntriesByType('resource');
            var port = null;
            for (var i = entries.length - 1; i >= 0; i--) {
                if (entries[i].name.includes('LanguageServer')) {
                    port = new URL(entries[i].name).port;
                    break;
                }
            }
            if (!port) return JSON.stringify({error: 'no port found'});
            
            // 发一个简单请求
            try {
                var resp = await fetch('https://127.0.0.1:' + port + '/exa.language_server_pb.LanguageServerService/GetAgentScripts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                return JSON.stringify({ port: port, status: resp.status });
            } catch(e) {
                return JSON.stringify({ error: e.message });
            }
        })()`,
        returnByValue: true,
        awaitPromise: true,
    }, 10000);
    console.log('Trigger result:', triggerResult.result?.value);

    const csrfResult = await csrfPromise;
    if (csrfResult) {
        csrfToken = csrfResult.token;
        port = csrfResult.port;
        console.log(`✅ CSRF Token: ${csrfToken}`);
        console.log(`✅ Port: ${port}`);
    } else {
        // 使用之前捕获的 token
        csrfToken = process.env.CSRF_TOKEN || 'YOUR_CSRF_TOKEN_HERE';
        port = '33071';
        console.log(`⚠️ 使用缓存的 CSRF Token`);
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    // 2. 用不同的 conversation ID 尝试
    const conversationIds = [
        'c43d01af-4bd8-4105-82f7-9cd3ae9fe152', // SSH remote 上最新的
        '038f30bc-a7ab-4c79-8138-020d5da87d59', // SSH remote 上的另一个
    ];

    const methods = [
        'GetCascadeTrajectory',
        'StreamCascadeReactiveUpdates',
    ];

    for (const cascadeId of conversationIds) {
        for (const method of methods) {
            console.log(`\n━━━ ${method} (${cascadeId.substring(0, 8)}..., port ${port}) ━━━`);
            try {
                const url = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/${method}`;

                let body;
                if (method === 'StreamCascadeReactiveUpdates') {
                    body = { protocolVersion: 1, id: cascadeId, subscriberId: 'local-agent-client-main' };
                } else {
                    body = { cascadeId: cascadeId };
                }

                const res = await postAPI(url, body, csrfToken);
                console.log(`Status: ${res.status}`);
                console.log(`Content-Type: ${res.headers['content-type']}`);
                console.log(`Body (${res.body.length} bytes):`);

                if (res.body.length > 0) {
                    // 保存大响应到文件
                    if (res.body.length > 500) {
                        const fname = `trajectory-${cascadeId.substring(0, 8)}-${method}.json`;
                        fs.writeFileSync(path.join(__dirname, fname), res.body, 'utf-8');
                        console.log(`  保存到: ${fname}`);
                        console.log(`  前 1000 字符: ${res.body.substring(0, 1000)}`);
                    } else {
                        console.log(`  ${res.body}`);
                    }
                }
            } catch (e) {
                console.log(`❌ ${e.message}`);
            }
        }
    }
}

main().catch(err => console.error('Fatal:', err));
