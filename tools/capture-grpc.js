/**
 * capture-grpc.js — 在 Manager 窗口中监听 Network，
 * 点击一个历史对话来触发 GetCascadeTrajectory 请求，
 * 然后捕获请求和响应
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const { clickAt } = require('../lib/ide');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'grpc-capture.txt');

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    const targets = await httpGet('http://127.0.0.1:9000/json');
    const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
    if (!manager) { log('❌ Manager 未找到'); return; }

    const ws = new WebSocket(manager.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 50000000 });
    log('✅ 已连接 Manager，Network 已开启');

    // 收集请求
    const requests = new Map();
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                if (p.request.url.includes('GetCascadeTrajectory') || p.request.url.includes('LanguageServer')) {
                    requests.set(p.requestId, {
                        url: p.request.url,
                        method: p.request.method,
                        headers: p.request.headers,
                        postData: p.request.postData || null,
                        hasPostData: p.request.hasPostData || false,
                    });
                    console.log(`📡 捕获请求: ${p.request.method} ${p.request.url}`);
                }
            }
            if (msg.method === 'Network.responseReceived') {
                const req = requests.get(msg.params.requestId);
                if (req) {
                    req.response = {
                        status: msg.params.response.status,
                        headers: msg.params.response.headers,
                        mimeType: msg.params.response.mimeType,
                    };
                }
            }
            if (msg.method === 'Network.loadingFinished') {
                const req = requests.get(msg.params.requestId);
                if (req) {
                    req._requestId = msg.params.requestId;
                    req._finished = true;
                }
            }
        } catch { }
    });

    // 先看当前对话列表
    log('\n━━━ Manager DOM 中的对话列表 ━━━');
    const convListRaw = await cdpEval(ws, `(() => {
        var items = document.querySelectorAll('.cursor-pointer');
        var result = [];
        var LF = String.fromCharCode(10);
        items.forEach(function(item, i) {
            var text = (item.innerText || '').trim().substring(0, 100);
            if (text.length > 3) {
                var rect = item.getBoundingClientRect();
                result.push({ index: i, text: text.split(LF)[0], x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), w: Math.round(rect.width), h: Math.round(rect.height) });
            }
        });
        return JSON.stringify(result);
    })()`);
    const convItems = JSON.parse(convListRaw);
    log(`找到 ${convItems.length} 个可点击元素:`);
    convItems.slice(0, 20).forEach(c => log(`  [${c.index}] "${c.text}" (x=${c.x}, y=${c.y}, ${c.w}x=${c.h})`));

    // 清空请求
    requests.clear();

    // 找一个看起来像对话标题的元素点击
    const convTarget = convItems.find(c =>
        c.text.length > 5 && c.w > 100 && c.h > 20 &&
        !['Antigravity', 'File', 'Edit', 'View', 'Open Editor', 'Start', 'Agent Manager'].some(skip => c.text.includes(skip))
    );

    if (convTarget) {
        log(`\n📌 点击对话: "${convTarget.text}" (${convTarget.x}, ${convTarget.y})`);
        await clickAt(ws, convTarget.x, convTarget.y);

        log('⏳ 等待 gRPC 请求 (5 秒)...');
        await sleep(5000);
    } else {
        log('⚠️ 未找到合适的对话元素，等待 5 秒看是否有后台请求...');
        await sleep(5000);
    }

    // 获取 response body
    log(`\n━━━ 捕获到 ${requests.size} 个 gRPC 请求 ━━━`);

    for (const [reqId, req] of requests) {
        log('');
        log('━'.repeat(80));
        log(`${req.method} ${req.url}`);
        log(`Status: ${req.response?.status || 'unknown'}`);
        log(`MIME: ${req.response?.mimeType || 'unknown'}`);

        // 重要 headers
        if (req.headers) {
            for (const [k, v] of Object.entries(req.headers)) {
                if (/content-type|authorization|x-goog|grpc/i.test(k)) {
                    log(`  Req Header: ${k}: ${v.substring(0, 300)}`);
                }
            }
        }
        if (req.response?.headers) {
            for (const [k, v] of Object.entries(req.response.headers)) {
                if (/content-type|grpc|trailer/i.test(k)) {
                    log(`  Resp Header: ${k}: ${v}`);
                }
            }
        }

        if (req.postData) {
            log(`POST Data (${req.postData.length} bytes):`);
            // 尝试 hex 和 text
            log(`  Text: ${req.postData.substring(0, 500)}`);
        }

        if (req._finished) {
            try {
                const bodyResult = await cdpSend(ws, 'Network.getResponseBody', { requestId: reqId }, 5000);
                const body = bodyResult.body || '';
                log(`Response Body (${body.length} bytes, base64=${bodyResult.base64Encoded}):`);
                if (bodyResult.base64Encoded) {
                    const decoded = Buffer.from(body, 'base64');
                    log(`  Decoded size: ${decoded.length} bytes`);
                    // 尝试作为文本
                    const text = decoded.toString('utf-8');
                    const printable = [...text.substring(0, 500)].filter(c => c.charCodeAt(0) >= 0x20 || '\n\r\t'.includes(c)).length;
                    if (printable / Math.min(text.length, 500) > 0.5) {
                        log(`  Text content:`);
                        log(text.substring(0, 5000));
                    } else {
                        log(`  Hex: ${decoded.slice(0, 200).toString('hex')}`);
                    }
                } else {
                    log(body.substring(0, 5000));
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
