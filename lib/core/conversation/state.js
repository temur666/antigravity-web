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
     * @param {import('../ls/manager').LSManager | import('../ls/pool').LSPool} lsManager
     */
    constructor(lsManager) {
        /** @type {import('../ls/manager').LSManager | import('../ls/pool').LSPool} */
        this._lsManager = lsManager;
        /** @type {Map<string, ConversationState>} */
        this.conversations = new Map();
        /** @type {object} */
        this.config = { ...DEFAULT_CONFIG };
    }

    /** @private 检查 lsManager 是否为 LSPool */
    get _isPool() {
        return typeof this._lsManager.grpcCallAll === 'function';
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

        // 方式 1: LS API（Pool 模式并行查询所有 LS，单 LS 模式只查一个）
        if (this._isPool) {
            try {
                const results = await this._lsManager.grpcCallAll('GetAllCascadeTrajectories', {});
                for (const r of results) {
                    const summaries = r.data?.trajectorySummaries || {};
                    for (const [id, info] of Object.entries(summaries)) {
                        // 建立路由表
                        this._lsManager.setRoute(id, r.key);
                        // 合并：已存在的保留信息更全的版本
                        const existing = conversations.get(id);
                        if (existing && existing.title) continue;
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
                }
            } catch { /* 非致命 */ }
        } else {
            const ls = this._lsManager.ls;
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
                } catch { /* 非致命 */ }
            }
        }

        // 方式 2: .pb 文件扫描 + 孤儿预加载
        const orphanIds = [];
        try {
            const fs = require('fs');
            const path = require('path');
            const convDir = path.join(
                process.env.HOME || '/home/tiemuer',
                '.gemini', 'antigravity', 'conversations',
            );
            const files = await fs.promises.readdir(convDir);
            const pbFiles = files.filter(f => f.endsWith('.pb'));

            await Promise.all(pbFiles.map(async (f) => {
                const id = f.replace('.pb', '');
                if (conversations.has(id)) return;
                try {
                    const stat = await fs.promises.stat(path.join(convDir, f));
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
                    orphanIds.push(id);
                } catch { /* stat 失败跳过 */ }
            }));
        } catch { /* .pb 目录不存在 */ }

        // 方式 2.5: 批量 LoadTrajectory 预加载孤儿 → 回填元数据
        if (orphanIds.length > 0 && this._isPool) {
            console.log(`[listConversations] 发现 ${orphanIds.length} 个孤儿对话，开始预加载...`);
            const loadResults = await Promise.all(
                orphanIds.map(id => this._lsManager.loadTrajectory(id)),
            );
            const loaded = loadResults.filter(Boolean).length;
            if (loaded > 0) {
                console.log(`[listConversations] 成功预加载 ${loaded}/${orphanIds.length} 个孤儿对话，回填元数据...`);
                // 重新查询 primary LS 获取新加载的对话元数据
                try {
                    const refetch = await this._lsManager.grpcCallPrimary('GetAllCascadeTrajectories', {});
                    const summaries = refetch.data?.trajectorySummaries || {};
                    for (const id of orphanIds) {
                        const info = summaries[id];
                        if (info) {
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
                    }
                } catch { /* 回填失败不影响列表 */ }
            }
        }

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
        let result;
        if (this._isPool) {
            result = await this._lsManager.grpcCallPrimary('StartCascade', {});
        } else {
            const ls = this._lsManager.ls;
            if (!ls) throw new Error('LS not connected');
            result = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
        }
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
        const cfg = configOverride ? { ...this.config, ...configOverride } : this.config;
        const body = buildSendBody(cascadeId, text, cfg, extras);

        if (extras?.media?.length > 0) {
            const bodyJson = JSON.stringify(body);
            const itemTypes = body.items.map(i => Object.keys(i).join(','));
            console.log(`[sendMessage] Body size: ${bodyJson.length} bytes, items: [${itemTypes.join(' | ')}]`);
        }

        let result;
        if (this._isPool) {
            result = await this._lsManager.grpcCallRouted(cascadeId, 'SendUserCascadeMessage', body);
        } else {
            const ls = this._lsManager.ls;
            if (!ls) throw new Error('LS not connected');
            result = await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
        }

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
        if (this._isPool) {
            await this._lsManager.grpcCallRouted(cascadeId, 'CancelCascadeInvocation', { cascadeId });
        } else {
            const ls = this._lsManager.ls;
            if (!ls) throw new Error('LS not connected');
            await grpcCall(ls.port, ls.csrf, 'CancelCascadeInvocation', { cascadeId });
        }
    }

    /**
     * 获取对话轨迹
     * 如果 LS 内存中没有该对话，自动调用 LoadTrajectory 从磁盘恢复后重试
     * @param {string} cascadeId
     * @returns {Promise<object|null>}
     */
    async getTrajectory(cascadeId) {
        let result;
        if (this._isPool) {
            result = await this._lsManager.grpcCallRouted(cascadeId, 'GetCascadeTrajectory', { cascadeId });
        } else {
            const ls = this._lsManager.ls;
            if (!ls) throw new Error('LS not connected');
            result = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId });
        }
        let data = result.data;

        // 孤儿恢复：LS 返回空 trajectory → 检查 .pb → LoadTrajectory → 重试
        if ((!data?.trajectory || !data.trajectory.steps?.length) && this._isPool) {
            const fs = require('fs');
            const path = require('path');
            const pbPath = path.join(
                process.env.HOME || '/home/tiemuer',
                '.gemini', 'antigravity', 'conversations',
                `${cascadeId}.pb`,
            );
            try {
                await fs.promises.access(pbPath);
                // .pb 存在 → LoadTrajectory 恢复
                const loaded = await this._lsManager.loadTrajectory(cascadeId);
                if (loaded) {
                    // 重试 GetCascadeTrajectory
                    const retry = await this._lsManager.grpcCallRouted(
                        cascadeId, 'GetCascadeTrajectory', { cascadeId },
                    );
                    data = retry.data;
                    console.log(`[getTrajectory] 孤儿恢复成功: ${cascadeId.slice(0, 8)}... steps=${data?.trajectory?.steps?.length ?? 0}`);
                }
            } catch { /* .pb 不存在或 LoadTrajectory 失败，继续用原结果 */ }
        }

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
