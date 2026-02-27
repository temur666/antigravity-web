#!/usr/bin/env node
/**
 * capture-mode-diff.js — 抓取 IDE 中 Planning vs Fast 模式 + 图片发送的完整请求差异
 *
 * 使用方式:
 *   node tools/capture-mode-diff.js
 *
 * 前置条件:
 *   - Antigravity IDE 正在运行
 *   - IDE 通过 --remote-debugging-port=9000 启动 (或环境变量 CDP_PORT)
 *
 * 工作流程:
 *   1. 连接所有 IDE 窗口的 CDP
 *   2. 开启 Network 拦截
 *   3. 等待你在 IDE 中手动操作（发消息）
 *   4. 捕获所有 SendUserCascadeMessage 请求的完整 PostData
 *   5. 保存到文件供分析
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT || '9000');
const WAIT_SECONDS = Number(process.env.WAIT || 120);  // 默认等 2 分钟
const OUTPUT_FILE = path.join(__dirname, 'mode-diff-capture.json');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch { resolve(d); }
            });
        }).on('error', reject);
    });
}

let mid = 1;
function cdpSend(ws, method, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const id = mid++;
        const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeout);
        const handler = raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.id === id) {
                    ws.off('message', handler);
                    clearTimeout(timer);
                    if (msg.error) reject(new Error(msg.error.message));
                    else resolve(msg.result);
                }
            } catch { }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('═'.repeat(60));
    console.log('  Antigravity API 抓包工具 — Planning/Fast/图片 差异分析');
    console.log('═'.repeat(60));
    console.log();

    // 1. 获取所有 CDP 目标
    let targets;
    try {
        targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
    } catch (e) {
        console.error(`❌ 无法连接 CDP (${CDP_HOST}:${CDP_PORT}): ${e.message}`);
        console.error('   确保 Antigravity IDE 以 --remote-debugging-port=9000 启动');
        process.exit(1);
    }

    const pages = targets.filter(t => t.type === 'page');
    console.log(`📋 发现 ${pages.length} 个 CDP 页面:`);
    pages.forEach(p => console.log(`   - ${p.title}`));

    // 2. 连接所有 page 类型目标，开启 Network
    const connections = [];
    const capturedRequests = [];

    for (const page of pages) {
        if (!page.webSocketDebuggerUrl) continue;
        try {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('timeout')), 5000);
            });

            await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 100000000 });

            // 监听所有 LanguageServer 请求
            ws.on('message', raw => {
                try {
                    const msg = JSON.parse(raw.toString());

                    if (msg.method === 'Network.requestWillBeSent') {
                        const p = msg.params;
                        if (p.request.url.includes('LanguageServer')) {
                            const methodName = p.request.url.split('/').pop();
                            const entry = {
                                timestamp: new Date().toISOString(),
                                source: page.title,
                                requestId: p.requestId,
                                method: methodName,
                                url: p.request.url,
                                headers: p.request.headers,
                                postData: null,
                                postDataParsed: null,
                                responseBody: null,
                                _ws: ws,
                                _finished: false,
                            };

                            // 提取 PostData
                            if (p.request.postData) {
                                entry.postData = p.request.postData;
                                try {
                                    entry.postDataParsed = JSON.parse(p.request.postData);
                                } catch { }
                            }

                            capturedRequests.push(entry);

                            // 特别关注的方法
                            const highlight = ['SendUserCascadeMessage', 'StartCascade', 'GetCommandModelConfigs'].includes(methodName);
                            const icon = highlight ? '🔥' : '📡';
                            console.log(`\n${icon} [${page.title}] ${methodName}`);

                            if (entry.postDataParsed && highlight) {
                                // 打印关键字段
                                const pd = entry.postDataParsed;
                                if (pd.cascadeConfig) {
                                    const pc = pd.cascadeConfig.plannerConfig || {};
                                    console.log(`   plannerMode:   ${pc.conversational?.plannerMode}`);
                                    console.log(`   agenticMode:   ${pc.conversational?.agenticMode}`);
                                    console.log(`   model:         ${pc.requestedModel?.model}`);
                                    console.log(`   autoExecution: ${pc.toolConfig?.runCommand?.autoCommandConfig?.autoExecutionPolicy}`);
                                    console.log(`   artifactMode:  ${pc.toolConfig?.notifyUser?.artifactReviewMode}`);
                                }
                                if (pd.items) {
                                    console.log(`   items count:   ${pd.items.length}`);
                                    pd.items.forEach((item, i) => {
                                        const keys = Object.keys(item);
                                        console.log(`   items[${i}] keys: ${keys.join(', ')}`);
                                        if (item.text) console.log(`   items[${i}].text: "${item.text.substring(0, 100)}..."`);
                                        // 非 text 字段全部打印
                                        keys.filter(k => k !== 'text').forEach(k => {
                                            const val = JSON.stringify(item[k]);
                                            console.log(`   items[${i}].${k}: ${val.substring(0, 500)}`);
                                        });
                                    });
                                }
                                if (pd.metadata) {
                                    console.log(`   metadata keys: ${Object.keys(pd.metadata).join(', ')}`);
                                }
                            }
                        }
                    }

                    if (msg.method === 'Network.loadingFinished') {
                        const entry = capturedRequests.find(e => e.requestId === msg.params.requestId);
                        if (entry) entry._finished = true;
                    }
                } catch { }
            });

            connections.push({ ws, title: page.title });
            console.log(`✅ 已连接: ${page.title}`);
        } catch (e) {
            console.log(`⚠️ 跳过 ${page.title}: ${e.message}`);
        }
    }

    if (connections.length === 0) {
        console.error('❌ 没有成功连接任何 CDP 目标');
        process.exit(1);
    }

    console.log();
    console.log('━'.repeat(60));
    console.log('  📝 请在 Antigravity IDE 中执行以下操作:');
    console.log();
    console.log('  1️⃣  选择 "Fast" 模式，发一条消息 (如 "test fast mode")');
    console.log('  2️⃣  选择 "Planning" 模式，发一条消息 (如 "test planning mode")');
    console.log('  3️⃣  添加一张图片，发一条消息 (如 "describe this image")');
    console.log('  4️⃣  使用 @mention 引用一个文件发消息');
    console.log();
    console.log(`  ⏳ 等待 ${WAIT_SECONDS} 秒...`);
    console.log('━'.repeat(60));
    console.log();

    await sleep(WAIT_SECONDS * 1000);

    // 3. 获取 response bodies for SendUserCascadeMessage
    console.log('\n═══ 获取 Response Bodies ═══\n');
    for (const entry of capturedRequests) {
        if (entry._finished && entry.method === 'SendUserCascadeMessage' && entry._ws.readyState === WebSocket.OPEN) {
            try {
                const bodyResult = await cdpSend(entry._ws, 'Network.getResponseBody', { requestId: entry.requestId }, 5000);
                let body = bodyResult.body || '';
                if (bodyResult.base64Encoded) {
                    body = Buffer.from(body, 'base64').toString('utf-8');
                }
                try { entry.responseBody = JSON.parse(body); } catch { entry.responseBody = body; }
            } catch (e) {
                console.log(`  ⚠️ 获取 ${entry.method} response 失败: ${e.message}`);
            }
        }
    }

    // 4. 清理并保存
    const output = capturedRequests.map(e => ({
        timestamp: e.timestamp,
        source: e.source,
        method: e.method,
        url: e.url,
        postDataParsed: e.postDataParsed,
        postDataRaw: e.postData ? e.postData.substring(0, 50000) : null,
        responseBody: e.responseBody,
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ 已捕获 ${capturedRequests.length} 个请求，保存到: ${OUTPUT_FILE}`);

    // 5. 打印 SendUserCascadeMessage 的对比摘要
    const sendMsgs = capturedRequests.filter(e => e.method === 'SendUserCascadeMessage' && e.postDataParsed);
    if (sendMsgs.length > 0) {
        console.log(`\n═══ SendUserCascadeMessage 对比 (${sendMsgs.length} 条) ═══\n`);
        sendMsgs.forEach((e, i) => {
            const pd = e.postDataParsed;
            const pc = pd.cascadeConfig?.plannerConfig || {};
            console.log(`--- 消息 ${i + 1} (${e.timestamp}) ---`);
            console.log(`  来源:        ${e.source}`);
            console.log(`  cascadeId:   ${pd.cascadeId}`);
            console.log(`  plannerMode: ${pc.conversational?.plannerMode}`);
            console.log(`  agenticMode: ${pc.conversational?.agenticMode}`);
            console.log(`  model:       ${pc.requestedModel?.model}`);
            console.log(`  items:       ${pd.items?.length} 个`);
            pd.items?.forEach((item, j) => {
                console.log(`    [${j}] keys: ${Object.keys(item).join(', ')}`);
            });
            console.log();
        });
    }

    // 关闭连接
    for (const { ws } of connections) {
        try {
            await cdpSend(ws, 'Network.disable').catch(() => { });
            ws.close();
        } catch { }
    }

    console.log('🏁 完成');
}

main().catch(err => {
    console.error('❌ Fatal:', err.message);
    process.exit(1);
});
