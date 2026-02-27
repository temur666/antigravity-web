/**
 * test-startcascade-via-fetch.js
 * 
 * 直接通过 Manager 窗口的 fetch 代理调用 StartCascade
 * Manager 内部的请求拦截器会自动加上 x-codeium-csrf-token
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fetchViaWindow(ws, port, method, body) {
    const result = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `(async () => {
            try {
                var resp = await fetch('https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/${method}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(${JSON.stringify(body)})
                });
                var text = await resp.text();
                return JSON.stringify({ status: resp.status, body: text.substring(0, 3000) });
            } catch(e) { return JSON.stringify({ error: e.message }); }
        })()`,
        returnByValue: true,
        awaitPromise: true,
    }, 30000);
    return JSON.parse(result.result?.value || '{}');
}

async function main() {
    const targets = await httpGet('http://127.0.0.1:9000/json');

    // 收集各窗口的端口
    console.log('═══ 收集端口 ═══');
    const windowPorts = [];
    for (const t of targets.filter(t => t.type === 'page')) {
        try {
            const ws = new WebSocket(t.webSocketDebuggerUrl);
            await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); setTimeout(() => j('to'), 3000); });
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
            if (ports.length > 0) {
                windowPorts.push({ title: t.title, ws, ports, target: t });
                console.log(`  ${t.title}: ${ports.join(', ')}`);
            } else {
                ws.close();
            }
        } catch { }
    }

    // 对每个窗口+端口组合，尝试 StartCascade
    console.log('\n═══ 测试各窗口 fetch 代理 ═══\n');

    for (const wp of windowPorts) {
        for (const port of wp.ports) {
            console.log(`--- ${wp.title} → port ${port} ---`);

            // 先测试一个已知能工作的方法
            const test = await fetchViaWindow(wp.ws, port, 'GetAgentScripts', {});
            console.log(`  GetAgentScripts: [${test.status || 'err'}] ${(test.body || test.error || '').substring(0, 100)}`);

            if (test.status === 401) {
                console.log('  ⚠️ CSRF 未自动附加，跳过');
                continue;
            }

            // StartCascade - 空 body
            const r1 = await fetchViaWindow(wp.ws, port, 'StartCascade', {});
            console.log(`  StartCascade {}: [${r1.status || 'err'}] ${(r1.body || r1.error || '').substring(0, 300)}`);

            // SendUserCascadeMessage - 空 body
            const r2 = await fetchViaWindow(wp.ws, port, 'SendUserCascadeMessage', {});
            console.log(`  SendUserCascadeMessage {}: [${r2.status || 'err'}] ${(r2.body || r2.error || '').substring(0, 300)}`);

            // 如果 StartCascade 拿到了有用的 response/error，进一步探索参数
            if (r1.status === 200 || r1.status === 400 || r1.status === 500) {
                console.log('\n  ═══ 深入测试 StartCascade 参数 ═══');

                const tests = [
                    ['cascadeId', { cascadeId: crypto.randomUUID() }],
                    ['message', { message: 'hello' }],
                    ['userMessage', { userMessage: 'hello' }],
                    ['query', { query: 'hello' }],
                    ['prompt', { prompt: 'hello' }],
                    ['cascadeId + message', { cascadeId: crypto.randomUUID(), message: 'hello' }],
                ];
                for (const [label, body] of tests) {
                    const r = await fetchViaWindow(wp.ws, port, 'StartCascade', body);
                    console.log(`  StartCascade {${label}}: [${r.status}] ${(r.body || '').substring(0, 300)}`);
                }
            }
        }
    }

    // 关闭所有连接
    for (const wp of windowPorts) {
        wp.ws.close();
    }
    console.log('\n✅ 完成');
}

main().catch(err => console.error('Fatal:', err));
