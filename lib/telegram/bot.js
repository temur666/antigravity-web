/**
 * lib/telegram/bot.js — Telegram Bot 模块
 *
 * 内嵌在 main.js 中，共享 Controller 实例。
 * 提供 Telegram 端的全部命令和消息处理。
 *
 * 启动: startBot(controller) — 在 main.js 初始化后调用
 *
 * 命令:
 *   /start       帮助信息
 *   /status      LS 连接状态 + 当前对话
 *   /reconnect   刷新 LS 连接
 *   /chats       对话列表
 *   /open N      切换到第 N 个对话
 *   /new         新建对话
 *   /read        读取最新 AI 回复
 *   /readall     读取完整对话
 *   /screenshot  截屏 (需 CDP)
 *   /newfeature  创建 Forum Topic
 *   message      发送文字/图片给 AI
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Bot, InputFile } = require('grammy');

const {
    BOT_TOKEN, ALLOWED_USER_ID,
    STREAM_UPDATE_MS, DRAFT_UPDATE_MS,
    EMOJI, STATE_FILE,
} = require('./config');
const { ce, esc, safeEditText, truncateForTG, splitForTG } = require('./utils');
const fmt = require('./format');

// ========== 状态持久化 ==========

/**
 * 读取持久化状态
 * @returns {{ currentCascadeId: string|null }}
 */
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            if (!data.chats) data.chats = {};
            if (data.currentCascadeId) {
                data.chats['default'] = data.currentCascadeId;
                delete data.currentCascadeId;
            }
            return data;
        }
    } catch { /* ignore */ }
    return { chats: {} };
}

function getChatKey(ctx) {
    if (!ctx || !ctx.chat) return 'default';
    const threadId = ctx.message?.message_thread_id || ctx.callback_query?.message?.message_thread_id;
    return `${ctx.chat.id}${threadId ? `_${threadId}` : ''}`;
}

function setCascadeId(botState, ctx, cascadeId) {
    if (!botState.chats) botState.chats = {};
    botState.chats[getChatKey(ctx)] = cascadeId;
    saveState(botState);
}

/**
 * 写入持久化状态
 * @param {{ currentCascadeId: string|null }} state
 */
function saveState(state) {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[TG] 状态持久化失败:', err.message);
    }
}

// ========== MockWs 适配器 ==========

/**
 * 创建一个 MockWs 对象，用于 controller.subscribe。
 * 收到消息时调用 onMessage 回调。
 * @param {(data: object) => void} onMessage
 * @returns {{ readyState: number, send: (msg: string) => void, close: () => void }}
 */
function createMockWs(onMessage) {
    return {
        readyState: 1, // WebSocket.OPEN
        send(msg) {
            try {
                const data = JSON.parse(msg);
                onMessage(data);
            } catch { /* ignore parse errors */ }
        },
        close() {
            this.readyState = 3; // WebSocket.CLOSED
        },
    };
}

// ========== 文件下载 ==========

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
                return;
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

// ========== 消息队列 ==========

let isProcessing = false;
const messageQueue = [];

function enqueueMessage(task) {
    messageQueue.push(task);
    drainQueue();
}

async function drainQueue() {
    if (isProcessing) return;
    isProcessing = true;
    while (messageQueue.length > 0) {
        const task = messageQueue.shift();
        try {
            await task();
        } catch (err) {
            console.error('[TG] 队列处理错误:', err.message);
        }
    }
    isProcessing = false;
}

// ========== 核心: 发送消息并逐 Step 回复 ==========

/**
 * 安全发送消息（HTML 失败时降级纯文本，超长自动拆分）
 * @param {import('grammy').Context} ctx
 * @param {string} html
 * @param {object} [extraOpts]
 * @returns {Promise<void>}
 */
async function safeSendChunks(ctx, html, extraOpts = {}) {
    const chunks = splitForTG(html);
    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, { parse_mode: 'HTML', ...extraOpts });
        } catch (err) {
            if (err.error_code === 400) {
                // HTML 解析失败，降级纯文本
                const plain = chunk.replace(/<[^>]+>/g, '');
                await ctx.reply(plain, extraOpts);
            } else {
                throw err;
            }
        }
        // 每发一条等 1 秒，尊重 Telegram 频率限制
        if (chunks.length > 1) {
            await new Promise(r => setTimeout(r, STREAM_UPDATE_MS));
        }
    }
}

