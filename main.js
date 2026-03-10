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
const multer = require('multer');

const { Controller } = require('./lib/core/controller');
const { grpcCall } = require('./lib/core/ls-discovery');
const proto = require('./lib/core/ws-protocol');
const { startBot } = require('./lib/telegram/bot');

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
                const limit = data.limit || 50;
                const search = data.search;

                // 策略：索引为主源（包含所有账号/LS 的对话），LS 补充实时状态
                const archive = controller.archive;
                let list = await controller.listConversations();

                // 将索引中独有的对话追加到 LS 列表
                if (archive) {
                    const indexed = archive.index.list({ limit: 500, search });
                    const lsIds = new Set(list.map(c => c.id));
                    for (const row of indexed) {
                        if (!lsIds.has(row.cascade_id)) {
                            list.push({
                                id: row.cascade_id,
                                title: row.title || '',
                                stepCount: row.step_count || 0,
                                status: row.status || 'IDLE',
                                workspace: row.workspace || '',
                                createdAt: row.created_at || null,
                                updatedAt: row.updated_at || null,
                                source: row.source || 'index',
                                account: row.account || '',
                                hasArchive: !!(row.markdown && row.markdown.length > 0),
                            });
                        }
                    }
                    // 重新按 updatedAt 排序
                    list.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
                }

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

                // 优先 LS API 获取实时 steps
                let traj = null;
                try {
                    traj = await controller.getTrajectory(data.cascadeId);
                } catch { /* LS 可能不可用 */ }

                if (traj?.trajectory?.steps?.length > 0) {
                    send(proto.makeResponse('res_trajectory', {
                        cascadeId: data.cascadeId,
                        status: traj.status || 'CASCADE_RUN_STATUS_IDLE',
                        steps: traj.trajectory.steps,
                        totalSteps: traj.numTotalSteps || traj.trajectory.steps.length,
                        metadata: traj.trajectory.generatorMetadata || [],
                        seq: controller.getCurrentSeq(data.cascadeId),
                        source: 'live',
                    }, reqId));
                    break;
                }

                // 降级：从索引获取 markdown 归档
                const archiveRow = controller.archive?.index.get(data.cascadeId);
                if (archiveRow && archiveRow.markdown) {
                    send(proto.makeResponse('res_trajectory', {
                        cascadeId: data.cascadeId,
                        status: 'CASCADE_RUN_STATUS_IDLE',
                        steps: [],
                        totalSteps: archiveRow.step_count || 0,
                        metadata: [],
                        seq: 0,
                        source: 'archive',
                        markdown: archiveRow.markdown,
                        title: archiveRow.title || '',
                    }, reqId));
                    break;
                }

                // 既无实时数据也无归档 → 返回空
                send(proto.makeResponse('res_trajectory', {
                    cascadeId: data.cascadeId,
                    status: traj?.status || 'CASCADE_RUN_STATUS_IDLE',
                    steps: traj?.trajectory?.steps || [],
                    totalSteps: traj?.numTotalSteps || 0,
                    metadata: traj?.trajectory?.generatorMetadata || [],
                    seq: controller.getCurrentSeq(data.cascadeId),
                    source: 'live',
                }, reqId));
                break;
            }

            case 'req_new_chat': {
                const cascadeId = await controller.newChat();
                send(proto.makeResponse('res_new_chat', { cascadeId }, reqId));
                break;
            }

            case 'req_send_message': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                const extras = {};
                if (data.mentions) extras.mentions = data.mentions;
                if (data.media) {
                    extras.media = data.media;
                    console.log(`[WS] Media received: ${data.media.length} items, sizes: ${data.media.map(m => (m.data?.length || 0) + ' (' + m.mimeType + ')').join(', ')}`);
                }
                // 有 media 但无 text 时，使用默认提示文字
                const msgText = data.text || (data.media && data.media.length > 0 ? '请查看这张图片' : '');
                if (!msgText) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing text or media', reqId));
                    break;
                }
                await controller.sendMessage(data.cascadeId, msgText, data.config, extras);
                controller.subscribe(data.cascadeId, clientWs, data.lastSeq || null);
                send(proto.makeResponse('res_send_message', { ok: true, cascadeId: data.cascadeId }, reqId));
                break;
            }

            case 'req_subscribe': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                controller.subscribe(data.cascadeId, clientWs, data.lastSeq || null);
                send(proto.makeResponse('res_subscribe', {
                    ok: true,
                    cascadeId: data.cascadeId,
                    seq: controller.getCurrentSeq(data.cascadeId),
                }, reqId));
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

            case 'req_cancel': {
                if (!data.cascadeId) {
                    send(proto.makeError('INVALID_PARAMS', 'Missing cascadeId', reqId));
                    break;
                }
                await controller.cancelCascade(data.cascadeId);
                send(proto.makeResponse('res_cancel', { ok: true, cascadeId: data.cascadeId }, reqId));
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

// Hashed assets (Vite content hash): 1 年不可变缓存
app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
}));

// 其他静态文件: HTML/SW 不缓存（总是验证），其他 1 小时
app.use(express.static(distPath, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    },
}));

// SPA fallback: 所有非 API 路径返回 index.html
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
});

// REST API
app.get('/api/status', (_req, res) => {
    res.json(controller.getStatus());
});

