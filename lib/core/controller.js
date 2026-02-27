/**
 * lib/controller.js — Antigravity Controller 层
 *
 * 核心职责:
 *   1. LS 连接管理 (discovery file + 进程 fallback)
 *   2. 对话状态机 (所有对话 + 接管 IDE 对话)
 *   3. 轮询引擎 (自适应间隔 + 非活跃不 poll)
 *   4. Diff 引擎 (steps 增量计算)
 *   5. 事件总线 (→ WS broadcast)
 *
 * 架构:
 *   Controller → ls-discovery.grpcCall → LS gRPC API
 *             → conversations.getConversations → SQLite
 *             → ws-protocol → WebSocket 客户端
 */

const EventEmitter = require('events');
const { discoverLS, grpcCall } = require('./ls-discovery');
const { DEFAULT_CONFIG, buildSendBody, makeEvent } = require('./ws-protocol');

// ========== 常量 ==========

const POLL_MIN_INTERVAL = 1000;
const POLL_MAX_INTERVAL = 5000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_TICK_MS = 500; // 主循环 tick

// ========== ConversationState ==========

/**
 * @typedef {Object} ConversationState
 * @property {string} cascadeId
 * @property {string} status - 'IDLE' | 'RUNNING' | 'UNKNOWN'
 * @property {Array} steps
 * @property {number} totalSteps
 * @property {Date|null} lastPollAt
 * @property {number} pollInterval - 自适应轮询间隔 (ms)
 * @property {Set<WebSocket>} subscribers
 * @property {string} source - 'controller' | 'ide' | 'external'
 */

function createConversationState(cascadeId, source = 'external') {
    return {
        cascadeId,
        status: 'UNKNOWN',
        steps: [],
        totalSteps: 0,
        lastPollAt: null,
        pollInterval: POLL_MIN_INTERVAL,
        subscribers: new Set(),
        source,
    };
}

// ========== Controller ==========

class Controller extends EventEmitter {
    constructor() {
        super();
        /** @type {{ port: number, csrf: string, pid: number, version: string } | null} */
        this.ls = null;
        /** @type {Map<string, ConversationState>} */
        this.conversations = new Map();
        /** @type {object} */
        this.config = { ...DEFAULT_CONFIG };
        /** @type {boolean} */
        this.isPolling = false;
        /** @type {NodeJS.Timeout|null} */
        this._pollTimer = null;
    }

    // ========== 初始化 ==========

    /**
     * 初始化 Controller: 发现 LS
     * @returns {Promise<boolean>}
     */
    async init() {
        this.ls = discoverLS();
        if (!this.ls) {
            this.emit('error', new Error('LS not found'));
            return false;
        }

        // 验证连接
        try {
            await grpcCall(this.ls.port, this.ls.csrf, 'Heartbeat', { metadata: {} });
        } catch (err) {
            this.emit('error', new Error(`LS heartbeat failed: ${err.message}`));
            this.ls = null;
            return false;
        }

        this.emit('ls_connected', this.ls);
        return true;
    }

    /**
     * 刷新 LS 连接 (重新发现)
     * @returns {Promise<boolean>}
     */
    async refreshLS() {
        const oldLs = this.ls;
        this.ls = discoverLS();
        if (!this.ls) {
            this.emit('ls_disconnected');
            return false;
        }

        if (oldLs && oldLs.port !== this.ls.port) {
            this.emit('ls_changed', { old: oldLs, new: this.ls });
        }

        return true;
    }

    // ========== 配置管理 ==========

    setConfig(partial) {
        const validKeys = Object.keys(DEFAULT_CONFIG);
        for (const key of validKeys) {
            if (partial[key] !== undefined) {
                this.config[key] = partial[key];
            }
        }
    }

    getConfig() {
        return { ...this.config };
    }

    // ========== 状态查询 ==========

    getStatus() {
        return {
            ls: {
                connected: !!this.ls,
                port: this.ls?.port || null,
                pid: this.ls?.pid || null,
                version: this.ls?.version || null,
            },
            config: this.getConfig(),
            conversations: {
                total: this.conversations.size,
                running: [...this.conversations.values()].filter(c => c.status === 'RUNNING').length,
                subscribed: [...this.conversations.values()].filter(c => c.subscribers.size > 0).length,
            },
            polling: this.isPolling,
        };
    }

    // ========== 对话管理 ==========

