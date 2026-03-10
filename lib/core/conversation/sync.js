/**
 * lib/core/conversation/sync.js — 对话数据同步
 *
 * 职责:
 *   - subscribe / unsubscribe (WebSocket 订阅管理)
 *   - Diff 引擎 (steps 增量计算)
 *   - 流式通知处理 (throttle + trailing call)
 *   - Polling fallback
 *   - 广播 (seq 分配 + 环形缓冲区)
 */

const EventEmitter = require('events');
const { grpcCall } = require('../ls/grpc');
const { normalizeSteps } = require('./step-normalizer');
const { POLL_MIN_INTERVAL, EVENT_BUFFER_MAX } = require('./state');

// ========== 常量 ==========

const POLL_MAX_INTERVAL = 5000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_TICK_MS = 500;

// ========== ConversationSync ==========

class ConversationSync extends EventEmitter {
    /**
     * @param {import('../ls/manager').LSManager} lsManager
     * @param {import('./state').ConversationStore} store
     */
    constructor(lsManager, store) {
        super();
        this._lsManager = lsManager;
        this._store = store;
        /** @type {boolean} */
        this.isPolling = false;
        /** @type {NodeJS.Timeout|null} */
        this._pollTimer = null;
        /** @type {Map<string, NodeJS.Timeout>} 尾调用 timer */
        this._changeDebouncers = new Map();
        /** @type {Map<string, number>} 节流: cascadeId → 上次 fetch 时间戳 */
        this._lastFetchTimes = new Map();

        // 注册 stream change 回调到 LSManager
        lsManager.onStreamChange((cascadeId) => this._onStreamChange(cascadeId));
        lsManager.onGetActiveSubscriptions(() => this._getActiveSubscriptions());
    }

    /**
     * 获取所有有 subscriber 的 cascadeId
     * @private
     * @returns {string[]}
     */
    _getActiveSubscriptions() {
        const ids = [];
        for (const [cascadeId, conv] of this._store.conversations) {
            if (conv.subscribers.size > 0) {
                ids.push(cascadeId);
            }
        }
        return ids;
    }

    // ========== 订阅管理 ==========

    /**
     * 订阅对话的实时更新
     * @param {string} cascadeId
     * @param {WebSocket} ws
     * @param {number|null} [lastSeq]
     */
    subscribe(cascadeId, ws, lastSeq = null) {
        const conv = this._store.getOrCreate(cascadeId);
        conv.subscribers.add(ws);

        // 增量恢复
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
        const streamClient = this._lsManager.getStreamClient();
        if (streamClient && !streamClient.isSubscribed(cascadeId)) {
            streamClient.subscribe(cascadeId);
        }
    }

    /**
     * 取消订阅
     * @param {string} cascadeId
     * @param {WebSocket} ws
     */
    unsubscribe(cascadeId, ws) {
        const conv = this._store.conversations.get(cascadeId);
        if (conv) {
            conv.subscribers.delete(ws);
            if (conv.subscribers.size === 0) {
                const streamClient = this._lsManager.getStreamClient();
                if (streamClient) {
                    streamClient.unsubscribe(cascadeId);
                }
            }
        }
    }

    /**
     * 移除某个 WS 的所有订阅
     * @param {WebSocket} ws
     */
    unsubscribeAll(ws) {
        const streamClient = this._lsManager.getStreamClient();
        for (const [cascadeId, conv] of this._store.conversations) {
            if (conv.subscribers.has(ws)) {
                conv.subscribers.delete(ws);
                if (conv.subscribers.size === 0 && streamClient) {
                    streamClient.unsubscribe(cascadeId);
                }
            }
        }
    }

    /**
     * 获取当前 seq
     * @param {string} cascadeId
     * @returns {number}
     */
    getCurrentSeq(cascadeId) {
        const conv = this._store.conversations.get(cascadeId);
        return conv ? conv.nextSeq - 1 : 0;
    }

    // ========== Diff 引擎 ==========

