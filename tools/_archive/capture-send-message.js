/**
 * capture-send-message.js — 在工作区中发一条真实消息，抓取 SendUserCascadeMessage 的完整请求
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'send-message-capture.txt');

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    const targets = await httpGet('http://127.0.0.1:9000/json');
    // 用本地工作区
    const target = targets.find(t => t.type === 'page' && t.title && t.title.includes('antigravity-web'));
    if (!target) { log('❌ No workspace'); return; }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 50000000 });
    log('✅ Connected to:', target.title);

    // 收集所有 gRPC 请求
    const requests = new Map();
    ws.on('message', raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                if (p.request.url.includes('127.0.0.1') && p.request.url.includes('LanguageServer')) {
                    requests.set(p.requestId, {
                        url: p.request.url,
                        method: p.request.method,
                        headers: p.request.headers,
                        postData: p.request.postData,
                        hasPostData: p.request.hasPostData,
                        timestamp: Date.now(),
                    });
                    log(`📡 ${p.request.method} ${p.request.url}`);
                    if (p.request.postData) {
                        log(`   PostData: ${p.request.postData.substring(0, 2000)}`);
                    }
                    // 所有 headers
                    for (const [k, v] of Object.entries(p.request.headers)) {
                        log(`   ${k}: ${String(v).substring(0, 200)}`);
                    }
                }
            }
            if (msg.method === 'Network.responseReceived') {
                const entry = requests.get(msg.params.requestId);
                if (entry) {
                    entry.responseStatus = msg.params.response.status;
                    entry.responseHeaders = msg.params.response.headers;
                    log(`📥 Response for ${entry.url.split('/').pop()}: ${msg.params.response.status}`);
                }
            }
            if (msg.method === 'Network.loadingFinished') {
                const entry = requests.get(msg.params.requestId);
                if (entry) entry._finished = true;
            }
        } catch { }
    });

    log('\n════════════════════════════════════════');
    log('请在 Antigravity IDE 中发一条消息到当前对话！');
    log('等待 30 秒...');
    log('════════════════════════════════════════\n');

    await sleep(30000);

    // 获取 response bodies
    log('\n═══ 获取 Response Bodies ═══\n');
    for (const [reqId, req] of requests) {
        if (req._finished && req.url.includes('SendUserCascadeMessage')) {
            try {
                const bodyResult = await cdpSend(ws, 'Network.getResponseBody', { requestId: reqId }, 5000);
                const body = bodyResult.body || '';
                log(`\nResponse for SendUserCascadeMessage:`);
                log(`  base64: ${bodyResult.base64Encoded}`);
                if (bodyResult.base64Encoded) {
                    const decoded = Buffer.from(body, 'base64').toString('utf-8');
                    log(`  Decoded (${decoded.length} bytes): ${decoded.substring(0, 2000)}`);
                } else {
                    log(`  Body (${body.length} bytes): ${body.substring(0, 2000)}`);
                }
            } catch (e) {
                log(`  获取 body 失败: ${e.message}`);
            }
        }
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