/**
 * 发送消息到当前对话并逐 Step 回复
 * @param {import('grammy').Context} ctx
 * @param {import('../core/controller').Controller} controller
 * @param {string} cascadeId
 * @param {string} text
 * @param {object} [extras]
 */
async function sendAndStream(ctx, controller, cascadeId, text, extras = {}) {
    let statusMsg;

    try {
        // Step 0: 状态消息
        statusMsg = await ctx.reply(`${ce(EMOJI.TYPING)} 正在发送...`, { parse_mode: 'HTML' });

        // Step 1: 发送消息
        await controller.sendMessage(cascadeId, text, null, extras);

        await safeEditText(ctx.api, ctx.chat.id, statusMsg.message_id,
            `${ce(EMOJI.SEND)} 已发送，等待 AI 回复...`, 'HTML'
        );

        // Step 2: 订阅实时更新
        let finished = false;
        let sentStepCount = 0;
        let lastSendTime = 0;
        const allSteps = [];

        const mockWs = createMockWs((data) => {
            if (finished) return;

            if (data.type === 'event_step_added') {
                data.step._stepIndex = data.stepIndex;
                allSteps.push(data.step);
            } else if (data.type === 'event_step_updated') {
                if (data.step) {
                    data.step._stepIndex = data.stepIndex;
                    let found = false;
                    for (let i = 0; i < allSteps.length; i++) {
                        if (allSteps[i]._stepIndex === data.stepIndex) {
                            allSteps[i] = data.step;
                            found = true;
                            break;
                        }
                    }
                    if (!found) allSteps.push(data.step);
                }
            } else if (data.type === 'event_status_changed') {
                if (data.to === 'IDLE' || data.to === 'ERROR') {
                    finished = true;
                }
            }
        });

        controller.subscribe(cascadeId, mockWs);

        // Step 3: 轮询发送已完成的 Step（1秒/条）
        const timeout = 300000;
        const startTime = Date.now();

        while ((!finished || sentStepCount < allSteps.length) && (Date.now() - startTime) < timeout) {
            // 确定可发送的 Step 数量：未完成时保留最后一个（可能还在更新）
            const sendableCount = finished ? allSteps.length : Math.max(0, allSteps.length - 1);

            if (sentStepCount < sendableCount) {
                const now = Date.now();
                if (now - lastSendTime >= STREAM_UPDATE_MS) {
                    const step = allSteps[sentStepCount];
                    const formatted = fmt.formatStep(step);
                    sentStepCount++;

                    if (formatted) {
                        await safeSendChunks(ctx, formatted);
                        lastSendTime = Date.now();
                    }
                    continue; // 立即检查下一个
                }
            }

            await new Promise(r => setTimeout(r, 300));
        }

        // Step 4: 取消订阅
        controller.unsubscribe(cascadeId, mockWs);
        mockWs.close();

        // Step 5: 删除状态消息，发送完成通知
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch { /* ignore */ }

        if (!finished) {
            await ctx.reply(`⚠️ 等待超时 (${Math.round(timeout / 1000)}s)`, { parse_mode: 'HTML' });
        }

    } catch (err) {
        console.error('[TG] sendAndStream 错误:', err.message);
        const errMsg = `${ce(EMOJI.CROSS)} 处理失败: ${esc(err.message)}`;
        if (statusMsg) {
            await safeEditText(ctx.api, ctx.chat.id, statusMsg.message_id, errMsg, 'HTML');
        } else {
            await ctx.reply(errMsg, { parse_mode: 'HTML' });
        }
    } finally {
        // 清理临时媒体文件
        if (extras && extras.media) {
            for (const m of extras.media) {
                if (m.uri && m.uri.startsWith('file://')) {
                    try { fs.unlinkSync(m.uri.replace('file://', '')); } catch { /* ignore */ }
                }
            }
        }
    }
}

// ========== Bot 启动 ==========

/**
 * 启动 Telegram Bot
 * @param {import('../core/controller').Controller} controller
 * @returns {Promise<import('grammy').Bot>}
 */
