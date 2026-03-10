/**
 * lib/core/conversation/state.js — 对话状态管理 + CRUD
 *
 * 职责:
 *   - ConversationState 定义与创建
 *   - 对话列表获取 (LS API + .pb + SQLite)
 *   - 创建新对话 / 发送消息 / 取消 / 获取轨迹
 *   - 配置管理
 */

const { grpcCall } = require('../ls/grpc');
const { DEFAULT_CONFIG, buildSendBody } = require('../ws-protocol');
const { normalizeSteps } = require('./step-normalizer');

// ========== 常量 ==========

const POLL_MIN_INTERVAL = 1000;
const EVENT_BUFFER_MAX = 200;

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
        metadata: [],
        lastPollAt: null,
        pollInterval: POLL_MIN_INTERVAL,
        subscribers: new Set(),
        source,
        nextSeq: 1,
        eventBuffer: [],
    };
}

// ========== ConversationStore ==========

class ConversationStore {
    /**
     * @param {import('../ls/manager').LSManager} lsManager
     */
    constructor(lsManager) {
        /** @type {import('../ls/manager').LSManager} */
        this._lsManager = lsManager;
        /** @type {Map<string, ConversationState>} */
        this.conversations = new Map();
        /** @type {object} */
        this.config = { ...DEFAULT_CONFIG };
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

    // ========== 对话列表 ==========

    /**
     * 获取对话列表
     * 数据源优先级: LS API (GetAllCascadeTrajectories) → .pb 文件补充 → SQLite fallback
     * @returns {Promise<Array>}
     */
    async listConversations() {
        const conversations = new Map();
        const ls = this._lsManager.ls;

        // 方式 1: LS API
        if (ls) {
            try {
                const result = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
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
                // 非致命，继续用其他数据源
            }
        }

        // 方式 2: .pb 文件扫描
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
                if (conversations.has(id)) continue;
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

        // 方式 3: SQLite fallback
        try {
            const { getConversations } = require('../../data/conversations');
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

        return [...conversations.values()]
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    }

    // ========== 对话操作 ==========

    /**
     * 创建新对话
     * @returns {Promise<string|null>} cascadeId
     */
    async newChat() {
        const ls = this._lsManager.ls;
        if (!ls) throw new Error('LS not connected');

        const result = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
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
        const ls = this._lsManager.ls;
        if (!ls) throw new Error('LS not connected');

        const cfg = configOverride ? { ...this.config, ...configOverride } : this.config;
        const body = buildSendBody(cascadeId, text, cfg, extras);

        if (extras?.media?.length > 0) {
            const bodyJson = JSON.stringify(body);
            const itemTypes = body.items.map(i => Object.keys(i).join(','));
            console.log(`[sendMessage] Body size: ${bodyJson.length} bytes, items: [${itemTypes.join(' | ')}]`);
        }

        const result = await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);

        if (extras?.media?.length > 0) {
            console.log(`[sendMessage] gRPC response: status=${result.status}, data=${JSON.stringify(result.data).slice(0, 200)}`);
        }

        // 确保对话有状态
        if (!this.conversations.has(cascadeId)) {
            this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
        }
        const conv = this.conversations.get(cascadeId);
        conv.status = 'RUNNING';
        conv.pollInterval = POLL_MIN_INTERVAL;
    }

    /**
     * 取消正在执行的对话
     * @param {string} cascadeId
     * @returns {Promise<void>}
     */
    async cancelCascade(cascadeId) {
        const ls = this._lsManager.ls;
        if (!ls) throw new Error('LS not connected');
        await grpcCall(ls.port, ls.csrf, 'CancelCascadeInvocation', { cascadeId });
    }

    /**
     * 获取对话轨迹
     * @param {string} cascadeId
     * @returns {Promise<object|null>}
     */
    async getTrajectory(cascadeId) {
        const ls = this._lsManager.ls;
        if (!ls) throw new Error('LS not connected');

        const result = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId });
        const data = result.data;

        // 同步到内部状态
        if (data && data.trajectory) {
            if (!this.conversations.has(cascadeId)) {
                this.conversations.set(cascadeId, createConversationState(cascadeId, 'external'));
            }
            const conv = this.conversations.get(cascadeId);
            conv.steps = normalizeSteps(data.trajectory.steps || []);
            conv.status = (data.status || '').replace('CASCADE_RUN_STATUS_', '');
            conv.totalSteps = data.numTotalSteps || conv.steps.length;
            conv.metadata = data.trajectory.generatorMetadata || [];
            conv.lastPollAt = Date.now();
        }

        // 返回 normalized steps
        if (data?.trajectory) {
            const conv = this.conversations.get(cascadeId);
            return {
                ...data,
                trajectory: {
                    ...data.trajectory,
                    steps: conv?.steps || [],
                },
            };
        }

        return data || null;
    }

    /**
     * 获取或创建 ConversationState
     * @param {string} cascadeId
     * @returns {ConversationState}
     */
    getOrCreate(cascadeId, source = 'external') {
        if (!this.conversations.has(cascadeId)) {
            this.conversations.set(cascadeId, createConversationState(cascadeId, source));
        }
        return this.conversations.get(cascadeId);
    }

    destroy() {
        this.conversations.clear();
    }
}

module.exports = {
    ConversationStore,
    createConversationState,
    POLL_MIN_INTERVAL,
    EVENT_BUFFER_MAX,
};
