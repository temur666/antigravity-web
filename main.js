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
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { Controller } = require('./lib/core/controller');
// grpcCall 已收编到 Controller 内部，此处不再需要
const proto = require('./lib/core/ws-protocol');
const { startBot } = require('./lib/telegram/bot');
const { YoloEngine } = require('./lib/yolo');
const { normalizeSteps } = require('./lib/core/conversation/step-normalizer');

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
    broadcastSSE(proto.makeEvent('event_ls_status', { connected: false, port: null, pid: null }));
});
controller.on('ls_reconnected', (ls) => {
    console.log(`[+] LS 重连成功 PID=${ls.pid} Port=${ls.port}`);
    broadcastSSE(proto.makeEvent('event_ls_status', { connected: true, port: ls.port, pid: ls.pid }));
});
controller.on('status_changed', ({ cascadeId, from, to }) => {
    console.log(`[~] 对话 ${cascadeId.slice(0, 8)}... ${from} -> ${to}`);
});

// ========== YOLO Engine ==========

const yoloEngine = new YoloEngine();

// YOLO 事件广播给所有 SSE 客户端
function broadcastYolo(eventType, payload) {
    broadcastSSE(proto.makeEvent(eventType, payload));
}

yoloEngine.on('started', (data) => {
    console.log(`[YOLO] 已启动 cascade=${data.cascadeId}`);
    broadcastYolo('event_yolo_status', { status: 'running', cascadeId: data.cascadeId, task: data.task });
});
yoloEngine.on('round', (data) => {
    console.log(`[YOLO] 第 ${data.round} 轮完成`);
    broadcastYolo('event_yolo_round', data);
});
yoloEngine.on('step', (data) => {
    broadcastYolo('event_yolo_step', data);
});
yoloEngine.on('done', (data) => {
    console.log(`[YOLO] 结束: ${data.reason} (${data.round} 轮)`);
    broadcastYolo('event_yolo_status', { status: 'stopped', reason: data.reason, summary: data.summary, round: data.round, elapsed: data.elapsed });
});
yoloEngine.on('error', (data) => {
    broadcastYolo('event_yolo_error', data);
});

// ========== SSE 客户端管理 ==========

const sseClients = new Set();

/**
 * 包装 SSE res 对象，使其和 WS 接口兼容
 * @param {import('http').ServerResponse} res
 */
function sseAdapter(res) {
    return {
        isOpen: () => !res.writableEnded,
        send: (msg) => {
            if (!res.writableEnded) {
                res.write(`data: ${msg}\n\n`);
            }
        },
    };
}

/**
 * 向所有 SSE 客户端广播消息
 * @param {string} msg - JSON 字符串
 */
function broadcastSSE(msg) {
    for (const res of sseClients) {
        try {
            if (!res.writableEnded) {
                res.write(`data: ${msg}\n\n`);
            } else {
                sseClients.delete(res);
            }
        } catch {
            sseClients.delete(res);
        }
    }
}

// ========== Express ==========

const app = express();
const serverHttp = http.createServer(app);

// JSON body parser（POST 请求必须；限制 50MB 以支持 base64 图片）
app.use(express.json({ limit: '50mb' }));

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

// ========== SSE 端点 ==========

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx 透传
    res.flushHeaders();

    sseClients.add(res);
    console.log(`[+] SSE 客户端连接 (总: ${sseClients.size})`);

    // 发送初始 LS 状态
    const initMsg = proto.makeEvent('event_ls_status', {
        connected: !!controller.ls,
        port: controller.ls?.port || null,
        pid: controller.ls?.pid || null,
    });
    res.write(`data: ${initMsg}\n\n`);

    // 注册 SSE 适配器到 controller（如果有活跃对话可恢复）
    // 这里只负责推送，subscribe 由前端显式调用

    req.on('close', () => {
        sseClients.delete(res);
        controller.unsubscribeAll(sseAdapter(res));
        // 实际上 unsubscribeAll 按对象引用匹配，这里记录一个清理占位
        // 真正的清理靠 sseClientMap（见下方）
        console.log(`[-] SSE 客户端断开 (总: ${sseClients.size})`);
    });
});

// SSE 订阅 Map: res -> adapter（用于正确的 unsubscribeAll）
const sseClientMap = new Map();

app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const adapter = sseAdapter(res);
    sseClients.add(res);
    sseClientMap.set(res, adapter);
    console.log(`[+] SSE 客户端连接 (总: ${sseClients.size})`);

    // 发送初始 LS 状态
    const initMsg = proto.makeEvent('event_ls_status', {
        connected: !!controller.ls,
        port: controller.ls?.port || null,
        pid: controller.ls?.pid || null,
    });
    res.write(`data: ${initMsg}\n\n`);

    req.on('close', () => {
        sseClients.delete(res);
        const adp = sseClientMap.get(res);
        if (adp) {
            controller.unsubscribeAll(adp);
            sseClientMap.delete(res);
        }
        console.log(`[-] SSE 客户端断开 (总: ${sseClients.size})`);
    });
});

// ========== REST API ==========

