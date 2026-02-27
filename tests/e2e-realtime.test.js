/**
 * tests/e2e-realtime.test.js — 端到端实时流程验证
 *
 * 完整流程: 启动服务 → WS 连接 → 新建对话 → 发消息 → 订阅 → 收事件推送 → 对话完成
 *
 * Run: node tests/e2e-realtime.test.js
 * 要求: 真实 LS 正在运行
 */

const WebSocket = require('ws');
const http = require('http');

const TEST_PORT = 3299; // 用独立端口避免冲突
const TEST_MESSAGE = '直接回复 OK 两个字，不要做任何其他事情。';
const TIMEOUT_MS = 30000;

// ========== Helpers ==========

function log(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== Test ==========

async function main() {
    console.log('\n🧪 端到端实时流程验证');
    console.log('═'.repeat(50));

    // Step 1: 启动服务
    log('Step 1: 启动 Controller + HTTP Server');

    const express = require('express');
    const { Controller } = require('../lib/core/controller');
    const proto = require('../lib/core/ws-protocol');

    const controller = new Controller();
    const ok = await controller.init();
    if (!ok) {
        console.error('❌ LS 未找到，无法运行端到端测试');
        process.exit(1);
    }
    log(`  LS 已连接: PID=${controller.ls.pid} Port=${controller.ls.port}`);

    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });

    // 复用 server.js 的 v2 路由逻辑
    wss.on('connection', (clientWs) => {
        clientWs.send(proto.makeEvent('event_ls_status', {
            connected: true,
            port: controller.ls.port,
        }));

        clientWs.on('message', async (raw) => {
            const data = JSON.parse(raw.toString());

            switch (data.type) {
                case 'req_new_chat': {
                    const cid = await controller.newChat();
                    clientWs.send(proto.makeResponse('res_new_chat', { cascadeId: cid }, data.reqId));
                    break;
                }
                case 'req_send_message': {
                    await controller.sendMessage(data.cascadeId, data.text, data.config);
                    controller.subscribe(data.cascadeId, clientWs);
                    clientWs.send(proto.makeResponse('res_send_message', { ok: true, cascadeId: data.cascadeId }, data.reqId));
                    break;
                }
                case 'req_subscribe': {
                    controller.subscribe(data.cascadeId, clientWs);
                    clientWs.send(proto.makeResponse('res_subscribe', { ok: true }, data.reqId));
                    break;
                }
                case 'req_trajectory': {
                    const traj = await controller.getTrajectory(data.cascadeId);
                    clientWs.send(proto.makeResponse('res_trajectory', {
                        cascadeId: data.cascadeId,
                        status: traj?.status,
                        steps: traj?.trajectory?.steps || [],
                        totalSteps: traj?.numTotalSteps || 0,
                    }, data.reqId));
                    break;
                }
            }
        });
    });

    await new Promise(resolve => server.listen(TEST_PORT, resolve));
    log(`  HTTP 服务启动: port=${TEST_PORT}`);

    // Step 2: WebSocket 连接
    log('Step 2: WebSocket 客户端连接');
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);

    const received = {
        events: [],
        responses: new Map(), // reqId → response
    };

    const waitForResponse = (reqId) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${reqId}`)), 10000);
        const check = () => {
            if (received.responses.has(reqId)) {
                clearTimeout(timer);
                resolve(received.responses.get(reqId));
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.reqId) {
            received.responses.set(msg.reqId, msg);
        }
        if (msg.type.startsWith('event_')) {
            received.events.push(msg);
        }
    });

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    log('  ✅ WS 连接成功');

    // Step 3: 新建对话
    log('Step 3: 创建新对话');
    ws.send(JSON.stringify({ type: 'req_new_chat', reqId: 'r1' }));
    const newChatRes = await waitForResponse('r1');
    const cascadeId = newChatRes.cascadeId;
    log(`  ✅ cascadeId = ${cascadeId}`);

    // Step 4: 发送消息 (自动订阅)
    log(`Step 4: 发送消息 "${TEST_MESSAGE}"`);
    ws.send(JSON.stringify({
        type: 'req_send_message',
        reqId: 'r2',
        cascadeId,
        text: TEST_MESSAGE,
    }));
    const sendRes = await waitForResponse('r2');
    log(`  ✅ 消息已发送: ok=${sendRes.ok}`);

    // Step 5: 等待实时事件
    log('Step 5: 等待实时事件推送...');

    const startTime = Date.now();
    let statusIdle = false;
    let stepAddedCount = 0;
    let stepUpdatedCount = 0;
    let lastEventCount = 0;

    while (Date.now() - startTime < TIMEOUT_MS) {
        await sleep(500);

        // 检查新事件
        if (received.events.length > lastEventCount) {
            for (let i = lastEventCount; i < received.events.length; i++) {
                const ev = received.events[i];
                if (ev.type === 'event_step_added') {
                    stepAddedCount++;
                    const stepType = (ev.step?.type || '').replace('CORTEX_STEP_TYPE_', '');
                    log(`  📥 event_step_added [${ev.stepIndex}] ${stepType}`);
                }
                if (ev.type === 'event_step_updated') {
                    stepUpdatedCount++;
                    log(`  📝 event_step_updated [${ev.stepIndex}] ${ev.step?.status}`);
                }
                if (ev.type === 'event_status_changed') {
                    log(`  🔄 event_status_changed: ${ev.from} → ${ev.to}`);
                    if (ev.to === 'IDLE') {
                        statusIdle = true;
                    }
                }
            }
            lastEventCount = received.events.length;
        }

        if (statusIdle) break;
    }

    // Step 6: 验证结果
    log('Step 6: 最终验证');

    // 获取最终轨迹
    ws.send(JSON.stringify({ type: 'req_trajectory', reqId: 'r3', cascadeId }));
    const trajRes = await waitForResponse('r3');

    console.log('\n📊 结果汇总');
    console.log('═'.repeat(50));
    console.log(`  cascadeId:      ${cascadeId}`);
    console.log(`  最终状态:       ${trajRes.status}`);
    console.log(`  总 steps:       ${trajRes.totalSteps}`);
    console.log(`  event_step_added:   ${stepAddedCount} 个`);
    console.log(`  event_step_updated: ${stepUpdatedCount} 个`);
    console.log(`  event_status_changed: ${statusIdle ? '✅ 收到 IDLE' : '❌ 未收到'}`);
    console.log(`  总事件数:       ${received.events.length}`);
    console.log(`  耗时:           ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    // 断言
    let passed = 0;
    let failed = 0;

    function check(name, condition) {
        if (condition) { console.log(`  ✅ ${name}`); passed++; }
        else { console.log(`  ❌ ${name}`); failed++; }
    }

    console.log('\n🔍 断言检查');
    check('cascadeId 有效', !!cascadeId);
    check('收到 event_step_added 事件', stepAddedCount > 0);
    check('收到 event_status_changed 到 IDLE', statusIdle);
    check('最终轨迹 steps > 0', trajRes.steps?.length > 0);
    check('最终状态包含 IDLE', (trajRes.status || '').includes('IDLE'));

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`结果: ${passed} passed, ${failed} failed`);
    console.log(`${'═'.repeat(50)}\n`);

    // 清理
    ws.close();
    server.close();
    controller.destroy();

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('❌ 测试失败:', err.message);
    process.exit(1);
});
