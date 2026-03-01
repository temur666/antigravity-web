/**
 * lib/controller.js — Antigravity Controller 层
 *
 * 核心职责:
 *   1. LS 连接管理 (discovery file + 进程 fallback)
 *   2. 对话状态机 (所有对话 + 接管 IDE 对话)
 *   3. 流式通知 (StreamCascadeReactiveUpdates) + 按需轮询 fallback
 *   4. Diff 引擎 (steps 增量计算)
 *   5. 事件总线 (→ WS broadcast)
 *
 * 架构:
 *   Controller → stream-client → LS Stream API (实时通知)
 *             → ls-discovery.grpcCall → LS gRPC API (数据拉取)
 *             → ws-protocol → WebSocket 客户端
 */

const EventEmitter = require('events');
const { discoverLS, discoverLSAsync, grpcCall } = require('./ls-discovery');
const { DEFAULT_CONFIG, buildSendBody, makeEvent } = require('./ws-protocol');
const { StreamClient } = require('./stream-client');

// ========== 常量 ==========

const POLL_MIN_INTERVAL = 1000;
const POLL_MAX_INTERVAL = 5000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_TICK_MS = 500; // 主循环 tick
const HEALTH_CHECK_INTERVAL = 30000; // 30s 心跳检查
const HEALTH_CHECK_RETRY_INTERVAL = 5000; // LS 断开后 5s 重试

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

