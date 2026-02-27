/**
 * @deprecated 请使用 server-v2.js — 这是 v1+v2 混合的旧入口，保留仅供参考
 *
 * Antigravity Web Chat — 后端 (v1+v2 混合，已弃用)
 *
 * 已被 server-v2.js 取代（纯 v2 协议入口）
 * 路由策略:
 *   - v2 协议 (req_* / event_*): Controller → gRPC API → LS
 *   - v1 协议 (send_message 等): CDP → IDE DOM (保留兼容)
 *
 * 模块结构:
 *   lib/controller.js — Controller 层 (对话管理、轮询、Diff)
 *   lib/ls-discovery.js — LS 发现
 *   lib/ws-protocol.js  — WebSocket 协议 v2
 *   lib/cdp.js  — CDP 通信层 (v1 兼容)
 *   lib/ide.js  — IDE 操作层 (v1 兼容)
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const { Controller } = require('./lib/controller');
const proto = require('./lib/ws-protocol');

// v1 依赖 (可选，CDP 不可用时 graceful 降级)
let cdp = null;
let ide = null;
try {
    cdp = require('./lib/cdp');
    ide = require('./lib/ide');
} catch { /* CDP 模块不可用 */ }

// ========== Controller 实例 ==========

const controller = new Controller();

// Controller 事件日志
controller.on('error', (err) => console.error('⚠️  Controller:', err.message));
controller.on('ls_connected', (ls) => console.log(`✅ LS 已连接 PID=${ls.pid} Port=${ls.port}`));
controller.on('ls_disconnected', () => console.log('❌ LS 断开'));
controller.on('status_changed', ({ cascadeId, from, to }) => {
    console.log(`🔄 对话 ${cascadeId.slice(0, 8)}... ${from} → ${to}`);
});

// ========== WebSocket 客户端管理 ==========

const clients = new Set();

// ========== v2 协议处理 ==========

async function handleV2Message(clientWs, data) {
    const { type, reqId } = data;
    const send = (msg) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(msg);
    };

    try {
        switch (type) {
            case 'req_status': {
                const status = controller.getStatus();
                // 补充模型和账户信息
                if (controller.ls) {
                    try {
                        const { grpcCall } = require('./lib/ls-discovery');
                        const r = await grpcCall(controller.ls.port, controller.ls.csrf, 'GetUserStatus', {});
                        const us = r.data?.userStatus || {};
                        status.account = {
                            email: us.email || '',
                            tier: us.userTier?.name || '',
                        };
                        const chatConfigs = us.cascadeModelConfigData?.chatConfigs || [];
                        status.models = chatConfigs.map(c => ({
                            label: c.label,
                            model: c.modelOrAlias?.model,
                            quota: c.quotaInfo?.remainingFraction,
                            tag: c.tagTitle || '',
                        }));
                    } catch { /* ignore */ }
                }
                send(proto.makeResponse('res_status', status, reqId));
                break;
            }

            case 'req_conversations': {
                const list = await controller.listConversations();
                const limit = data.limit || 50;
                const search = data.search;
                let filtered = list;
                if (search) {
                    const q = search.toLowerCase();
                    filtered = list.filter(c =>
                        (c.title || '').toLowerCase().includes(q) ||
                        (c.id || '').includes(q),
                    );
                }
                send(proto.makeResponse('res_conversations', {
                    conversations: filtered.slice(0, limit),
                    total: filtered.length,
                }, reqId));
                break;
            }

            case 'req_trajectory': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                const traj = await controller.getTrajectory(data.cascadeId);
                send(proto.makeResponse('res_trajectory', {
                    cascadeId: data.cascadeId,
                    status: traj?.status || 'UNKNOWN',
                    steps: traj?.trajectory?.steps || [],
                    totalSteps: traj?.numTotalSteps || 0,
                    metadata: traj?.trajectory?.generatorMetadata || [],
                }, reqId));
                break;
            }

            case 'req_new_chat': {
                const cascadeId = await controller.newChat();
                send(proto.makeResponse('res_new_chat', { cascadeId }, reqId));
                break;
            }

            case 'req_send_message': {
                if (!data.cascadeId || !data.text) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId or text', reqId));
                    break;
                }
                await controller.sendMessage(data.cascadeId, data.text, data.config);
                // 自动订阅
                controller.subscribe(data.cascadeId, clientWs);
                send(proto.makeResponse('res_send_message', { ok: true, cascadeId: data.cascadeId }, reqId));
                break;
            }

            case 'req_subscribe': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                controller.subscribe(data.cascadeId, clientWs);
                send(proto.makeResponse('res_subscribe', { ok: true, cascadeId: data.cascadeId }, reqId));
                break;
            }

            case 'req_unsubscribe': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                controller.unsubscribe(data.cascadeId, clientWs);
                send(proto.makeResponse('res_subscribe', { ok: true, cascadeId: data.cascadeId }, reqId));
                break;
            }

            case 'req_set_config': {
                controller.setConfig(data);
                send(proto.makeResponse('res_config', { config: controller.getConfig() }, reqId));
                break;
            }

            case 'req_get_config': {
                send(proto.makeResponse('res_config', { config: controller.getConfig() }, reqId));
                break;
            }

            default:
                return false; // 不是 v2 消息
        }
        return true; // 已处理
    } catch (err) {
        send(proto.makeError('INTERNAL', err.message, reqId));
        return true;
    }
}

// ========== v1 CDP 消息处理 (兼容) ==========

