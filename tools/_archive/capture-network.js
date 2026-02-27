/**
 * capture-network.js — 通过 CDP 抓取 IDE 加载对话时的网络请求
 * 
 * 流程:
 * 1. 连接工作区 → 开启 Network 监听
 * 2. 打开 History 弹窗 → 点击一个历史对话
 * 3. 等待加载 → 收集所有网络请求
 * 4. 输出到文件
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const { clickAt, pressEsc } = require('../lib/ide');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'network-capture.txt');

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };
    const requests = new Map(); // requestId → { url, method, headers, postData, response, responseBody }

    // 1. 连接
    log('═'.repeat(80));
    log('CDP 网络请求抓取');
    log('═'.repeat(80));

    const targets = await httpGet('http://127.0.0.1:9000/json');
    const workspaces = targets.filter(t =>
        t.type === 'page' && t.url && t.url.includes('workbench.html') &&
        !t.url.includes('workbench-jetski-agent')
    );

    // 用第一个有 Chat 面板的工作区
    let ws, targetTitle;
    for (const target of workspaces) {
        try {
            ws = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('timeout')), 3000);
            });
            await cdpSend(ws, 'Runtime.enable');
            const hasPanel = await cdpEval(ws, `!!document.querySelector('.antigravity-agent-side-panel')`);
            if (hasPanel) { targetTitle = target.title; break; }
            ws.close(); ws = null;
        } catch { if (ws) { try { ws.close(); } catch { } ws = null; } }
    }

    if (!ws) { log('❌ 无可用工作区'); return; }
    log(`✅ 连接到: ${targetTitle}`);

    // 2. 开启 Network 监听
    await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 10000000, maxResourceBufferSize: 5000000 });
    log('✅ Network 监听已开启');

    // 注册网络事件处理
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.method === 'Network.requestWillBeSent') {
                const p = msg.params;
                requests.set(p.requestId, {
                    url: p.request.url,
                    method: p.request.method,
                    headers: p.request.headers,
                    postData: p.request.postData || null,
                    hasPostData: p.request.hasPostData || false,
                    type: p.type,
                    timestamp: p.timestamp,
                    response: null,
                    responseBody: null,
                });
            }

            if (msg.method === 'Network.responseReceived') {
                const p = msg.params;
                const req = requests.get(p.requestId);
                if (req) {
                    req.response = {
                        status: p.response.status,
                        statusText: p.response.statusText,
                        headers: p.response.headers,
                        mimeType: p.response.mimeType,
                        url: p.response.url,
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

    log('');
    log('开始记录网络请求...');
    log('');

    // 3. 先清空请求记录，然后触发对话切换
    await sleep(500);
    requests.clear();

    // 打开 History 弹窗
    log('📋 打开 History 弹窗...');
    const histBtnRaw = await cdpEval(ws, `(() => {
        // 先关闭已有弹窗
        const modal = document.querySelector('.jetski-fast-pick');
        if (modal) return 'ALREADY_OPEN';
        const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
    })()`);

    if (histBtnRaw === 'ALREADY_OPEN') {
        log('  弹窗已打开，先关闭再重开');
        await pressEsc(ws);
        await sleep(300);
    }

    if (histBtnRaw && histBtnRaw !== 'ALREADY_OPEN') {
        const { x, y } = JSON.parse(histBtnRaw);
        await clickAt(ws, x, y);
    } else if (histBtnRaw !== 'ALREADY_OPEN') {
        log('❌ 未找到 History 按钮');
        ws.close();
        return;
    }

    // 如果刚关闭了，重新打开
    if (histBtnRaw === 'ALREADY_OPEN') {
        await sleep(300);
        const btn2 = await cdpEval(ws, `(() => {
            const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
            if (!btn) return null;
            const rect = btn.getBoundingClientRect();
            return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
        })()`);
        if (btn2) {
            const { x, y } = JSON.parse(btn2);
            await clickAt(ws, x, y);
        }
    }

    await sleep(1000);

    // 获取对话列表
    const listRaw = await cdpEval(ws, `(() => {
        const modal = document.querySelector('.jetski-fast-pick');
        if (!modal) return null;
        const scrollList = modal.querySelector('.overflow-y-scroll');
        if (!scrollList) return null;
        const items = scrollList.querySelectorAll('.cursor-pointer');
        const result = [];
        items.forEach((item, i) => {
            const titleEl = item.querySelector('.text-sm.truncate span');
            const title = titleEl ? titleEl.textContent.trim() : '(no title)';
            result.push({ index: i, title });
        });
        return JSON.stringify(result);
    })()`);

    if (!listRaw) {
        log('❌ 未能获取对话列表');
        ws.close();
        return;
    }

    const convList = JSON.parse(listRaw);
    log(`找到 ${convList.length} 个对话:`);
    convList.slice(0, 5).forEach(c => log(`  [${c.index}] ${c.title}`));
    log('');

    // 清空请求，准备捕获
    requests.clear();
    log('📡 清空请求记录，准备捕获切换对话时的网络活动...');

    // 4. 点击第二个对话（跳过 current）
    const targetConv = convList.length > 1 ? convList[1] : convList[0];
    log(`🔀 切换到: [${targetConv.index}] "${targetConv.title}"`);

    const clickRaw = await cdpEval(ws, `(() => {
        const modal = document.querySelector('.jetski-fast-pick');
        if (!modal) return null;
        const scrollList = modal.querySelector('.overflow-y-scroll');
        if (!scrollList) return null;
        const items = scrollList.querySelectorAll('.cursor-pointer');
        const target = items[${targetConv.index}];
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
    })()`);

    if (clickRaw) {
        const { x, y } = JSON.parse(clickRaw);
        await clickAt(ws, x, y);
    }

    // 5. 等待网络请求完成
    log('⏳ 等待网络请求 (5秒)...');
    await sleep(5000);

    // 6. 尝试获取 response body
    log('📥 尝试获取 response body...');
    for (const [reqId, req] of requests) {
        if (req._finished && req.response) {
            try {
                const bodyResult = await cdpSend(ws, 'Network.getResponseBody', { requestId: reqId }, 3000);
                req.responseBody = bodyResult.body ? bodyResult.body.substring(0, 10000) : null;
                req.responseBodyBase64 = bodyResult.base64Encoded || false;
            } catch (e) {
                req.responseBody = `<获取失败: ${e.message}>`;
            }
        }
    }

    // 7. 输出结果
    log('');
    log('═'.repeat(80));
    log(`捕获到 ${requests.size} 个网络请求`);
    log('═'.repeat(80));

    let idx = 0;
    for (const [reqId, req] of requests) {
        idx++;
        log('');
        log(`━━━ 请求 #${idx}: ${req.method} ━━━`);
        log(`URL: ${req.url}`);
        log(`Type: ${req.type || 'unknown'}`);

        if (req.response) {
            log(`Status: ${req.response.status} ${req.response.statusText}`);
            log(`MIME: ${req.response.mimeType}`);
        }

        if (req.postData) {
            const pd = req.postData.length > 5000 ? req.postData.substring(0, 5000) + '...' : req.postData;
            log(`POST Data:`);
            log(pd);
        }

        // 重要 headers
        if (req.headers) {
            const importantHeaders = ['authorization', 'content-type', 'x-goog-api-key', 'x-server-timeout'];
            for (const [k, v] of Object.entries(req.headers)) {
                if (importantHeaders.some(h => k.toLowerCase().includes(h))) {
                    log(`  Header: ${k}: ${v.substring(0, 200)}`);
                }
            }
        }

        if (req.response && req.response.headers) {
            const respHeaders = req.response.headers;
            if (respHeaders['content-type']) log(`  Resp Content-Type: ${respHeaders['content-type']}`);
        }

        if (req.responseBody && req.responseBody !== `<获取失败: ${req.responseBody}>`) {
            const body = req.responseBody.length > 5000 ? req.responseBody.substring(0, 5000) + '...' : req.responseBody;
            log(`Response Body (${req.responseBodyBase64 ? 'base64' : 'text'}):`);
            log(body);
        }
    }

    await cdpSend(ws, 'Network.disable');
    ws.close();

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
