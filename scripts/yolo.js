/**
 * scripts/yolo.js — YOLO 自动驾驶模式
 *
 * 通过 gRPC 与 LS 对话，自动回复模板消息，实现无人值守的长时间运行。
 *
 * 用法:
 *   node scripts/yolo.js <参考文档.md> [选项]
 *
 * 选项:
 *   --timeout <秒>       最大运行时长（默认 7200 = 2小时）
 *   --port <端口>        LS 端口（默认 42100）
 *   --csrf <token>       CSRF token（默认 daemon-with-ext-server）
 *   --cascade <id>       复用已有对话（不传则创建新对话）
 *   --cooldown <秒>      自动回复前的冷却时间（默认 5 秒）
 *   --poll-interval <秒> 轮询间隔（默认 3 秒）
 *   --agentic            启用 agentic 模式（默认关闭）
 */

const fs = require('fs');
const path = require('path');
const { grpcCall, discoverLS } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const ConversationIndex = require('../lib/data/conversation-index');

// ========== 配置解析 ==========

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        docPath: null,
        task: null,
        timeout: 7200,
        port: null,
        csrf: null,
        cascadeId: null,
        cooldown: 5,
        pollInterval: 3,
        agentic: false,
    };

    let i = 0;
    while (i < args.length) {
        switch (args[i]) {
            case '--timeout':
                config.timeout = parseInt(args[++i], 10);
                break;
            case '--port':
                config.port = parseInt(args[++i], 10);
                break;
            case '--csrf':
                config.csrf = args[++i];
                break;
            case '--cascade':
                config.cascadeId = args[++i];
                break;
            case '--cooldown':
                config.cooldown = parseInt(args[++i], 10);
                break;
            case '--poll-interval':
                config.pollInterval = parseInt(args[++i], 10);
                break;
            case '--agentic':
                config.agentic = true;
                break;
            case '--task':
                config.task = args[++i];
                break;
            default:
                if (!args[i].startsWith('--') && !config.docPath) {
                    config.docPath = args[i];
                }
                break;
        }
        i++;
    }

    return config;
}

// ========== 自动回复模板 ==========

const AUTO_REPLY_TEMPLATE = `继续你的工作，自行判断所有决策。
- 遇到错误：分析原因，尝试解决，解决不了就跳过并记录
- 产品决策：从用户价值角度思考
- 技术决策：从架构合理性角度思考
- 完成所有工作后：按照参考文档中的完成 Hook 执行`;

// ========== 日志 ==========

class Logger {
    constructor(logDir) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.logPath = path.join(logDir, `yolo-${ts}.log`);
        this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
        this.roundCount = 0;
    }

    log(level, msg) {
        const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
        console.log(line);
        this.stream.write(line + '\n');
    }

    info(msg) { this.log('INFO', msg); }
    warn(msg) { this.log('WARN', msg); }
    error(msg) { this.log('ERROR', msg); }

    logRound(roundNum, aiResponsePreview) {
        this.roundCount = roundNum;
        this.info(`--- 第 ${roundNum} 轮完成 ---`);
        if (aiResponsePreview) {
            this.info(`AI 回复:\n${aiResponsePreview}`);
        }
    }

    close() {
        this.stream.end();
    }
}

// ========== gRPC 辅助 ==========

async function safeCall(port, csrf, method, body, timeoutMs = 30000) {
    try {
        return await grpcCall(port, csrf, method, body, timeoutMs);
    } catch (err) {
        return { status: 'ERROR', data: { error: err.message } };
    }
}

/**
 * 等待对话进入 IDLE 状态
 * 同时自动处理 WAITING 状态的 step（自动批准命令执行）
 * @returns {{ idle: boolean, steps: Array, lastAiText: string }}
 */
