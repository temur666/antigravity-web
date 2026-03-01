/**
 * main.js — Antigravity Web 生产入口
 *
 * 服务 frontend/dist/ 静态文件 + WebSocket + REST API。
 *
 * 启动: node main.js (或 pm2 start ecosystem.config.js)
 * 端口: PORT 环境变量 或 3210
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const { Controller } = require('./lib/core/controller');
const { grpcCall } = require('./lib/core/ls-discovery');
const proto = require('./lib/core/ws-protocol');

// ========== 静态文件检查 ==========

const distPath = path.join(__dirname, 'frontend', 'dist');
if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    console.error('[!] frontend/dist/index.html 不存在，请先执行: npm run build:frontend');
    process.exit(1);
}

// ========== Controller ==========

const controller = new Controller();

controller.on('error', (err) => console.error('[!] Controller:', err.message));
controller.on('ls_connected', (ls) => console.log(`[+] LS 已连接 PID=${ls.pid} Port=${ls.port}`));
controller.on('ls_disconnected', () => {
    console.log('[-] LS 断开');
    const msg = proto.makeEvent('event_ls_status', { connected: false, port: null, pid: null });
    for (const ws of clients) {
        try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch { /* ignore */ }
    }
});
controller.on('ls_reconnected', (ls) => {
    console.log(`[+] LS 重连成功 PID=${ls.pid} Port=${ls.port}`);
    const msg = proto.makeEvent('event_ls_status', { connected: true, port: ls.port, pid: ls.pid });
    for (const ws of clients) {
        try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch { /* ignore */ }
    }
});
controller.on('status_changed', ({ cascadeId, from, to }) => {
    console.log(`[~] 对话 ${cascadeId.slice(0, 8)}... ${from} -> ${to}`);
});

// ========== WebSocket 客户端管理 ==========

const clients = new Set();

// ========== 消息处理 ==========

async function handleMessage(clientWs, data) {
    const { type, reqId } = data;
    const send = (msg) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(msg);
    };

    try {
        switch (type) {
            case 'req_status': {
                const status = controller.getStatus();
                if (controller.ls) {
                    try {
                        const r = await grpcCall(controller.ls.port, controller.ls.csrf, 'GetUserStatus', {});
                        const us = r.data?.userStatus || {};
                        status.account = {
                            email: us.email || '',
                            tier: us.userTier?.name || '',
                        };
                        const modelConfigs = us.cascadeModelConfigData?.clientModelConfigs || [];
                        status.models = modelConfigs.map(c => ({
                            label: c.label,
                            model: c.modelOrAlias?.model,
                            supportsImages: c.supportsImages || false,
                            supportedMimeTypes: c.supportedMimeTypes || {},
                            quota: c.quotaInfo?.remainingFraction,
                            tag: c.tagTitle || '',
                        }));
                        status.defaultModel = us.cascadeModelConfigData?.defaultOverrideModelConfig?.modelOrAlias?.model || null;
                    } catch (err) {
                        console.warn('[!] GetUserStatus:', err.message);
                    }
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
                    status: traj?.status || 'CASCADE_RUN_STATUS_IDLE',
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
                const extras = {};
                if (data.mentions) extras.mentions = data.mentions;
                if (data.media) extras.media = data.media;
                await controller.sendMessage(data.cascadeId, data.text, data.config, extras);
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
                send(proto.makeResponse('res_unsubscribe', { ok: true, cascadeId: data.cascadeId }, reqId));
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
                send(proto.makeError('UNKNOWN_TYPE', `Unknown message type: ${type}`, reqId));
        }
    } catch (err) {
        send(proto.makeError('INTERNAL', err.message, reqId));
    }
}

// ========== Express + WebSocket ==========

const app = express();
const serverHttp = http.createServer(app);
const wss = new WebSocket.Server({ server: serverHttp });

// 静态文件
app.use(express.static(distPath));

// SPA fallback: 所有非 API 路径返回 index.html
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
});

// REST API
app.get('/api/status', (_req, res) => {
    res.json(controller.getStatus());
});

app.get('/api/conversations', async (_req, res) => {
    const limit = Math.min(Number(_req.query.limit) || 50, 500);
    try {
        const list = await controller.listConversations();
        res.json({ total: list.length, conversations: list.slice(0, limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// WebSocket
wss.on('connection', (clientWs) => {
    clients.add(clientWs);
    console.log(`[+] 客户端连接 (总: ${clients.size})`);

    // 发送 LS 初始状态
    clientWs.send(proto.makeEvent('event_ls_status', {
        connected: !!controller.ls,
        port: controller.ls?.port || null,
        pid: controller.ls?.pid || null,
    }));

    clientWs.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (!data.type) {
                clientWs.send(proto.makeError('INVALID_PARAMS', 'Missing type field'));
                return;
            }
            await handleMessage(clientWs, data);
        } catch (err) {
            console.error('[!] WS 消息处理错误:', err.message);
        }
    });

    clientWs.on('close', () => {
        clients.delete(clientWs);
        controller.unsubscribeAll(clientWs);
        console.log(`[-] 客户端断开 (总: ${clients.size})`);
    });
});

// ========== 启动 ==========

const PORT = Number(process.env.PORT || 3210);

async function main() {
    console.log('==================================================');
    console.log('  Antigravity Web — Production');
    console.log('==================================================');

    const lsOk = await controller.init();
    if (lsOk) {
        console.log('[+] Controller 已初始化');
    } else {
        console.log('[!] Controller 初始化失败 (LS 未找到)');
    }

    console.log(`[*] 静态文件: ${distPath}`);

    serverHttp.listen(PORT, '0.0.0.0', () => {
        console.log(`[*] HTTP : http://localhost:${PORT}`);
        console.log(`[*] WS   : ws://localhost:${PORT}`);
        console.log('');
    });
}

main().catch(err => {
    console.error('[!] 致命错误:', err.message);
    process.exit(1);
});