    /**
     * 获取对话列表
     * 数据源优先级: LS API (GetAllCascadeTrajectories) → .pb 文件补充 → SQLite fallback
     * @returns {Promise<Array>}
     */
    async listConversations() {
        const conversations = new Map(); // cascadeId → conversation

        // 方式 1: LS API — GetAllCascadeTrajectories（有标题、状态等完整元数据）
        if (this.ls) {
            try {
                const result = await grpcCall(this.ls.port, this.ls.csrf, 'GetAllCascadeTrajectories', {});
                const summaries = result.data?.trajectorySummaries || {};
                for (const [id, info] of Object.entries(summaries)) {
                    conversations.set(id, {
                        id,
                        title: info.summary || '',
                        stepCount: info.stepCount || 0,
                        status: (info.status || '').replace('CASCADE_RUN_STATUS_', ''),
                        workspace: info.workspaces?.[0]?.workspaceFolderAbsoluteUri || '',
                        createdAt: info.createdTime || null,
                        updatedAt: info.lastModifiedTime || null,
                        lastUserInputTime: info.lastUserInputTime || null,
                        source: 'ls',
                    });
                }
            } catch (err) {
                this.emit('error', new Error(`GetAllCascadeTrajectories: ${err.message}`));
            }
        }

        // 方式 2: .pb 文件扫描 — 补充 LS 不知道的旧对话
        try {
            const fs = require('fs');
            const path = require('path');
            const convDir = path.join(
                process.env.HOME || '/home/tiemuer',
                '.gemini', 'antigravity', 'conversations',
            );
            const files = fs.readdirSync(convDir).filter(f => f.endsWith('.pb'));
            for (const f of files) {
                const id = f.replace('.pb', '');
                if (conversations.has(id)) continue; // LS 已有，跳过
                const stat = fs.statSync(path.join(convDir, f));
                conversations.set(id, {
                    id,
                    title: '',
                    stepCount: 0,
                    status: 'IDLE',
                    workspace: '',
                    createdAt: null,
                    updatedAt: stat.mtime.toISOString(),
                    lastUserInputTime: null,
                    sizeBytes: stat.size,
                    source: 'file',
                });
            }
        } catch { /* .pb 目录不存在 */ }

        // 方式 3: SQLite fallback — 补充标题（如果有的话）
        try {
            const { getConversations } = require('../data/conversations');
            const result = getConversations();
            if (!result.error && result.conversations?.length > 0) {
                for (const conv of result.conversations) {
                    const existing = conversations.get(conv.id);
                    if (existing && !existing.title && conv.title) {
                        existing.title = conv.title;
                    }
                    if (!existing) {
                        conversations.set(conv.id, { ...conv, source: 'sqlite' });
                    }
                }
            }
        } catch { /* SQLite 不可用 */ }

        // 按 updatedAt 降序排列
        return [...conversations.values()]
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    }

    /**
     * 创建新对话
     * @returns {Promise<string|null>} cascadeId
     */
    async newChat() {
        if (!this.ls) throw new Error('LS not connected');

        const result = await grpcCall(this.ls.port, this.ls.csrf, 'StartCascade', {});
        if (!result.data?.cascadeId) {
            throw new Error('StartCascade failed: no cascadeId');
        }

        const cascadeId = result.data.cascadeId;
        this.conversations.set(cascadeId, createConversationState(cascadeId, 'controller'));
        return cascadeId;
    }

    /**
     * 发送消息
     * @param {string} cascadeId
     * @param {string} text
     * @param {object} [configOverride]
     * @param {object} [extras] - { mentions, media }
     * @returns {Promise<void>}
     */
    async sendMessage(cascadeId, text, configOverride, extras) {
        if (!this.ls) throw new Error('LS not connected');

        const cfg = configOverride ? { ...this.config, ...configOverride } : this.config;
        const body = buildSendBody(cascadeId, text, cfg, extras);

        await grpcCall(this.ls.port, this.ls.csrf, 'SendUserCascadeMessage', body);

        // 确保对话有状态
        if (!this.conversations.has(cascadeId)) {
            this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
        }
        const conv = this.conversations.get(cascadeId);
        conv.status = 'RUNNING';
        conv.pollInterval = POLL_MIN_INTERVAL;

        // 如果还没开始轮询，启动
        if (!this.isPolling) {
            this.startPolling();
        }
    }

    /**
     * 获取对话轨迹
     * @param {string} cascadeId
     * @returns {Promise<object|null>}
     */
    async getTrajectory(cascadeId) {
        if (!this.ls) throw new Error('LS not connected');

        const result = await grpcCall(this.ls.port, this.ls.csrf, 'GetCascadeTrajectory', { cascadeId });
        return result.data || null;
    }

    // ========== 订阅管理 ==========

    /**
     * 订阅对话的实时更新
     * @param {string} cascadeId
     * @param {WebSocket} ws
     */
    subscribe(cascadeId, ws) {
        if (!this.conversations.has(cascadeId)) {
            this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
        }
        this.conversations.get(cascadeId).subscribers.add(ws);

        // 如果还没开始轮询且有 RUNNING 对话，启动
        if (!this.isPolling) {
            this.startPolling();
        }
    }

    /**
     * 取消订阅
     * @param {string} cascadeId
     * @param {WebSocket} ws
     */
    unsubscribe(cascadeId, ws) {
        const conv = this.conversations.get(cascadeId);
        if (conv) {
            conv.subscribers.delete(ws);
        }
    }