async function startBot(controller) {
    if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN') {
        console.log('[TG] BOT_TOKEN 未配置，跳过 Telegram Bot');
        return null;
    }

    const botState = loadState();
    const bot = new Bot(BOT_TOKEN);

    // ========== 权限中间件 ==========

    bot.use(async (ctx, next) => {
        if (ctx.from?.id !== ALLOWED_USER_ID) {
            console.log(`[TG] 未授权: user_id=${ctx.from?.id}`);
            await ctx.reply(`${ce(EMOJI.STOP)} 你没有权限使用此 Bot`, { parse_mode: 'HTML' });
            return;
        }
        await next();
    });

    // ========== 辅助: 确保有当前对话 ==========

    async function ensureCascadeId(ctx) {
        const key = getChatKey(ctx);
        if (botState.chats && botState.chats[key]) return botState.chats[key];
        if (botState.chats && botState.chats['default']) return botState.chats['default'];

        // 尝试取最近的对话
        try {
            const list = await controller.listConversations();
            if (list.length > 0) {
                setCascadeId(botState, ctx, list[0].id);
                return list[0].id;
            }
        } catch { /* ignore */ }

        return null;
    }

    // ========== /start ==========

    bot.command('start', async (ctx) => {
        const lines = [
            `${ce(EMOJI.ROCKET)} <b>Antigravity Web — Telegram</b>`,
            '',
            '直接发消息 → 转发给 AI，流式返回回复',
            '',
            `${ce(EMOJI.COMPUTER)} <b>对话:</b>`,
            '/read        读取最新 AI 回复',
            '/readall     读取完整对话',
            '/new         创建新对话',
            '/screenshot  截取 IDE 界面',
            '',
            `${ce(EMOJI.TOPIC)} <b>历史:</b>`,
            '/chats       查看对话列表',
            '/open N      切换到第 N 个对话',
            '',
            `${ce(EMOJI.STATUS)} <b>系统:</b>`,
            '/status      连接状态',
            '/reconnect   刷新 LS 连接',
            '',
            `${ce(EMOJI.IMAGE)} 发送图片 → 自动转发给 AI`,
        ];
        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    });

    // ========== /status ==========

    bot.command('status', async (ctx) => {
        const status = controller.getStatus();
        const lsIcon = status.ls?.connected ? ce(EMOJI.CHECK) : ce(EMOJI.CROSS);
        const lsStatus = status.ls?.connected ? '已连接' : '未连接';
        const cascadeId = botState.chats ? (botState.chats[getChatKey(ctx)] || botState.chats['default']) : null;
        const cascadeDisplay = cascadeId ? `<code>${cascadeId.slice(0, 8)}...</code>` : '(未设置)';

        const lines = [
            `${ce(EMOJI.STATUS)} <b>系统状态</b>`,
            '',
            `LS: ${lsIcon} ${lsStatus}`,
            status.ls?.connected ? `Port: ${status.ls.port} | PID: ${status.ls.pid}` : '',
            '',
            `当前对话: ${cascadeDisplay}`,
            `对话总数: ${status.conversations?.total || 0}`,
            `运行中: ${status.conversations?.running || 0}`,
        ].filter(Boolean);

        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    });

    // ========== /reconnect ==========

    bot.command('reconnect', async (ctx) => {
        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在刷新 LS 连接...`, { parse_mode: 'HTML' });
        const ok = await controller.refreshLS();
        if (ok) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CHECK)} LS 重新连接成功！`, 'HTML');
        } else {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} LS 重新连接失败`, 'HTML');
        }
    });

    // ========== /chats ==========

    bot.command('chats', async (ctx) => {
        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在获取对话列表...`, { parse_mode: 'HTML' });
        try {
            const list = await controller.listConversations();
            const lines = [`${ce(EMOJI.TOPIC)} <b>对话列表</b> (共 ${list.length} 个)\n`];

            const currentId = botState.chats ? (botState.chats[getChatKey(ctx)] || botState.chats['default']) : null;
            for (let i = 0; i < display.length; i++) {
                const conv = display[i];
                const isCurrent = conv.id === currentId;
                const marker = isCurrent ? ' ◀️' : '';
                const title = conv.title || '(无标题)';
                const time = conv.updatedAt ? new Date(conv.updatedAt).toLocaleDateString('zh-CN') : '';
                lines.push(`  <code>${i}</code>  ${esc(title)}${marker}${time ? `  <i>${time}</i>` : ''}`);
            }

            if (list.length > 20) {
                lines.push(`\n<i>还有 ${list.length - 20} 个对话未显示</i>`);
            }

            lines.push(`\n💡 使用 <code>/open N</code> 切换对话`);
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id, lines.join('\n'), 'HTML');
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 获取列表失败: ${esc(err.message)}`, 'HTML');
        }
    });

    // ========== /open N ==========

    bot.command('open', async (ctx) => {
        const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
        const index = parseInt(arg);
        if (isNaN(index) || index < 0) {
            await ctx.reply(
                `${ce(EMOJI.CROSS)} 请提供对话编号\n例如: <code>/open 2</code>\n\n💡 先用 <code>/chats</code> 查看列表`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在切换...`, { parse_mode: 'HTML' });
        try {
            const list = await controller.listConversations();
            if (index >= list.length) {
                await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                    `${ce(EMOJI.CROSS)} 编号 ${index} 超出范围 (共 ${list.length} 个)`, 'HTML');
                return;
            }

            const conv = list[index];
            setCascadeId(botState, ctx, conv.id);

            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CHECK)} 已切换到对话 #${index}\n\n` +
                `📌 <b>${esc(conv.title || '(无标题)')}</b>\n` +
                `ID: <code>${conv.id.slice(0, 8)}...</code>`,
                'HTML'
            );
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 切换失败: ${esc(err.message)}`, 'HTML');
        }
    });

    // ========== /new ==========

    bot.command('new', async (ctx) => {
        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在创建新对话...`, { parse_mode: 'HTML' });
        try {
            const cascadeId = await controller.newChat();
            if (!cascadeId) throw new Error('创建失败');

            setCascadeId(botState, ctx, cascadeId);

            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CHECK)} 新对话已创建\nID: <code>${cascadeId.slice(0, 8)}...</code>`,
                'HTML'
            );
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 创建失败: ${esc(err.message)}`, 'HTML');
        }
    });

    // ========== /read ==========

    bot.command('read', async (ctx) => {
        const cascadeId = await ensureCascadeId(ctx);
        if (!cascadeId) {
            await ctx.reply(`${ce(EMOJI.CROSS)} 没有当前对话。请先 <code>/chats</code> + <code>/open N</code> 或 <code>/new</code>`, { parse_mode: 'HTML' });
            return;
        }

        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在读取...`, { parse_mode: 'HTML' });
        try {
            const traj = await controller.getTrajectory(cascadeId);
            const steps = traj?.trajectory?.steps || [];
            const display = fmt.formatLastReply(steps);
            const html = truncateForTG(display);
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id, html, 'HTML');
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 读取失败: ${esc(err.message)}`, 'HTML');
        }
    });

    // ========== /readall ==========

    bot.command('readall', async (ctx) => {
        const cascadeId = await ensureCascadeId(ctx);
        if (!cascadeId) {
            await ctx.reply(`${ce(EMOJI.CROSS)} 没有当前对话`, { parse_mode: 'HTML' });
            return;
        }

        const msg = await ctx.reply(`${ce(EMOJI.REFRESH)} 正在读取完整对话...`, { parse_mode: 'HTML' });
        try {
            const traj = await controller.getTrajectory(cascadeId);
            const steps = traj?.trajectory?.steps || [];

            if (steps.length === 0) {
                await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                    `${ce(EMOJI.WARN)} 当前对话为空`, 'HTML');
                return;
            }

            // 获取标题
            let title = '当前对话';
            try {
                const list = await controller.listConversations();
                const conv = list.find(c => c.id === cascadeId);
                if (conv?.title) title = conv.title;
            } catch { /* ignore */ }

            // 统一导出为 .md 文件
            const mdContent = fmt.formatConversationMarkdown(steps, title);
            const filename = `chat_${Date.now()}.md`;
            const filepath = path.join('/tmp', filename);
            fs.writeFileSync(filepath, mdContent, 'utf-8');

            const visibleCount = steps.filter(s => !fmt.HIDDEN_TYPES.includes(s.type)).length;
            await ctx.replyWithDocument(new InputFile(filepath), {
                caption: `${ce(EMOJI.TOPIC)} ${esc(title)} (${visibleCount} steps)`,
                parse_mode: 'HTML',
            });
            try { fs.unlinkSync(filepath); } catch { /* ignore */ }
            try { await ctx.api.deleteMessage(ctx.chat.id, msg.message_id); } catch { /* ignore */ }
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 读取失败: ${esc(err.message)}`, 'HTML');
        }
    });

    // ========== /screenshot ==========

    bot.command('screenshot', async (ctx) => {
        const msg = await ctx.reply(`${ce(EMOJI.CAMERA)} 正在截屏...`, { parse_mode: 'HTML' });
        try {
            // 尝试通过 CDP 截屏
            const { connect } = require('../cdp/cdp');
            const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
            const CDP_PORT = Number(process.env.CDP_PORT || '9000');

            const { ws } = await connect(CDP_HOST, CDP_PORT);
            const { takeScreenshot } = require('../cdp/ide');
            const filepath = await takeScreenshot(ws);
            ws.close();

            await ctx.replyWithPhoto(new InputFile(filepath));
            try { fs.unlinkSync(filepath); } catch { /* ignore */ }
            try { await ctx.api.deleteMessage(ctx.chat.id, msg.message_id); } catch { /* ignore */ }
        } catch (err) {
            await safeEditText(ctx.api, ctx.chat.id, msg.message_id,
                `${ce(EMOJI.CROSS)} 截屏失败: ${esc(err.message)}\n💡 需要 IDE 运行 (CDP 端口 9000)`, 'HTML');
        }
    });

    // ========== 文字 + 图片消息处理 ==========

    bot.on(['message:text', 'message:photo'], async (ctx) => {
        let text = ctx.message.text || ctx.message.caption || '';
        const extras = {};

        // 处理图片
        if (ctx.message.photo) {
            try {
                const statusMsg = await ctx.reply(
                    `${ce(EMOJI.IMAGE)} 正在下载图片...`, { parse_mode: 'HTML' }
                );

                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                const file = await ctx.api.getFile(photo.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

                const ext = path.extname(file.file_path) || '.jpg';
                const localPath = path.join('/tmp', `tg_photo_${Date.now()}${ext}`);
                await downloadFile(fileUrl, localPath);

                try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch { /* ignore */ }

                // v2: 通过 media extras 传递图片
                extras.media = [{
                    mimeType: `image/${ext.replace('.', '') === 'jpg' ? 'jpeg' : ext.replace('.', '')}`,
                    uri: `file://${localPath}`,
                }];

                const caption = text.trim();
                if (!caption) {
                    text = '请查看这张图片并告诉我你看到了什么。';
                }

                console.log(`[TG] 图片已下载: ${localPath} (${photo.width}x${photo.height})`);
            } catch (err) {
                await ctx.reply(
                    `${ce(EMOJI.CROSS)} 图片下载失败: ${esc(err.message)}`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
        }

        const trimmedText = text.trim();
        if (!trimmedText) return;

        // 确保有对话
        let cascadeId = await ensureCascadeId(ctx);
        if (!cascadeId) {
            // 自动创建新对话
            try {
                const newId = await controller.newChat();
                if (newId) {
                    setCascadeId(botState, ctx, newId);
                    cascadeId = newId;
                } else {
                    await ctx.reply(`${ce(EMOJI.CROSS)} 没有可用对话且创建失败。请检查 LS 连接 (/status)`, { parse_mode: 'HTML' });
                    return;
                }
            } catch (err) {
                await ctx.reply(`${ce(EMOJI.CROSS)} 自动创建对话失败: ${esc(err.message)}`, { parse_mode: 'HTML' });
                return;
            }
        }

        // 排队反馈
        if (isProcessing) {
            const qLen = messageQueue.length + 1;
            await ctx.reply(`${ce(EMOJI.TYPING)} ✅ 已加入队列 (前面还有 ${qLen} 个任务在运行)`, {
                parse_mode: 'HTML',
                reply_to_message_id: ctx.message.message_id
            });
        }

        // 入队执行
        enqueueMessage(() => sendAndStream(ctx, controller, cascadeId, trimmedText, extras));
    });

    // ========== 错误处理 ==========

    bot.catch((err) => {
        console.error('[TG] Bot 错误:', err.message || err);
    });

    // ========== 启动 ==========

    console.log('[TG] Bot 启动中...');
    bot.start({
        onStart: () => {
            console.log(`[TG] Bot 已启动 (user: ${ALLOWED_USER_ID})`);
            if (Object.keys(botState.chats || {}).length > 0) {
                console.log(`[TG] 恢复了 ${Object.keys(botState.chats).length} 个状态记录`);
            }
        },
    });

    return bot;
}

module.exports = { startBot };