    /**
     * 提取 step 文本用于比较
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
     * 计算 steps 增量差异
     * @param {Array} oldSteps
     * @param {Array} newSteps
     * @returns {{ added: Array, updated: Array }}
     */
    diffSteps(oldSteps, newSteps) {
        const added = [];
        const updated = [];

        for (let i = 0; i < newSteps.length; i++) {
            if (i >= oldSteps.length) {
                added.push({ index: i, step: newSteps[i] });
            } else if (newSteps[i].status !== oldSteps[i].status) {
                updated.push({ index: i, step: newSteps[i] });
            } else {
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
     * 收到流式变更通知 → throttle with trailing
     * @private
     */
    _onStreamChange(cascadeId) {
        const existing = this._changeDebouncers.get(cascadeId);
        if (existing) clearTimeout(existing);

        const now = Date.now();
        const lastFetch = this._lastFetchTimes.get(cascadeId) || 0;

        const conv = this._store.conversations.get(cascadeId);
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
            doFetch();
        } else {
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

    /** @private */
    async _pollLoop() {
        if (!this.isPolling) return;

        try {
            await this.pollOnce();
        } catch (err) {
            this.emit('error', err);
        }

        const hasRunning = [...this._store.conversations.values()].some(
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
        const ls = this._lsManager.ls;
        if (!ls) return;

        const conv = this._store.conversations.get(cascadeId);
        if (!conv) return;

        const result = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId });
        const data = result.data;
        if (!data || !data.trajectory) return;

        const newSteps = normalizeSteps(data.trajectory.steps || []);
        const newStatus = (data.status || '').replace('CASCADE_RUN_STATUS_', '');
        const newMetadata = data.trajectory.generatorMetadata || [];
        const oldStatus = conv.status;

        // Diff
        const diff = this.diffSteps(conv.steps, newSteps);

        // 通知订阅者
        if (diff.added.length > 0 || diff.updated.length > 0) {
            for (const { index, step } of diff.added) {
                this._broadcastWithSeq(conv, { type: 'event_step_added', cascadeId, stepIndex: index, step });
            }
            for (const { index, step } of diff.updated) {
                this._broadcastWithSeq(conv, { type: 'event_step_updated', cascadeId, stepIndex: index, step });
            }
        }

        if (newMetadata.length !== conv.metadata.length) {
            this._broadcastWithSeq(conv, { type: 'event_metadata_updated', cascadeId, metadata: newMetadata });
        }

        if (newStatus !== oldStatus) {
            this._broadcastWithSeq(conv, { type: 'event_status_changed', cascadeId, from: oldStatus, to: newStatus });
            this.emit('status_changed', { cascadeId, from: oldStatus, to: newStatus });
        }

        // 更新状态
        conv.steps = newSteps;
        conv.totalSteps = data.numTotalSteps || newSteps.length;
        conv.status = newStatus;
        conv.metadata = newMetadata;
        conv.lastPollAt = Date.now();
    }

    /**
     * 轮询一次所有 RUNNING 对话
     */
    async pollOnce() {
        const ls = this._lsManager.ls;
        if (!ls) return;

        const now = Date.now();

        for (const [cascadeId, conv] of this._store.conversations) {
            if (conv.status !== 'RUNNING') continue;
            if (conv.lastPollAt && (now - conv.lastPollAt) < conv.pollInterval) continue;

            try {
                await this._fetchAndDiff(cascadeId);
                conv.pollInterval = POLL_MIN_INTERVAL;
            } catch (err) {
                this.emit('error', new Error(`poll ${cascadeId}: ${err.message}`));
                conv.pollInterval = Math.min(conv.pollInterval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL);
                if (err.message.includes('ECONNREFUSED') || err.message.includes('timeout')) {
                    await this._lsManager.refreshLS();
                }
            }
        }
    }

    // ========== 广播 ==========

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

    destroy() {
        this.stopPolling();
        for (const timer of this._changeDebouncers.values()) {
            clearTimeout(timer);
        }
        this._changeDebouncers.clear();
        this._lastFetchTimes.clear();
        this.removeAllListeners();
    }
}

module.exports = { ConversationSync };