app.get('/api/conversations', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const account = req.query.account || null;
    const source = req.query.source || null;
    const search = req.query.search || null;

    try {
        // 从索引获取（如果有过滤条件，直接走索引）
        const archive = controller.archive;
        if (archive && (account || source || search)) {
            const indexed = archive.index.list({ limit, account, source, search });
            const conversations = indexed.map(row => ({
                id: row.cascade_id,
                title: row.title || '',
                stepCount: row.step_count || 0,
                status: row.status || 'IDLE',
                account: row.account || '',
                source: row.source || '',
                workspace: row.workspace || '',
                createdAt: row.created_at || null,
                updatedAt: row.updated_at || null,
                hasArchive: !!(row.markdown && row.markdown.length > 0),
            }));
            return res.json({ total: conversations.length, conversations });
        }

        // 无过滤条件时走原有逻辑（LS + .pb + SQLite 融合）
        const list = await controller.listConversations();

        // 补充索引中的额外字段
        if (archive) {
            for (const conv of list) {
                const row = archive.index.get(conv.id);
                if (row) {
                    conv.account = conv.account || row.account || '';
                    conv.source = conv.source || row.source || '';
                    conv.hasArchive = !!(row.markdown && row.markdown.length > 0);
                }
            }
        }

        res.json({ total: list.length, conversations: list.slice(0, limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/conversations/:id', async (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) {
        return res.status(400).json({ error: 'Missing conversation id' });
    }

    try {
        // 优先 LS API
        const traj = await controller.getTrajectory(cascadeId);
        if (traj && traj.trajectory) {
            return res.json({
                id: cascadeId,
                status: (traj.status || '').replace('CASCADE_RUN_STATUS_', ''),
                steps: traj.trajectory.steps || [],
                totalSteps: traj.numTotalSteps || 0,
                source: 'live',
            });
        }
    } catch { /* LS 不可用，降级到归档 */ }

    // 降级: 从索引获取 markdown 归档
    const archive = controller.archive;
    if (archive) {
        const row = archive.index.get(cascadeId);
        if (row) {
            return res.json({
                id: cascadeId,
                title: row.title || '',
                status: row.status || 'IDLE',
                stepCount: row.step_count || 0,
                markdown: row.markdown || '',
                account: row.account || '',
                source: 'archive',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            });
        }
    }

    res.status(404).json({ error: 'Conversation not found' });
});

// ========== File Read API ==========

const FILE_ROOT = process.env.FILE_ROOT || __dirname;

app.get('/api/file', async (req, res) => {
    const relPath = req.query.path;
    if (!relPath || typeof relPath !== 'string') {
        return res.status(400).json({ error: 'Missing path parameter' });
    }

    // 安全校验：realpath 防目录穿越
    const absPath = path.resolve(FILE_ROOT, relPath);
    try {
        const realAbs = fs.realpathSync(absPath);
        const realRoot = fs.realpathSync(FILE_ROOT);
        if (!realAbs.startsWith(realRoot + path.sep) && realAbs !== realRoot) {
            return res.status(403).json({ error: 'Access denied: path outside project root' });
        }

        const stat = fs.statSync(realAbs);
        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Not a file' });
        }

        // 限制文件大小 (5MB)
        if (stat.size > 5 * 1024 * 1024) {
            return res.status(413).json({ error: 'File too large (max 5MB)' });
        }

        const content = fs.readFileSync(realAbs, 'utf-8');
        const ext = path.extname(realAbs).slice(1); // 不带点

        res.json({
            content,
            filename: path.basename(realAbs),
            path: path.relative(realRoot, realAbs),
            extension: ext,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
        });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found' });
        }
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/fs/list', async (req, res) => {
    const relPath = req.query.path || '';
    if (typeof relPath !== 'string') {
        return res.status(400).json({ error: 'Invalid path parameter' });
    }

    const absPath = path.resolve(FILE_ROOT, relPath);
    try {
        const realAbs = fs.realpathSync(absPath);
        const realRoot = fs.realpathSync(FILE_ROOT);
        if (!realAbs.startsWith(realRoot + path.sep) && realAbs !== realRoot) {
            return res.status(403).json({ error: 'Access denied: path outside project root' });
        }

        const stat = fs.statSync(realAbs);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Not a directory' });
        }

        const entries = fs.readdirSync(realAbs, { withFileTypes: true });

        // 分离文件夹和文件，并排序
        const dirs = [];
        const files = [];

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue; // 忽略隐藏文件
            if (entry.name === 'node_modules') continue;

            const item = {
                name: entry.name,
                path: path.relative(realRoot, path.join(realAbs, entry.name)),
                isDir: entry.isDirectory()
            };

            if (item.isDir) {
                dirs.push(item);
            } else {
                files.push(item);
            }
        }

        // 排序规则: a-z
        const sortFn = (a, b) => a.name.localeCompare(b.name);
        dirs.sort(sortFn);
        files.sort(sortFn);

        res.json({
            path: path.relative(realRoot, realAbs) || '.',
            items: [...dirs, ...files]
        });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Directory not found' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// ========== File Upload ==========
const uploadDir = path.join('/tmp', 'antigravity_uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadDir);
    },
    filename: function (_req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '';
        cb(null, 'upload-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    let mimeType = req.file.mimetype;
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

    res.json({
        uri: `file://${req.file.path}`,
        mimeType: mimeType,
        originalName: req.file.originalname,
        size: req.file.size
    });
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
            const str = raw.toString();

            // 心跳: 前端发 ping，回复 pong（不走 JSON 路径）
            if (str === 'ping') {
                if (clientWs.readyState === WebSocket.OPEN) clientWs.send('pong');
                return;
            }

            const data = JSON.parse(str);
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

    // Telegram Bot (非阻塞启动，失败不影响 Web 服务)
    startBot(controller).catch(err => {
        console.error('[TG] Bot 启动失败:', err.message);
    });

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