    /**
     * 移除某个 WS 的所有订阅 (断开连接时调用)
     * @param {WebSocket} ws
     */
    unsubscribeAll(ws) {
        for (const conv of this.conversations.values()) {
            conv.subscribers.delete(ws);
        }
    }

    // ========== Diff 引擎 ==========

    /**
     * 计算 steps 的增量差异
     * @param {Array} oldSteps
     * @param {Array} newSteps
     * @returns {{ added: Array<{index, step}>, updated: Array<{index, step}> }}
     */
    diffSteps(oldSteps, newSteps) {
        const added = [];
        const updated = [];

        for (let i = 0; i < newSteps.length; i++) {
            if (i >= oldSteps.length) {
                // 新增的 step
                added.push({ index: i, step: newSteps[i] });
            } else if (newSteps[i].status !== oldSteps[i].status) {
                // 状态变化的 step
                updated.push({ index: i, step: newSteps[i] });
            }
        }

        return { added, updated };
    }

    // ========== 轮询引擎 ==========

    startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        this._pollLoop();
    }

    stopPolling() {
        this.isPolling = false;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
    }

    /**
     * 轮询主循环
     * @private
     */
    async _pollLoop() {
        if (!this.isPolling) return;

        try {
            await this.pollOnce();
        } catch (err) {
            this.emit('error', err);
        }

        // 检查是否还需要轮询
        const hasActive = [...this.conversations.values()].some(
            c => c.status === 'RUNNING' || c.subscribers.size > 0,
        );

        if (!hasActive) {
            this.isPolling = false;
            return;
        }

        this._pollTimer = setTimeout(() => this._pollLoop(), POLL_TICK_MS);
    }

    /**
     * 执行一次轮询
     */
    async pollOnce() {
        if (!this.ls) return;

        const now = Date.now();

        for (const [cascadeId, conv] of this.conversations) {
            // 跳过规则: IDLE 且无订阅者
            if (conv.status === 'IDLE' && conv.subscribers.size === 0) continue;
            // IDLE 且有订阅者但不需要频繁 poll
            if (conv.status === 'IDLE' && conv.subscribers.size > 0) continue;

            // 自适应间隔
            if (conv.lastPollAt && (now - conv.lastPollAt) < conv.pollInterval) continue;

            try {
                const result = await grpcCall(this.ls.port, this.ls.csrf, 'GetCascadeTrajectory', { cascadeId });
                const data = result.data;
                if (!data || !data.trajectory) continue;

                const newSteps = data.trajectory.steps || [];
                const newStatus = (data.status || '').replace('CASCADE_RUN_STATUS_', '');
                const oldStatus = conv.status;

                // Diff
                const diff = this.diffSteps(conv.steps, newSteps);

                // 通知订阅者
                if (diff.added.length > 0 || diff.updated.length > 0) {
                    for (const { index, step } of diff.added) {
                        this._broadcast(conv, makeEvent('event_step_added', { cascadeId, stepIndex: index, step }));
                    }
                    for (const { index, step } of diff.updated) {
                        this._broadcast(conv, makeEvent('event_step_updated', { cascadeId, stepIndex: index, step }));
                    }

                    // 有变化 → 重置间隔
                    conv.pollInterval = POLL_MIN_INTERVAL;
                } else {
                    // 无变化 → 增大间隔
                    conv.pollInterval = Math.min(conv.pollInterval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL);
                }

                // 状态变化
                if (newStatus !== oldStatus) {
                    this._broadcast(conv, makeEvent('event_status_changed', {
                        cascadeId, from: oldStatus, to: newStatus,
                    }));
                    this.emit('status_changed', { cascadeId, from: oldStatus, to: newStatus });
                }

                // 更新状态
                conv.steps = newSteps;
                conv.totalSteps = data.numTotalSteps || newSteps.length;
                conv.status = newStatus;
                conv.lastPollAt = now;

            } catch (err) {
                this.emit('error', new Error(`poll ${cascadeId}: ${err.message}`));
                // LS 可能挂了，尝试重新发现
                if (err.message.includes('ECONNREFUSED') || err.message.includes('timeout')) {
                    await this.refreshLS();
                }
            }
        }
    }

    /**
     * 广播消息给所有订阅者
     * @private
     */
    _broadcast(conv, message) {
        for (const ws of conv.subscribers) {
            try {
                if (ws.readyState === 1) { // WebSocket.OPEN
                    ws.send(message);
                } else {
                    conv.subscribers.delete(ws);
                }
            } catch {
                conv.subscribers.delete(ws);
            }
        }

        // 同时 emit 事件 (供其他模块监听)
        try {
            const parsed = JSON.parse(message);
            this.emit(parsed.type, parsed);
        } catch { /* ignore */ }
    }

    /**
     * 销毁 Controller
     */
    destroy() {
        this.stopPolling();
        this.conversations.clear();
        this.removeAllListeners();
    }
}

module.exports = { Controller, createConversationState };
