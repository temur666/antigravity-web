/**
 * lib/core/controller.js — Antigravity Controller (组合层)
 *
 * 将 LSManager + ConversationStore + ConversationSync 组合为统一接口。
 * 保持对外 API 不变，内部职责已拆分到:
 *   - ls/manager.js      → LS 连接生命周期
 *   - conversation/state.js  → 对话状态 + CRUD
 *   - conversation/sync.js   → 订阅 + diff + 广播
 *   - conversation/archive.js → 对话归档 + SQLite 索引
 */

const EventEmitter = require('events');
const { LSPool } = require('./ls/pool');
const { ConversationStore, createConversationState } = require('./conversation/state');
const { ConversationSync } = require('./conversation/sync');
const { ConversationArchive } = require('./conversation/archive');
const { DEFAULT_CONFIG } = require('./ws-protocol');

class Controller extends EventEmitter {
    constructor() {
        super();

        // 子模块 — 使用 LSPool 替代 LSManager
        this._lsManager = new LSPool();
        this._store = new ConversationStore(this._lsManager);
        this._sync = new ConversationSync(this._lsManager, this._store);
        this._archive = new ConversationArchive(this._lsManager);

        // 代理属性 (兼容旧代码直接访问)
        this.config = this._store.config;
        this.isPolling = false;

        // 转发事件
        this._lsManager.on('ls_connected', (ls) => this.emit('ls_connected', ls));
        this._lsManager.on('ls_disconnected', () => this.emit('ls_disconnected'));
        this._lsManager.on('ls_reconnected', (ls) => this.emit('ls_reconnected', ls));
        this._lsManager.on('ls_changed', (info) => this.emit('ls_changed', info));
        this._lsManager.on('error', (err) => this.emit('error', err));
        this._sync.on('error', (err) => this.emit('error', err));
        this._sync.on('status_changed', (info) => this.emit('status_changed', info));

        // 转发所有 step 事件
        for (const eventType of ['event_step_added', 'event_step_updated', 'event_metadata_updated', 'event_status_changed']) {
            this._sync.on(eventType, (data) => this.emit(eventType, data));
        }

        // 对话完成时归档
        this._sync.on('conversation_completed', ({ cascadeId, stepCount }) => {
            this._archive.onComplete(cascadeId, { stepCount }).catch(err => {
                console.error(`[Controller] archive onComplete failed:`, err.message);
            });
        });
    }

    // ========== 代理属性 ==========

    /** @type {{ port: number, csrf: string, pid: number, version: string } | null} */
    get ls() { return this._lsManager.ls; }
    set ls(val) { this._lsManager.ls = val; }

    /** @type {Map<string, import('./conversation/state').ConversationState>} */
    get conversations() { return this._store.conversations; }

    // ========== LS 生命周期 ==========

    async init() {
        const ok = await this._lsManager.init();
        if (ok) {
            // 启动时将 LS 已有对话同步到索引
            this._archive.syncFromLS().catch(err => {
                console.error(`[Controller] syncFromLS failed:`, err.message);
            });
        }
        return ok;
    }
    async refreshLS() { return this._lsManager.refreshLS(); }

    // ========== 配置 ==========

    setConfig(partial) { this._store.setConfig(partial); }
    getConfig() { return this._store.getConfig(); }

    // ========== 状态 ==========

    getStatus() {
        return {
            ls: this._lsManager.getStatus(),
            config: this._store.getConfig(),
            conversations: {
                total: this._store.conversations.size,
                running: [...this._store.conversations.values()].filter(c => c.status === 'RUNNING').length,
                subscribed: [...this._store.conversations.values()].filter(c => c.subscribers.size > 0).length,
            },
            polling: this._sync.isPolling,
        };
    }

    // ========== 对话 CRUD ==========

    async listConversations() { return this._store.listConversations(); }
    async newChat() {
        const cascadeId = await this._store.newChat();
        if (cascadeId) {
            this._archive.onCreate(cascadeId, { source: 'manual' });
        }
        return cascadeId;
    }

    async sendMessage(cascadeId, text, configOverride, extras) {
        const traceId = extras?.traceId || 'no-trace';
        console.log(`[Trace:4-Controller] sendMessage | traceId=${traceId} cascadeId=${cascadeId.slice(0, 8)}`);
        await this._store.sendMessage(cascadeId, text, configOverride, extras);
        // 发消息后启动轮询
        if (!this._sync.isPolling) {
            this._sync.startPolling();
        }
    }

    async cancelCascade(cascadeId) { return this._store.cancelCascade(cascadeId); }
    async getTrajectory(cascadeId) { return this._store.getTrajectory(cascadeId); }

    // ========== 订阅 ==========

    subscribe(cascadeId, ws, lastSeq = null) { this._sync.subscribe(cascadeId, ws, lastSeq); }
    unsubscribe(cascadeId, ws) { this._sync.unsubscribe(cascadeId, ws); }
    unsubscribeAll(ws) { this._sync.unsubscribeAll(ws); }
    getCurrentSeq(cascadeId) { return this._sync.getCurrentSeq(cascadeId); }

    // ========== Diff (保持公开，供测试使用) ==========

    diffSteps(oldSteps, newSteps) { return this._sync.diffSteps(oldSteps, newSteps); }

    // ========== Polling ==========

    startPolling() { this._sync.startPolling(); }
    stopPolling() { this._sync.stopPolling(); }
    async pollOnce() { return this._sync.pollOnce(); }


    // ========== Archive 代理 ==========

    /** @returns {import('./conversation/archive').ConversationArchive} */
    get archive() { return this._archive; }

    // ========== 销毁 ==========

    destroy() {
        this._sync.destroy();
        this._store.destroy();
        this._archive.destroy();
        this._lsManager.destroy();
        this.removeAllListeners();
    }
}

module.exports = { Controller, createConversationState };