app.get('/api/status', async (_req, res) => {
    try {
        const status = controller.getStatus();
        if (controller.ls) {
            const userStatus = await controller.getUserStatus();
            if (userStatus) {
                status.account = userStatus.account;
                status.models = userStatus.models;
                status.defaultModel = userStatus.defaultModel;
            }
        }
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

// POST /api/conversations — 新建对话
app.post('/api/conversations', async (_req, res) => {
    try {
        const cascadeId = await controller.newChat();
        res.json({ cascadeId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config — 获取配置
app.get('/api/config', (_req, res) => {
    res.json({ config: controller.getConfig() });
});

// PUT /api/config — 更新配置
app.put('/api/config', (req, res) => {
    try {
        controller.setConfig(req.body);
        res.json({ config: controller.getConfig() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/yolo/start
app.post('/api/yolo/start', (req, res) => {
    if (yoloEngine.getStatus().running) {
        return res.status(409).json({ error: 'YOLO 已在运行中' });
    }
    const yoloOpts = {
        task: req.body.task || null,
        docPath: req.body.docPath || null,
        timeout: req.body.timeout || undefined,
        cooldown: req.body.cooldown || undefined,
        pollInterval: req.body.pollInterval || undefined,
        agentic: req.body.agentic || false,
        cascadeId: req.body.cascadeId || null,
    };
    res.json({ ok: true });
    yoloEngine.start(yoloOpts).catch((err) => {
        console.error('[YOLO] 启动失败:', err.message);
        broadcastSSE(proto.makeEvent('event_yolo_status', { status: 'error', message: err.message }));
    });
});

// POST /api/yolo/stop
app.post('/api/yolo/stop', (_req, res) => {
    yoloEngine.stop();
    res.json({ ok: true });
});

// GET /api/yolo/status
app.get('/api/yolo/status', (_req, res) => {
    res.json(yoloEngine.getStatus());
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
                steps: normalizeSteps(traj.trajectory.steps || []),
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

// POST /api/conversations/:id/messages — 发送消息
app.post('/api/conversations/:id/messages', async (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });

    const { text, config, mentions, media, traceId } = req.body;
    const traceIdVal = traceId || 'no-trace';
    console.log(`[Trace:3-REST] POST /messages | traceId=${traceIdVal} cascadeId=${cascadeId.slice(0, 8)}`);

    const extras = {};
    if (mentions) extras.mentions = mentions;
    if (media) {
        extras.media = media;
        console.log(`[REST] Media received: ${media.length} items`);
    }
    extras.traceId = traceIdVal;

    const msgText = text || (media && media.length > 0 ? '请查看这张图片' : '');
    if (!msgText) return res.status(400).json({ error: 'Missing text or media' });

    try {
        await controller.sendMessage(cascadeId, msgText, config, extras);
        res.json({ ok: true, cascadeId });
    } catch (err) {
        console.error(`[!] sendMessage REST:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/conversations/:id/subscribe — 订阅实时更新
app.post('/api/conversations/:id/subscribe', (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });

    // 找到对应的 SSE 适配器（按请求头中的 clientId 关联）
    // 注意：SSE 连接和后续 REST 调用是不同的 HTTP 连接
    // 实现方式：客户端在建立 SSE 后，服务端将 adapter 注册到 sseClientMap
    // subscribe 调用时，前端通过 lastSeq 参数，服务端从所有 SSE 客户端进行广播即可
    // 这里只需要启动 stream 订阅，实际广播通过 sseClients 全量推送
    const lastSeq = req.body.lastSeq || null;

    // 用第一个活跃的 SSE adapter 作为占位符（广播是全量的，不需要精确匹配）
    // 如果有多个 SSE 客户端，每个都会收到推送（SSE 类似于广播）
    const adapters = [...sseClientMap.values()];
    if (adapters.length > 0) {
        controller.subscribe(cascadeId, adapters[0], lastSeq);
    }

    const seq = controller.getCurrentSeq(cascadeId);
    res.json({ ok: true, cascadeId, seq });
});

// POST /api/conversations/:id/unsubscribe — 取消订阅
app.post('/api/conversations/:id/unsubscribe', (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });

    const adapters = [...sseClientMap.values()];
    for (const adp of adapters) {
        controller.unsubscribe(cascadeId, adp);
    }
    res.json({ ok: true, cascadeId });
});

// POST /api/conversations/:id/cancel — 取消对话
app.post('/api/conversations/:id/cancel', async (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });
    try {
        await controller.cancelCascade(cascadeId);
        res.json({ ok: true, cascadeId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/conversations/:id — 删除对话
app.delete('/api/conversations/:id', async (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });
    try {
        await controller.deleteConversation(cascadeId);
        // SSE 退订 (路由层关注点)
        for (const adp of sseClientMap.values()) {
            controller.unsubscribe(cascadeId, adp);
        }
        res.json({ ok: true, cascadeId });
    } catch (err) {
        console.error(`[!] DELETE conversation:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/conversations/:id/export — 导出 Markdown
app.get('/api/conversations/:id/export', async (req, res) => {
    const cascadeId = req.params.id;
    if (!cascadeId) return res.status(400).json({ error: 'Missing cascadeId' });
    try {
        const { markdown, title } = await controller.exportMarkdown(cascadeId);
        res.json({ cascadeId, markdown, title });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/conversations/:id/approve-step — 批准 step
app.post('/api/conversations/:id/approve-step', async (req, res) => {
    const cascadeId = req.params.id;
    const { stepIndex } = req.body;
    if (!cascadeId || stepIndex === undefined) {
        return res.status(400).json({ error: 'Missing cascadeId or stepIndex' });
    }
    if (!controller.ls) {
        return res.status(503).json({ error: 'LS not connected' });
    }
    try {
        await controller.approveStep(cascadeId, stepIndex);
        console.log(`[ApproveStep] step[${stepIndex}] approved for ${cascadeId.slice(0, 8)}...`);
        res.json({ ok: true, cascadeId, stepIndex });
    } catch (err) {
        console.error(`[!] ApproveStep REST:`, err.message);
        res.status(500).json({ error: err.message });
    }
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
        console.log(`[*] SSE  : http://localhost:${PORT}/api/events/stream`);
        console.log('');
    });
}

main().catch(err => {
    console.error('[!] 致命错误:', err.message);
    process.exit(1);
});