let isProcessing = false;
const messageQueue = [];

function enqueueMessage(clientWs, text) {
    messageQueue.push({ clientWs, text });
    drainQueue();
}

async function drainQueue() {
    if (isProcessing) return;
    isProcessing = true;
    while (messageQueue.length > 0) {
        const { clientWs, text } = messageQueue.shift();
        await handleV1Message(clientWs, text);
    }
    isProcessing = false;
}

async function handleV1Message(clientWs, text) {
    if (!cdp || !ide) return;
    const ws = cdp.state.cdpWs;
    const send = (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(data));
    };

    if (!cdp.state.cdpConnected || !ws) {
        send({ type: 'error', message: 'CDP 未连接' });
        return;
    }

    try {
        send({ type: 'status', message: '正在输入到 Antigravity...' });
        const textBefore = await ide.getLastMessageText(ws);
        await ide.focusChatInput(ws);
        await cdp.sleep(300);
        await ide.typeText(ws, text);
        await cdp.sleep(200);
        await ide.pressEnter(ws);
        send({ type: 'status', message: '已发送，等待 AI 回复...' });

        const result = await ide.waitForResponseStream(ws, textBefore, async (msg) => {
            send({ type: 'stream', ...msg });
        });
        send({ type: 'reply', ...result, timedOut: result.timedOut || false });
    } catch (err) {
        send({ type: 'error', message: `处理失败: ${err.message}` });
    }
}

// ========== Express + WebSocket Server ==========

const app = express();
const serverHttp = http.createServer(app);
const wss = new WebSocket.Server({ server: serverHttp });

app.use(express.static(path.join(__dirname, 'public')));

// REST API: 状态
app.get('/api/status', (req, res) => {
    res.json(controller.getStatus());
});

// REST API: 对话列表
app.get('/api/conversations', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    try {
        const list = await controller.listConversations();
        res.json({ total: list.length, conversations: list.slice(0, limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// WebSocket 连接
wss.on('connection', (clientWs) => {
    clients.add(clientWs);
    console.log(`🔗 客户端连接 (总: ${clients.size})`);

    // 发送初始状态
    clientWs.send(proto.makeEvent('event_ls_status', {
        connected: !!controller.ls,
        port: controller.ls?.port || null,
        pid: controller.ls?.pid || null,
    }));

    clientWs.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            // v2 协议: req_* 开头
            if (data.type && data.type.startsWith('req_')) {
                await handleV2Message(clientWs, data);
                return;
            }

            // v1 协议 (CDP 兼容)
            switch (data.type) {
                case 'send_message':
                    enqueueMessage(clientWs, data.text);
                    break;

                case 'reconnect':
                    if (cdp) {
                        const ok = await cdp.forceReconnect();
                        clientWs.send(JSON.stringify({ type: 'cdp_status', connected: ok }));
                    }
                    break;

                case 'screenshot':
                    if (cdp && ide && cdp.state.cdpConnected) {
                        try {
                            const base64 = await ide.takeScreenshot(cdp.state.cdpWs);
                            clientWs.send(JSON.stringify({ type: 'screenshot', data: base64 }));
                        } catch (err) {
                            clientWs.send(JSON.stringify({ type: 'error', message: `截屏失败: ${err.message}` }));
                        }
                    }
                    break;

                case 'get_chats': {
                    const list = await controller.listConversations();
                    clientWs.send(JSON.stringify({
                        type: 'chat_list',
                        current: null,
                        recent: list.slice(0, 50).map(c => ({
                            title: c.title || '(无标题)',
                            id: c.id,
                            workspace: c.workspace || '',
                            updatedAt: c.updatedAt,
                            stepCount: c.stepCount || 0,
                        })),
                        total: list.length,
                    }));
                    break;
                }

                default:
                    console.log(`⚠️ 未知消息类型: ${data.type}`);
            }
        } catch (err) {
            console.error('❌ WS 消息处理错误:', err.message);
        }
    });

    clientWs.on('close', () => {
        clients.delete(clientWs);
        controller.unsubscribeAll(clientWs);
        console.log(`🔌 客户端断开 (总: ${clients.size})`);
    });
});

// ========== 启动 ==========

const PORT = Number(process.env.PORT || 3210);

async function main() {
    console.log('🤖 Antigravity Web Chat v2');
    console.log('═'.repeat(50));

    // 初始化 Controller (gRPC API 路线)
    const lsOk = await controller.init();
    if (lsOk) {
        console.log(`✅ Controller 已初始化`);
    } else {
        console.log('⚠️  Controller 初始化失败 (LS 未找到)');
    }

    // 尝试 CDP 连接 (v1 兼容, 可选)
    if (cdp) {
        try {
            const cdpOk = await cdp.connectCDP();
            if (cdpOk) {
                console.log(`✅ CDP 已连接 (v1 兼容)`);
                cdp.onStatusChange = (connected) => {
                    for (const client of clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'cdp_status', connected }));
                        }
                    }
                };
            } else {
                console.log('⚠️  CDP 连接失败 (v1 功能不可用)');
            }
        } catch {
            console.log('⚠️  CDP 不可用');
        }
    }

    serverHttp.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Web 界面: http://localhost:${PORT}`);
        console.log(`📡 WebSocket: ws://localhost:${PORT}`);
        console.log(`✅ 服务已启动！`);
    });
}

main().catch(err => {
    console.error('❌ 致命错误:', err.message);
    process.exit(1);
});
