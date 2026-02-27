/**
 * find-csrf.js — 在 Manager 窗口中拦截实际的 gRPC 请求, 提取 CSRF token
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const { clickAt } = require('../lib/ide');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getConversations } = require('../lib/conversations');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const outputFile = path.join(__dirname, 'csrf-capture.txt');

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 10000000 });
    log('✅ 已连接 Manager, Network 已开启');

    // 收集所有请求头
    const allRequests = [];
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                if (p.request.url.includes('LanguageServer')) {
                    allRequests.push({
                        url: p.request.url,
                        method: p.request.method,
                        headers: p.request.headers,
                        postData: p.request.postData,
                        requestId: p.requestId,
                    });
                }
            }
        } catch { }
    });

    // 点击一个对话来触发请求
    log('\n触发对话切换...');

    // 点击 "Distill Figma Features" (index 22, x=132, y=543)
    await clickAt(ws, 132, 543);
    log('已点击, 等待 5 秒...');
    await sleep(5000);

    log(`\n捕获到 ${allRequests.length} 个请求`);

    for (const req of allRequests) {
        log('\n━'.repeat(80));
        log(`${req.method} ${req.url}`);
        log('ALL HEADERS:');
        for (const [k, v] of Object.entries(req.headers)) {
            log(`  ${k}: ${v.substring(0, 300)}`);
        }
        if (req.postData) {
            log(`POST Data: ${req.postData.substring(0, 500)}`);
        }
    }

    // 如果找到了 CSRF token, 尝试直接调用
    if (allRequests.length > 0) {
        const sampleReq = allRequests[0];
        const csrfHeaders = {};

        for (const [k, v] of Object.entries(sampleReq.headers)) {
            // 收集所有可能的 token 相关 header
            if (!/^(host|origin|referer|sec-|accept|connection|content-length|user-agent)/i.test(k)) {
                csrfHeaders[k] = v;
            }
        }

        log('\n\n━━━ 提取的可能的 auth/CSRF headers ━━━');
        for (const [k, v] of Object.entries(csrfHeaders)) {
            log(`  ${k}: ${v.substring(0, 200)}`);
        }

        // 获取对话列表
        const convResult = getConversations();
        const latest = convResult.conversations[0];

        // 提取端口
        const urlObj = new URL(sampleReq.url);
        const port = urlObj.port;

        log(`\n\n━━━ 使用提取的 headers 调用 GetCascadeTrajectory ━━━`);

        try {
            const apiUrl = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory`;
            const body = { cascadeId: latest.id };

            const data = JSON.stringify(body);
            const urlParsed = new URL(apiUrl);

            const res = await new Promise((resolve, reject) => {
                const options = {
                    hostname: urlParsed.hostname,
                    port: urlParsed.port,
                    path: urlParsed.pathname,
                    method: 'POST',
                    headers: {
                        ...csrfHeaders,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data),
                    },
                    rejectUnauthorized: false,
                };
                const req = https.request(options, (res) => {
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, body: responseData }));
                });
                req.on('error', reject);
                req.write(data);
                req.end();
            });

            log(`Status: ${res.status}`);
            log(`Body length: ${res.body.length}`);

            if (res.body.length > 50000) {
                log(`Body (前 50000):`, res.body.substring(0, 50000));
                log('... [截断]');
                // 保存完整响应
                fs.writeFileSync(path.join(__dirname, 'trajectory-full.json'), res.body, 'utf-8');
                log('完整响应保存到 trajectory-full.json');
            } else {
                log(`Body:`, res.body);
            }
        } catch (e) {
            log(`❌ 调用失败: ${e.message}`);
        }
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
