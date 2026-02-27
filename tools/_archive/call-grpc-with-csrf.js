/**
 * call-grpc-with-csrf.js — 从 Manager 窗口获取 CSRF token，然后调用 gRPC API
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getConversations } = require('../lib/conversations');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const outputFile = path.join(__dirname, 'grpc-with-csrf.txt');

function postJSON(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...headers,
            },
            rejectUnauthorized: false,
        };
        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseData }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    // 1. 连接 Manager，通过它发一个 fetch 请求来看请求头
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    if (!manager) { log('❌ Manager 未找到'); return; }

    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    log('✅ 已连接 Manager');

    // 2. 在 Manager 中执行 fetch 来代理请求 (这样自动带上 CSRF token)
    const convResult = getConversations();
    const latest = convResult.conversations[0];
    log(`最新对话: "${latest.title}" (${latest.id})`);

    // 方法1: 让 Manager 窗口自己执行 fetch
    log('\n━━━ 方法1: 通过 Manager 窗口 fetch ━━━');

    // 先找到正确的端口
    const portResult = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = new Set();
        entries.forEach(function(e) {
            if (e.name.includes('GetCascadeTrajectory')) {
                try {
                    var url = new URL(e.name);
                    ports.add(url.port);
                } catch {}
            }
        });
        return JSON.stringify(Array.from(ports));
    })()`);

    const ports = JSON.parse(portResult);
    log('可用端口:', ports.join(', '));

    for (const port of ports) {
        log(`\n尝试通过 Manager 的 fetch 代理请求 (端口 ${port})...`);

        const fetchResult = await cdpSend(ws, 'Runtime.evaluate', {
            expression: `(async () => {
                try {
                    var url = 'https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory';
                    var resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cascadeId: '${latest.id}' }),
                    });
                    var text = await resp.text();
                    return JSON.stringify({
                        status: resp.status,
                        statusText: resp.statusText,
                        contentType: resp.headers.get('content-type'),
                        bodyLength: text.length,
                        body: text.substring(0, 30000),
                    });
                } catch(e) {
                    return JSON.stringify({ error: e.message });
                }
            })()`,
            returnByValue: true,
            awaitPromise: true,
        }, 30000);

        const fetchData = JSON.parse(fetchResult.result.value);
        log(`Status: ${fetchData.status} ${fetchData.statusText}`);
        log(`Content-Type: ${fetchData.contentType}`);
        log(`Body length: ${fetchData.bodyLength}`);

        if (fetchData.error) {
            log(`Error: ${fetchData.error}`);
        } else if (fetchData.bodyLength > 30000) {
            log(`Body (前 30000 字符):`);
            log(fetchData.body);
            log(`... [截断]`);
        } else {
            log(`Body:`);
            log(fetchData.body);
        }

        // 如果成功了，尝试解析 JSON
        if (fetchData.status === 200 && fetchData.bodyLength > 10) {
            try {
                const parsed = JSON.parse(fetchData.body);
                log('\n✅ JSON 解析成功!');
                log('Top-level keys:', Object.keys(parsed).join(', '));

                // 保存完整响应到文件
                const fullFile = path.join(__dirname, 'trajectory-response.json');
                fs.writeFileSync(fullFile, fetchData.body, 'utf-8');
                log(`完整响应已保存到: ${fullFile}`);
            } catch { }
            break; // 成功就不需要试其他端口
        }
    }

    ws.close();
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