const EVENT_BUFFER_MAX = 200;

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
        nextSeq: 1,
        eventBuffer: [],  // { seq, event(parsed) } ring buffer, max EVENT_BUFFER_MAX
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
        /** @type {StreamClient|null} */
        this._streamClient = null;
        /** @type {Map<string, NodeJS.Timeout>} 尾调用 timer: cascadeId -> timer */
        this._changeDebouncers = new Map();
        /** @type {Map<string, number>} 节流: cascadeId -> 上次 fetch 时间戳 */
        this._lastFetchTimes = new Map();
        /** @type {NodeJS.Timeout|null} */
        this._healthTimer = null;
        /** @type {boolean} */
        this._lsHealthy = false;
    }

    // ========== 初始化 ==========

    /**
     * 初始化 Controller: 发现 LS
     * @returns {Promise<boolean>}
     */
    async init() {
        this.ls = await discoverLSAsync();
        if (!this.ls) {
            this.emit('error', new Error('LS not found'));
            return false;
        }

        // 初始化流式客户端
        this._streamClient = new StreamClient(this.ls.port, this.ls.csrf);
        this._streamClient.on('change', ({ cascadeId }) => this._onStreamChange(cascadeId));
        this._streamClient.on('error', (err) => this.emit('error', err));
        this._streamClient.on('disconnected', (cascadeId) => {
            // 流断开后尝试重连
            setTimeout(() => {
                if (this.conversations.get(cascadeId)?.subscribers.size > 0) {
                    this._streamClient?.subscribe(cascadeId);
                }
            }, 2000);
        });

        this._lsHealthy = true;
        this._startHealthCheck();
        this.emit('ls_connected', this.ls);
        return true;
    }

    /**
     * 刷新 LS 连接 (重新发现 + 重建 StreamClient + 重新订阅)
     * @returns {Promise<boolean>}
     */
    async refreshLS() {
        const oldLs = this.ls;
        this.ls = await discoverLSAsync();
        if (!this.ls) {
            if (this._lsHealthy) {
                this._lsHealthy = false;
                this.emit('ls_disconnected');
            }
            return false;
        }

        const portChanged = !oldLs || oldLs.port !== this.ls.port;

        if (portChanged) {
            // 重建 StreamClient
            if (this._streamClient) {
                this._streamClient.destroy();
            }
            this._streamClient = new StreamClient(this.ls.port, this.ls.csrf);
            this._streamClient.on('change', ({ cascadeId }) => this._onStreamChange(cascadeId));
            this._streamClient.on('error', (err) => this.emit('error', err));
            this._streamClient.on('disconnected', (cascadeId) => {
                setTimeout(() => {
                    if (this.conversations.get(cascadeId)?.subscribers.size > 0) {
                        this._streamClient?.subscribe(cascadeId);
                    }
                }, 2000);
            });

            // 重新订阅所有有 subscriber 的对话
            for (const [cascadeId, conv] of this.conversations) {
                if (conv.subscribers.size > 0) {
                    this._streamClient.subscribe(cascadeId);
                }
            }

            this.emit('ls_changed', { old: oldLs, new: this.ls });
        }

        if (!this._lsHealthy) {
            this._lsHealthy = true;
            this.emit('ls_reconnected', this.ls);
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
        const data = result.data;

        // 同步到 controller 内部状态，让 _fetchAndDiff 有正确的基线
        if (data && data.trajectory) {
            if (!this.conversations.has(cascadeId)) {
                this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
            }
            const conv = this.conversations.get(cascadeId);
            conv.steps = data.trajectory.steps || [];
            conv.status = (data.status || '').replace('CASCADE_RUN_STATUS_', '');
            conv.totalSteps = data.numTotalSteps || conv.steps.length;
            conv.lastPollAt = Date.now();
        }

        return data || null;
    }

    // ========== 订阅管理 ==========

    /**
     * 订阅对话的实时更新
     * @param {string} cascadeId
     * @param {WebSocket} ws
     */
    subscribe(cascadeId, ws, lastSeq = null) {
        if (!this.conversations.has(cascadeId)) {
            this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
        }
        const conv = this.conversations.get(cascadeId);
        conv.subscribers.add(ws);

        // 增量恢复：如果客户端提供了 lastSeq，发送缓冲区中比它新的事件
        if (lastSeq != null && conv.eventBuffer.length > 0) {
            const missed = conv.eventBuffer.filter(e => e.seq > lastSeq);
            if (missed.length > 0) {
                try {
                    if (ws.readyState === 1) {
                        ws.send(JSON.stringify({
                            type: 'events_batch',
                            cascadeId,
                            events: missed.map(e => e.event),
                        }));
                    }
                } catch { /* ignore */ }
            }
        }

        // 启动流式订阅
        if (this._streamClient && !this._streamClient.isSubscribed(cascadeId)) {
            this._streamClient.subscribe(cascadeId);
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
            // 无订阅者时断开流
            if (conv.subscribers.size === 0 && this._streamClient) {
                this._streamClient.unsubscribe(cascadeId);
            }
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
     * 提取 step 的文本内容用于比较
     * @private
     */
    _getStepText(step) {
        if (!step) return { response: '', thinking: '' };
        const pr = step.plannerResponse || step.action?.plannerResponse || {};
        return {
            response: pr.response || '',
            thinking: pr.thinking || '',
        };
    }

    /**
     * 计算 steps 的增量差异
     * 比较维度: 新增 step / status 变化 / 文本内容变化
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
            } else {
                // 状态没变，检查文本内容是否增长（流式输出）
                const oldText = this._getStepText(oldSteps[i]);
                const newText = this._getStepText(newSteps[i]);
                if (newText.response !== oldText.response ||
                    newText.thinking !== oldText.thinking) {
                    updated.push({ index: i, step: newSteps[i] });
                }
            }
        }

        return { added, updated };
    }

    // ========== 流式通知处理 ==========

    /**
     * 收到流式变更通知 → 节流 + 尾调用拉取最新数据
     *
     * 纯防抖在高频通知下会活锁（每次新通知 clearTimeout 上一次，
     * fetchAndDiff 永远不执行）。改为 throttle with trailing：
     *   - 距上次 fetch >= throttleMs → 立即执行
     *   - 否则设置尾调用，保证窗口结束后还会执行一次
     * @private
     */
    _onStreamChange(cascadeId) {
        // 取消已有的尾调用 timer
        const existing = this._changeDebouncers.get(cascadeId);
        if (existing) clearTimeout(existing);

        const now = Date.now();
        const lastFetch = this._lastFetchTimes.get(cascadeId) || 0;

        // 动态节流间隔: GENERATING 时 300ms，否则 150ms
        const conv = this.conversations.get(cascadeId);
        const hasGenerating = conv?.steps?.some(
            s => s.status === 'CORTEX_STEP_STATUS_GENERATING',
        );
        const throttleMs = hasGenerating ? 300 : 150;

        const elapsed = now - lastFetch;

        const doFetch = async () => {
            this._lastFetchTimes.set(cascadeId, Date.now());
            try {
                await this._fetchAndDiff(cascadeId);
            } catch (err) {
                this.emit('error', new Error(`stream-fetch ${cascadeId}: ${err.message}`));
            }
        };

        if (elapsed >= throttleMs) {
            // 距上次 fetch 已够久，立即执行
            doFetch();
        } else {
            // 设置尾调用，保证窗口结束后还会执行一次
            const remaining = throttleMs - elapsed;
            this._changeDebouncers.set(cascadeId, setTimeout(() => {
                this._changeDebouncers.delete(cascadeId);
                doFetch();
            }, remaining));
        }
    }

    // ========== Polling Fallback ==========

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
     * Polling fallback — 仅在发送消息后 RUNNING 状态使用
     * @private
     */
    async _pollLoop() {
        if (!this.isPolling) return;

        try {
            await this.pollOnce();
        } catch (err) {
            this.emit('error', err);
        }

        // RUNNING 对话才继续轮询（流式通知可能还没建立）
        const hasRunning = [...this.conversations.values()].some(
            c => c.status === 'RUNNING',
        );

        if (!hasRunning) {
            this.isPolling = false;
            return;
        }

        this._pollTimer = setTimeout(() => this._pollLoop(), POLL_TICK_MS);
    }

    /**
     * 拉取最新数据并 diff（流式通知和轮询共用）
     * @private
     */
    async _fetchAndDiff(cascadeId) {
        if (!this.ls) return;

        const conv = this.conversations.get(cascadeId);
        if (!conv) return;

        const result = await grpcCall(this.ls.port, this.ls.csrf, 'GetCascadeTrajectory', { cascadeId });
        const data = result.data;
        if (!data || !data.trajectory) return;

        const newSteps = data.trajectory.steps || [];
        const newStatus = (data.status || '').replace('CASCADE_RUN_STATUS_', '');
        const oldStatus = conv.status;

        // Diff
        const diff = this.diffSteps(conv.steps, newSteps);

        // 通知订阅者（每个事件分配 seq）
        if (diff.added.length > 0 || diff.updated.length > 0) {
            for (const { index, step } of diff.added) {
                this._broadcastWithSeq(conv, { type: 'event_step_added', cascadeId, stepIndex: index, step });
            }
            for (const { index, step } of diff.updated) {
                this._broadcastWithSeq(conv, { type: 'event_step_updated', cascadeId, stepIndex: index, step });
            }
        }

        // 状态变化
        if (newStatus !== oldStatus) {
            this._broadcastWithSeq(conv, { type: 'event_status_changed', cascadeId, from: oldStatus, to: newStatus });
            this.emit('status_changed', { cascadeId, from: oldStatus, to: newStatus });
        }

        // 更新状态
        conv.steps = newSteps;
        conv.totalSteps = data.numTotalSteps || newSteps.length;
        conv.status = newStatus;
        conv.lastPollAt = Date.now();
    }

    /**
     * Polling fallback — 遍历 RUNNING 对话
     */
    async pollOnce() {
        if (!this.ls) return;

        const now = Date.now();

        for (const [cascadeId, conv] of this.conversations) {
            // 只轮询 RUNNING 状态（IDLE 由流式通知覆盖）
            if (conv.status !== 'RUNNING') continue;
            // 自适应间隔
            if (conv.lastPollAt && (now - conv.lastPollAt) < conv.pollInterval) continue;

            try {
                await this._fetchAndDiff(cascadeId);
                conv.pollInterval = POLL_MIN_INTERVAL;
            } catch (err) {
                this.emit('error', new Error(`poll ${cascadeId}: ${err.message}`));
                conv.pollInterval = Math.min(conv.pollInterval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL);
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
    /**
     * 广播并分配 seq
     * @private
     */
    _broadcastWithSeq(conv, event) {
        const seq = conv.nextSeq++;
        const eventWithSeq = { ...event, seq };
        const message = JSON.stringify(eventWithSeq);

        // 缓存到环形缓冲区
        conv.eventBuffer.push({ seq, event: eventWithSeq });
        if (conv.eventBuffer.length > EVENT_BUFFER_MAX) {
            conv.eventBuffer = conv.eventBuffer.slice(-EVENT_BUFFER_MAX);
        }

        for (const ws of conv.subscribers) {
            try {
                if (ws.readyState === 1) {
                    ws.send(message);
                } else {
                    conv.subscribers.delete(ws);
                }
            } catch {
                conv.subscribers.delete(ws);
            }
        }

        this.emit(event.type, eventWithSeq);
    }

    /**
     * 获取某个对话的当前 seq
     */
    getCurrentSeq(cascadeId) {
        const conv = this.conversations.get(cascadeId);
        return conv ? conv.nextSeq - 1 : 0;
    }

    // ========== 健康检查 ==========

    /**
     * 启动定期心跳检查
     * @private
     */
    _startHealthCheck() {
        this._stopHealthCheck();
        this._healthTimer = setInterval(() => this._doHealthCheck(), HEALTH_CHECK_INTERVAL);
    }

    /**
     * 停止心跳检查
     * @private
     */
    _stopHealthCheck() {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
    }

    /**
     * 执行一次心跳检查
     * @private
     */
    async _doHealthCheck() {
        if (!this.ls) {
            // LS 没连上，尝试重新发现
            await this.refreshLS();
            return;
        }

        try {
            await grpcCall(this.ls.port, this.ls.csrf, 'Heartbeat', { metadata: {} });
            // 心跳成功
            if (!this._lsHealthy) {
                this._lsHealthy = true;
                this.emit('ls_reconnected', this.ls);
            }
        } catch {
            // 心跳失败 → LS 可能已死
            console.warn('[!] 健康检查失败，尝试重新发现 LS...');
            if (this._lsHealthy) {
                this._lsHealthy = false;
                this.emit('ls_disconnected');
            }
            this.ls = null;
            // 立即尝试重连，不等下次 interval
            await this.refreshLS();
        }
    }

    /**
     * 销毁 Controller
     */
    destroy() {
        this.stopPolling();
        this._stopHealthCheck();
        if (this._streamClient) {
            this._streamClient.destroy();
            this._streamClient = null;
        }
        for (const timer of this._changeDebouncers.values()) {
            clearTimeout(timer);
        }
        this._changeDebouncers.clear();
        this._lastFetchTimes.clear();
        this.conversations.clear();
        this.removeAllListeners();
    }
}

module.exports = { Controller, createConversationState };
