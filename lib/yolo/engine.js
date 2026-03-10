/**
 * lib/yolo/engine.js — YOLO 引擎
 *
 * 核心自动驾驶循环，基于 EventEmitter 模式。
 * 可被 CLI (scripts/yolo.js) 和 WebSocket 后端 (main.js) 共同消费。
 *
 * 事件:
 *   - 'started'    ({ cascadeId, task })       YOLO 已启动
 *   - 'step'       ({ index, type, status, preview })  新 step 实时输出
 *   - 'round'      ({ round, lastAiText, elapsed, remaining })  一轮完成
 *   - 'done'       ({ reason, summary, round, elapsed })  YOLO 结束
 *   - 'error'      ({ message, consecutive })  可恢复错误
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { grpcCall, discoverLS } = require('../core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../core/ws-protocol');
const ConversationIndex = require('../data/conversation-index');
const { Logger } = require('./logger');
const marker = require('./marker');
const { AUTO_REPLY_TEMPLATE, DEFAULTS } = require('./config');

// ========== gRPC 辅助 ==========

async function safeCall(port, csrf, method, body, timeoutMs = 30000) {
    try {
        return await grpcCall(port, csrf, method, body, timeoutMs);
    } catch (err) {
        return { status: 'ERROR', data: { error: err.message } };
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== YOLO Engine ==========

class YoloEngine extends EventEmitter {
    constructor() {
        super();
        this._running = false;
        this._aborted = false;
        this._cascadeId = null;
        this._round = 0;
        this._startTime = null;
        this._logger = null;
    }

    /** @returns {{ running: boolean, cascadeId: string|null, round: number, elapsed: number }} */
    getStatus() {
        return {
            running: this._running,
            cascadeId: this._cascadeId,
            round: this._round,
            elapsed: this._startTime ? Date.now() - this._startTime : 0,
        };
    }

    /**
     * 停止 YOLO 循环
     */
    stop() {
        this._aborted = true;
    }

    /**
     * 启动 YOLO 主循环
     * @param {object} opts
     * @param {string} [opts.task]          - 任务文本（与 docPath 二选一）
     * @param {string} [opts.docPath]       - 参考文档路径
     * @param {number} [opts.timeout]       - 超时秒数
     * @param {number} [opts.port]          - LS 端口
     * @param {string} [opts.csrf]          - CSRF token
     * @param {string} [opts.cascadeId]     - 复用已有对话
     * @param {number} [opts.cooldown]      - 冷却秒数
     * @param {number} [opts.pollInterval]  - 轮询间隔秒数
     * @param {boolean} [opts.agentic]      - agentic 模式
     * @returns {Promise<{ cascadeId: string, round: number, elapsed: number }>}
     */
    async start(opts = {}) {
        if (this._running) throw new Error('YOLO 引擎已在运行中');

        this._running = true;
        this._aborted = false;
        this._round = 0;
        this._startTime = Date.now();

        const timeout = opts.timeout || DEFAULTS.timeout;
        const cooldown = opts.cooldown || DEFAULTS.cooldown;
        const pollInterval = opts.pollInterval || DEFAULTS.pollInterval;
        const agentic = opts.agentic || DEFAULTS.agentic;
        const maxErrors = DEFAULTS.maxConsecutiveErrors;

        // 初始化日志
        this._logger = new Logger();
        const logger = this._logger;

        try {
            // 自动发现 LS
            let port = opts.port || null;
            let csrf = opts.csrf || null;
            if (!port || !csrf) {
                const ls = discoverLS();
                if (ls) {
                    if (!port) port = ls.port;
                    if (!csrf) csrf = ls.csrf;
                } else {
                    if (!port) port = 42100;
                    if (!csrf) throw new Error('无法自动发现 LS，请手动指定 csrf');
                }
            }

            logger.info('=== YOLO 模式启动 ===');

            // 获取 LS 版本和账户信息
            const statusRes = await safeCall(port, csrf, 'GetStatus', {});
            const userRes = await safeCall(port, csrf, 'GetUserStatus', {});

            const version = statusRes.data?.version || statusRes.data?.serverVersion || '未知';
            const user = userRes.data?.userStatus || {};
            const plan = user.planStatus?.planInfo || {};

            logger.info(`LS 版本: ${version}`);
            logger.info(`账户: ${user.name || '未知'} <${user.email || '未知'}> (${plan.planName || '未知'})`);

            // 读取任务内容
            let docContent;
            if (opts.task) {
                docContent = opts.task;
                logger.info(`任务指令 (${docContent.length} 字符): ${docContent.slice(0, 100)}...`);
            } else if (opts.docPath) {
                const docFullPath = path.resolve(opts.docPath);
                if (!fs.existsSync(docFullPath)) throw new Error(`参考文档不存在: ${docFullPath}`);
                docContent = fs.readFileSync(docFullPath, 'utf-8');
                logger.info(`参考文档已读取: ${docFullPath} (${docContent.length} 字符)`);
            } else {
                throw new Error('需要提供 task 或 docPath');
            }

            logger.info(`超时: ${timeout}s, 冷却: ${cooldown}s, 轮询: ${pollInterval}s, Agentic: ${agentic}`);

            // 清理旧标记文件
            marker.clean();

            // 创建或复用对话
            let cascadeId = opts.cascadeId || null;
            if (!cascadeId) {
                logger.info('创建新对话...');
                const r = await safeCall(port, csrf, 'StartCascade', {});
                cascadeId = r.data?.cascadeId;
                if (!cascadeId) throw new Error(`创建对话失败: ${JSON.stringify(r.data)}`);
                logger.info(`新对话已创建: ${cascadeId}`);

                // 记录到对话索引
                try {
                    const convIndex = new ConversationIndex();
                    convIndex.insert(cascadeId, {
                        account: user.email || null,
                        source: 'yolo',
                        createdAt: new Date().toISOString(),
                    });
                    convIndex.finalize(cascadeId, { yoloTask: docContent.slice(0, 500) });
                    convIndex.close();
                } catch (err) {
                    logger.warn(`对话索引 insert 失败: ${err.message}`);
                }
            } else {
                logger.info(`复用已有对话: ${cascadeId}`);
            }

            this._cascadeId = cascadeId;

            // 构建 cascade 配置
            const cascadeConfig = { ...DEFAULT_CONFIG, agenticMode: agentic };

            // 发送首条消息
            logger.info('发送参考文档作为首条消息...');
            const firstBody = buildSendBody(cascadeId, docContent, cascadeConfig);
            const sendResult = await safeCall(port, csrf, 'SendUserCascadeMessage', firstBody);

            if (sendResult.status === 'ERROR') {
                throw new Error(`发送首条消息失败: ${sendResult.data?.error}`);
            }
            logger.info('首条消息已发送');

            this.emit('started', { cascadeId, task: docContent.slice(0, 200) });

            // ========== YOLO 主循环 ==========

            const timeoutMs = timeout * 1000;
            let lastShownIndex = 0;
            let consecutiveErrors = 0;

            while (!this._aborted) {
                // 检查超时
                const elapsed = Date.now() - this._startTime;
                if (elapsed >= timeoutMs) {
                    logger.warn(`已达到超时限制 (${timeout}s)，停止 YOLO 模式`);
                    this.emit('done', { reason: 'timeout', summary: `超时 ${timeout}s`, round: this._round, elapsed });
                    break;
                }

                // 检查标记文件（熔断）
                if (marker.check()) {
                    const m = marker.read();
                    logger.info(`检测到完成标记，停止 YOLO 模式`);
                    logger.info(`完成摘要: ${m?.summary}`);
                    this.emit('done', { reason: 'marker', summary: m?.summary || '', round: this._round, elapsed });
                    break;
                }

                // 等待 AI 完成当前轮次
                logger.info('等待 AI 完成...');
                const waitResult = await this._waitForIdle(port, csrf, cascadeId, pollInterval, logger, lastShownIndex);
                lastShownIndex = waitResult.lastShownIndex;

                if (this._aborted) {
                    this.emit('done', { reason: 'stopped', summary: '手动停止', round: this._round, elapsed: Date.now() - this._startTime });
                    break;
                }

                if (!waitResult.idle) {
                    consecutiveErrors++;
                    logger.warn(`AI 未进入 IDLE 状态 (连续错误: ${consecutiveErrors}/${maxErrors})`);
                    this.emit('error', { message: 'AI 未进入 IDLE', consecutive: consecutiveErrors });

                    if (consecutiveErrors >= maxErrors) {
                        logger.error('连续错误过多，停止 YOLO 模式');
                        this.emit('done', { reason: 'max_errors', summary: `连续错误 ${consecutiveErrors} 次`, round: this._round, elapsed: Date.now() - this._startTime });
                        break;
                    }

                    const backoff = Math.min(30, Math.pow(2, consecutiveErrors)) * 1000;
                    logger.info(`等待 ${backoff / 1000}s 后重试...`);
                    await sleep(backoff);
                    continue;
                }

                // 重置连续错误计数
                consecutiveErrors = 0;
                this._round++;

                // 再次检查标记文件
                if (marker.check()) {
                    const m = marker.read();
                    logger.info(`检测到完成标记，停止 YOLO 模式`);
                    logger.info(`完成摘要: ${m?.summary}`);
                    this.emit('done', { reason: 'marker', summary: m?.summary || '', round: this._round, elapsed: Date.now() - this._startTime });
                    break;
                }

                // 记录本轮
                logger.logRound(this._round, waitResult.lastAiText);

                const elapsedNow = Date.now() - this._startTime;
                const remainMs = timeoutMs - elapsedNow;
                this.emit('round', {
                    round: this._round,
                    lastAiText: waitResult.lastAiText,
                    elapsed: elapsedNow,
                    remaining: remainMs,
                    stepCount: lastShownIndex,
                });

                // 冷却
                logger.info(`冷却 ${cooldown}s...`);
                await sleep(cooldown * 1000);

                if (this._aborted) {
                    this.emit('done', { reason: 'stopped', summary: '手动停止', round: this._round, elapsed: Date.now() - this._startTime });
                    break;
                }

                // 发送自动回复
                logger.info('发送自动回复...');
                const replyBody = buildSendBody(cascadeId, AUTO_REPLY_TEMPLATE, cascadeConfig);
                const replyResult = await safeCall(port, csrf, 'SendUserCascadeMessage', replyBody);

                if (replyResult.status === 'ERROR') {
                    consecutiveErrors++;
                    logger.warn(`自动回复发送失败: ${replyResult.data?.error}`);
                    this.emit('error', { message: `自动回复失败: ${replyResult.data?.error}`, consecutive: consecutiveErrors });

                    const backoff = Math.min(30, Math.pow(2, consecutiveErrors)) * 1000;
                    logger.info(`等待 ${backoff / 1000}s 后重试...`);
                    await sleep(backoff);
                    continue;
                }

                logger.info(`第 ${this._round} 轮自动回复已发送`);

                const elapsedMin = (elapsedNow / 60000).toFixed(1);
                const remainMin = (remainMs / 60000).toFixed(1);
                logger.info(`运行时间: ${elapsedMin}min, 剩余: ${remainMin}min, 总轮次: ${this._round}`);
            }

            // ========== 结束 ==========

            const totalElapsed = Date.now() - this._startTime;
            const totalMin = (totalElapsed / 60000).toFixed(1);
            logger.info(`=== YOLO 模式结束 === (总运行 ${totalMin}min, ${this._round} 轮)`);
            logger.info(`对话 ID: ${cascadeId}`);
            logger.info(`日志文件: ${logger.logPath}`);

            // 归档到索引
            try {
                const convIndex = new ConversationIndex();
                convIndex.insert(cascadeId, { account: user.email || null, source: 'yolo' });
                convIndex.finalize(cascadeId, {
                    title: 'YOLO: ' + (opts.task ? opts.task.slice(0, 80) : path.basename(opts.docPath || '')),
                    stepCount: lastShownIndex,
                    yoloSummary: `${this._round} 轮完成, ${totalMin}min`,
                    updatedAt: new Date().toISOString(),
                });
                convIndex.close();
                logger.info('对话已归档到索引');
            } catch (err) {
                logger.warn(`对话索引 finalize 失败: ${err.message}`);
            }

            return { cascadeId, round: this._round, elapsed: totalElapsed };
        } finally {
            this._running = false;
            if (this._logger) this._logger.close();
        }
    }

    /**
     * 等待对话进入 IDLE 状态，同时自动批准 WAITING 的 step
     * @private
     */
    async _waitForIdle(port, csrf, cascadeId, pollIntervalSec, logger, lastShownIndex = 0) {
        let lastAiText = '';
        const maxPoll = DEFAULTS.maxPollCount;

        for (let i = 0; i < maxPoll; i++) {
            if (this._aborted) return { idle: false, steps: [], lastAiText, lastShownIndex };

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

                this.emit('step', { index: s, type, status: sts, preview });
            }
            lastShownIndex = steps.length;

            // 自动批准 WAITING 状态的 step
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
                const text = step?.content?.text || step?.content?.message || step?.text || '';
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
}

// 导出辅助函数供测试使用
module.exports = { YoloEngine, safeCall, sleep };