async function waitForIdle(port, csrf, cascadeId, pollIntervalSec, logger, lastShownIndex = 0) {
    let lastAiText = '';
    const maxPoll = 600; // 最多轮询 600 次（= pollInterval * 600）

    for (let i = 0; i < maxPoll; i++) {
        await sleep(pollIntervalSec * 1000);

        const r = await safeCall(port, csrf, 'GetCascadeTrajectory', { cascadeId });

        if (r.status === 'ERROR') {
            logger.warn(`轮询出错: ${r.data?.error || 'unknown'}`);
            continue;
        }
        if (r.status !== 200) {
            logger.warn(`轮询异常状态: ${r.status}`);
            continue;
        }

        const status = r.data?.status || '';
        const steps = r.data?.trajectory?.steps || [];

        // 实时显示新 step
        for (let s = lastShownIndex; s < steps.length; s++) {
            const step = steps[s];
            const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
            const sts = (step.status || '').replace('CORTEX_STEP_STATUS_', '');
            const text = step?.content?.text || step?.content?.message || step?.text || '';
            const preview = text.length > 120 ? text.slice(0, 120).replace(/\n/g, ' ') + '...' : text.replace(/\n/g, ' ');
            logger.info(`  [Step ${s}] ${type} (${sts})${preview ? ' ' + preview : ''}`);
        }
        lastShownIndex = steps.length;

        // 自动处理 WAITING 状态的 step（批准命令执行）
        for (let j = 0; j < steps.length; j++) {
            if (steps[j].status === 'CORTEX_STEP_STATUS_WAITING') {
                logger.info(`自动批准 step[${j}] 命令执行`);
                await safeCall(port, csrf, 'HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction: { trajectoryId: cascadeId, stepIndex: j, runCommand: { confirm: true } },
                });
            }
        }

        // 提取最后一条 AI 回复文本
        for (let j = steps.length - 1; j >= 0; j--) {
            const step = steps[j];
            const text = step?.content?.text
                || step?.content?.message
                || step?.text
                || '';
            if (text && step.type !== 'USER_MESSAGE') {
                lastAiText = text;
                break;
            }
        }

        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            return { idle: true, steps, lastAiText, lastShownIndex };
        }

        // 每 10 次轮询打一条心跳日志
        if (i > 0 && i % 10 === 0) {
            logger.info(`仍在等待... (轮询 ${i} 次, 状态: ${status}, steps: ${steps.length})`);
        }
    }

    logger.warn('等待 IDLE 超时');
    return { idle: false, steps: [], lastAiText, lastShownIndex };
}

// ========== 标记文件检测 ==========

const MARKER_FILE = path.join(__dirname, '..', '.yolo-done');

function checkMarker() {
    return fs.existsSync(MARKER_FILE);
}

function cleanMarker() {
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }
}

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== 主循环 ==========

