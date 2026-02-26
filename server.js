/**
 * Antigravity Web Chat — 后端
 *
 * Express 静态文件 + WebSocket 双向通信
 * 通过 CDP 操控 Antigravity IDE 的 Chat 面板
 *
 * 模块结构:
 *   lib/cdp.js  — CDP 通信层（连接、消息发送、JS 求值）
 *   lib/ide.js  — IDE 操作层（Chat 面板 DOM 操控）
 *   server.js   — Web 服务 + 客户端消息路由（本文件）
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const cdp = require('./lib/cdp');
const ide = require('./lib/ide');
const { getConversations } = require('./lib/conversations');

// ========== WebSocket 客户端管理 ==========

const clients = new Set();

function broadcastToClients(data) {
    const msg = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

// CDP 状态变化时通知所有客户端
cdp.onStatusChange = (connected) => {
    broadcastToClients({ type: 'cdp_status', connected });
};

// ========== 消息队列 ==========

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
        await handleMessage(clientWs, text);
    }
    isProcessing = false;
}

// ========== 消息处理 ==========

async function handleMessage(clientWs, text) {
    const ws = cdp.state.cdpWs;
    const send = (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(data));
        }
    };

    if (!cdp.state.cdpConnected || !ws) {
        send({ type: 'error', message: 'CDP 未连接，请先点击重连' });
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
            send({
                type: 'stream',
                thinking: msg.thinking,
                thinkingHtml: msg.thinkingHtml || '',
                blocks: msg.blocks || [],
                reply: msg.reply,
                replyHtml: msg.replyHtml || '',
                tools: msg.tools || [],
            });
        });

        send({
            type: 'reply',
            thinking: result.thinking,
            thinkingHtml: result.thinkingHtml || '',
            blocks: result.blocks || [],
            reply: result.reply,
            replyHtml: result.replyHtml || '',
            tools: result.tools || [],
            timedOut: result.timedOut || false,
        });

    } catch (err) {
        send({ type: 'error', message: `处理失败: ${err.message}` });
    }
}

// ========== Express + WebSocket Server ==========

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// REST API: 获取对话列表
app.get('/api/conversations', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const result = getConversations();
    if (result.error) {
        return res.status(500).json({ error: result.error });
    }
    res.json({
        total: result.total,
        conversations: result.conversations.slice(0, limit),
    });
});

wss.on('connection', (clientWs) => {
    clients.add(clientWs);
    console.log(`🔗 客户端连接 (总: ${clients.size})`);

    // 发送当前状态
    clientWs.send(JSON.stringify({ type: 'cdp_status', connected: cdp.state.cdpConnected }));

    clientWs.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            switch (data.type) {
                case 'send_message':
                    enqueueMessage(clientWs, data.text);
                    break;

                case 'reconnect': {
                    const ok = await cdp.forceReconnect();
                    clientWs.send(JSON.stringify({ type: 'cdp_status', connected: ok }));
                    break;
                }

                case 'screenshot':
                    if (!cdp.state.cdpConnected) { clientWs.send(JSON.stringify({ type: 'error', message: 'CDP 未连接' })); break; }
                    try {
                        const base64 = await ide.takeScreenshot(cdp.state.cdpWs);
                        clientWs.send(JSON.stringify({ type: 'screenshot', data: base64 }));
                    } catch (err) {
                        clientWs.send(JSON.stringify({ type: 'error', message: `截屏失败: ${err.message}` }));
                    }
                    break;

                case 'new_chat':
                    if (!cdp.state.cdpConnected) { clientWs.send(JSON.stringify({ type: 'error', message: 'CDP 未连接' })); break; }
                    try {
                        await ide.createNewChat(cdp.state.cdpWs);
                        clientWs.send(JSON.stringify({ type: 'new_chat_ok' }));
                    } catch (err) {
                        clientWs.send(JSON.stringify({ type: 'error', message: `新建对话失败: ${err.message}` }));
                    }
                    break;

                case 'get_chats': {
                    // 方案 A: 直接读取 SQLite 数据库 (无需 CDP 连接)
                    try {
                        const result = getConversations();
                        if (result.error) {
                            clientWs.send(JSON.stringify({ type: 'error', message: result.error }));
                        } else {
                            // 返回最近的对话列表（前 50 条）
                            clientWs.send(JSON.stringify({
                                type: 'chat_list',
                                current: null,
                                recent: result.conversations.slice(0, 50).map(c => ({
                                    title: c.title || '(无标题)',
                                    id: c.id,
                                    workspace: c.workspace || '',
                                    updatedAt: c.updatedAt,
                                    stepCount: c.stepCount,
                                })),
                                total: result.total,
                            }));
                        }
                    } catch (err) {
                        clientWs.send(JSON.stringify({ type: 'error', message: `获取对话列表失败: ${err.message}` }));
                    }
                    break;
                }

                case 'open_chat':
                    if (!cdp.state.cdpConnected) { clientWs.send(JSON.stringify({ type: 'error', message: 'CDP 未连接' })); break; }
                    try {
                        await ide.openHistoryModal(cdp.state.cdpWs);
                        await ide.clickConversation(cdp.state.cdpWs, data.index);
                        clientWs.send(JSON.stringify({ type: 'open_chat_ok', index: data.index }));
                    } catch (err) {
                        try { await ide.closeHistoryModal(cdp.state.cdpWs); } catch { }
                        clientWs.send(JSON.stringify({ type: 'error', message: `打开对话失败: ${err.message}` }));
                    }
                    break;

                case 'read_last':
                    if (!cdp.state.cdpConnected) { clientWs.send(JSON.stringify({ type: 'error', message: 'CDP 未连接' })); break; }
                    try {
                        const msg = await ide.getLastMessage(cdp.state.cdpWs);
                        clientWs.send(JSON.stringify({ type: 'reply', ...msg, timedOut: false }));
                    } catch (err) {
                        clientWs.send(JSON.stringify({ type: 'error', message: `读取失败: ${err.message}` }));
                    }
                    break;
            }
        } catch (err) {
            console.error('❌ WS 消息处理错误:', err.message);
        }
    });

    clientWs.on('close', () => {
        clients.delete(clientWs);
        console.log(`🔌 客户端断开 (总: ${clients.size})`);
    });
});

// ========== 启动 ==========

const PORT = Number(process.env.PORT || 3210);

async function main() {
    console.log('🤖 Antigravity Web Chat');
    console.log('='.repeat(50));
    console.log(`🎯 CDP target: ${cdp.CDP_HOST}:${cdp.CDP_PORT}`);

    const connected = await cdp.connectCDP();
    if (!connected) {
        console.log('⚠️  CDP 连接失败，可在前端点击重连');
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Web 界面: http://localhost:${PORT}`);
        console.log(`✅ 服务已启动！`);
    });
}

main().catch(err => {
    console.error('❌ 致命错误:', err.message);
    process.exit(1);
});