async function main() {
    const config = parseArgs();

    // 参数校验
    if (!config.docPath && !config.task) {
        console.error('用法:');
        console.error('  node scripts/yolo.js <参考文档.md> [选项]');
        console.error('  node scripts/yolo.js --task "你的任务指令" [选项]');
        console.error('');
        console.error('选项:');
        console.error('  --task <文本>         直接传任务指令（与文件二选一）');
        console.error('  --timeout <秒>       最大运行时长（默认 7200）');
        console.error('  --port <端口>        LS 端口（自动发现）');
        console.error('  --csrf <token>       CSRF token（自动发现）');
        console.error('  --cascade <id>       复用已有对话');
        console.error('  --cooldown <秒>      自动回复冷却时间（默认 5）');
        console.error('  --poll-interval <秒> 轮询间隔（默认 3）');
        console.error('  --agentic            启用 agentic 模式');
        process.exit(1);
    }

    if (config.docPath) {
        const docFullPath = path.resolve(config.docPath);
        if (!fs.existsSync(docFullPath)) {
            console.error(`参考文档不存在: ${docFullPath}`);
            process.exit(1);
        }
    }

    // 自动发现 LS（用户显式传参时优先）
    if (!config.port || !config.csrf) {
        const ls = discoverLS();
        if (ls) {
            if (!config.port) config.port = ls.port;
            if (!config.csrf) config.csrf = ls.csrf;
        } else {
            if (!config.port) config.port = 42100;
            if (!config.csrf) {
                console.error('无法自动发现 LS，请手动指定 --csrf <token>');
                process.exit(1);
            }
        }
    }

    // 初始化日志
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logger = new Logger(logDir);

    logger.info('=== YOLO 模式启动 ===');

    // 获取 LS 版本和账户信息
    const statusRes = await safeCall(config.port, config.csrf, 'GetStatus', {});
    const userRes = await safeCall(config.port, config.csrf, 'GetUserStatus', {});

    const version = statusRes.data?.version || statusRes.data?.serverVersion || '未知';
    const user = userRes.data?.userStatus || {};
    const plan = user.planStatus?.planInfo || {};

    logger.info(`LS 版本: ${version}`);
    logger.info(`账户: ${user.name || '未知'} <${user.email || '未知'}> (${plan.planName || '未知'})`);
    logger.info(`来源: ${config.task ? '命令行指令' : config.docPath}`);
    logger.info(`超时: ${config.timeout}s`);
    logger.info(`端口: ${config.port}, CSRF: ${config.csrf}`);
    logger.info(`冷却: ${config.cooldown}s, 轮询间隔: ${config.pollInterval}s`);
    logger.info(`Agentic: ${config.agentic}`);

    // 清理旧标记文件
    cleanMarker();

    // 读取任务内容
    let docContent;
    if (config.task) {
        docContent = config.task;
        logger.info(`任务指令 (${docContent.length} 字符): ${docContent.slice(0, 100)}...`);
    } else {
        const docFullPath = path.resolve(config.docPath);
        docContent = fs.readFileSync(docFullPath, 'utf-8');
        logger.info(`参考文档已读取: ${docFullPath} (${docContent.length} 字符)`);
    }

    // 创建或复用对话
    let cascadeId = config.cascadeId;
    if (!cascadeId) {
        logger.info('创建新对话...');
        const r = await safeCall(config.port, config.csrf, 'StartCascade', {});
        cascadeId = r.data?.cascadeId;
        if (!cascadeId) {
            logger.error(`创建对话失败: ${JSON.stringify(r.data)}`);
            process.exit(1);
        }
        logger.info(`新对话已创建: ${cascadeId}`);

        // 记录到对话索引
        try {
            const convIndex = new ConversationIndex();
            convIndex.insert(cascadeId, {
                account: user.email || null,
                source: 'yolo',
                yoloTask: docContent.slice(0, 500),
                createdAt: new Date().toISOString(),
            });
            convIndex.close();
        } catch (err) {
            logger.warn(`对话索引 insert 失败: ${err.message}`);
        }
    } else {
        logger.info(`复用已有对话: ${cascadeId}`);
    }

    // 构建 cascade 配置
    const cascadeConfig = {
        ...DEFAULT_CONFIG,
        agenticMode: config.agentic,
    };

    // 发送首条消息（参考文档内容）
    logger.info('发送参考文档作为首条消息...');
    const firstBody = buildSendBody(cascadeId, docContent, cascadeConfig);
    const sendResult = await safeCall(config.port, config.csrf, 'SendUserCascadeMessage', firstBody);

    if (sendResult.status === 'ERROR') {
        logger.error(`发送首条消息失败: ${sendResult.data?.error}`);
        process.exit(1);
    }
    logger.info('首条消息已发送');

    // ========== YOLO 主循环 ==========

    const startTime = Date.now();
    const timeoutMs = config.timeout * 1000;
    let round = 0;
    let lastShownIndex = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    while (true) {
        // 检查超时
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
            logger.warn(`已达到超时限制 (${config.timeout}s)，停止 YOLO 模式`);
            // 通知用户超时
            try {
                const { execSync } = require('child_process');
                execSync(`node "${path.join(__dirname, 'yolo-done.js')}" "YOLO 超时停止 (${config.timeout}s, ${round} 轮)"`, {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '..'),
                });
            } catch { /* ignore */ }
            break;
        }

        // 检查标记文件（熔断）
        if (checkMarker()) {
            const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
            logger.info(`检测到完成标记，停止 YOLO 模式`);
            logger.info(`完成摘要: ${marker.summary}`);
            break;
        }

        // 等待 AI 完成当前轮次
        logger.info('等待 AI 完成...');
        const { idle, steps, lastAiText, lastShownIndex: newShown } = await waitForIdle(
            config.port, config.csrf, cascadeId,
            config.pollInterval, logger, lastShownIndex
        );
        lastShownIndex = newShown;

        if (!idle) {
            consecutiveErrors++;
            logger.warn(`AI 未进入 IDLE 状态 (连续错误: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                logger.error('连续错误过多，停止 YOLO 模式');
                try {
                    const { execSync } = require('child_process');
                    execSync(`node "${path.join(__dirname, 'yolo-done.js')}" "YOLO 因连续错误停止 (${consecutiveErrors} 次)"`, {
                        stdio: 'inherit',
                        cwd: path.join(__dirname, '..'),
                    });
                } catch { /* ignore */ }
                break;
            }

            // 指数退避重试
            const backoff = Math.min(30, Math.pow(2, consecutiveErrors)) * 1000;
            logger.info(`等待 ${backoff / 1000}s 后重试...`);
            await sleep(backoff);
            continue;
        }

        // 重置连续错误计数
        consecutiveErrors = 0;
        round++;

        // 再次检查标记文件（AI 可能在刚才的执行中触发了 hook）
        if (checkMarker()) {
            const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
            logger.info(`检测到完成标记，停止 YOLO 模式`);
            logger.info(`完成摘要: ${marker.summary}`);
            break;
        }

        // 记录本轮
        logger.logRound(round, lastAiText);

        // 冷却
        logger.info(`冷却 ${config.cooldown}s...`);
        await sleep(config.cooldown * 1000);

        // 发送自动回复
        logger.info('发送自动回复...');
        const replyBody = buildSendBody(cascadeId, AUTO_REPLY_TEMPLATE, cascadeConfig);
        const replyResult = await safeCall(config.port, config.csrf, 'SendUserCascadeMessage', replyBody);

        if (replyResult.status === 'ERROR') {
            consecutiveErrors++;
            logger.warn(`自动回复发送失败: ${replyResult.data?.error}`);

            // gRPC 连接断开时的重连逻辑
            const backoff = Math.min(30, Math.pow(2, consecutiveErrors)) * 1000;
            logger.info(`等待 ${backoff / 1000}s 后重试...`);
            await sleep(backoff);
            continue;
        }

        logger.info(`第 ${round} 轮自动回复已发送`);

        // 统计
        const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
        const remainMin = ((timeoutMs - (Date.now() - startTime)) / 60000).toFixed(1);
        logger.info(`运行时间: ${elapsedMin}min, 剩余: ${remainMin}min, 总轮次: ${round}`);
    }

    // ========== 结束 ==========

    const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
    logger.info(`=== YOLO 模式结束 === (总运行 ${totalMin}min, ${round} 轮)`);
    logger.info(`对话 ID: ${cascadeId}`);
    logger.info(`日志文件: ${logger.logPath}`);

    // ========== 归档到索引 ==========

    try {
        const convIndex = new ConversationIndex();
        convIndex.insert(cascadeId, { account: user.email || null, source: 'yolo' }); // 确保存在
        convIndex.finalize(cascadeId, {
            title: 'YOLO: ' + (config.task ? config.task.slice(0, 80) : path.basename(config.docPath || '')),
            stepCount: lastShownIndex,
            yoloSummary: `${round} 轮完成, ${totalMin}min`,
            updatedAt: new Date().toISOString(),
        });
        convIndex.close();
        logger.info('对话已归档到索引');
    } catch (err) {
        logger.warn(`对话索引 finalize 失败: ${err.message}`);
    }

    logger.close();
}

// ========== 入口 ==========

main().catch((err) => {
    console.error('[YOLO] 致命错误:', err);
    process.exit(1);
});
