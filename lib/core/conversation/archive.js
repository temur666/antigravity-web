/**
 * lib/core/conversation/archive.js — 对话归档服务
 *
 * 协调 LS API + SQLite Index 的业务逻辑层。
 *
 * 职责:
 *   - onCreate   — 对话创建后，INSERT 到索引
 *   - onComplete — 对话完成后，拉取 title & markdown，UPDATE 索引
 *   - onDelete   — 对话删除后，DELETE 索引记录
 *   - syncFromLS — 从当前 LS 拉取所有对话，批量 upsert 到索引
 */

const ConversationIndex = require('../../data/conversation-index');
const { grpcCall } = require('../ls/grpc');
const { toMarkdown } = require('../../data/format');

class ConversationArchive {
    /**
     * @param {import('../ls/manager').LSManager} lsManager
     * @param {object} [opts]
     * @param {string} [opts.dbPath] — 自定义数据库路径（测试用）
     */
    constructor(lsManager, opts = {}) {
        this._lsManager = lsManager;
        this.index = new ConversationIndex(opts.dbPath);
    }

    // ========== 生命周期钩子 ==========

    /**
     * 对话创建后调用
     * @param {string} cascadeId
     * @param {object} meta - { account, geminiDir, source, workspace, createdAt }
     */
    onCreate(cascadeId, meta = {}) {
        if (!cascadeId) return;
        try {
            this.index.insert(cascadeId, {
                account: meta.account || null,
                geminiDir: meta.geminiDir || null,
                source: meta.source || 'manual',
                workspace: meta.workspace || '',
                createdAt: meta.createdAt || new Date().toISOString(),
            });
        } catch (err) {
            console.error(`[Archive] onCreate failed for ${cascadeId}:`, err.message);
        }
    }

    /**
     * 对话完成后调用（RUNNING → IDLE 且 stepCount > 3）
     * 异步拉取 title、trajectory，生成 markdown 并归档
     * @param {string} cascadeId
     * @param {object} [hint] — 已知信息（避免重复请求）
     * @param {number} [hint.stepCount]
     * @param {string} [hint.title]
     */
    async onComplete(cascadeId, hint = {}) {
        if (!cascadeId) return;

        const ls = this._lsManager.ls;
        if (!ls) {
            // LS 不可用时仅落 stepCount
            this.index.finalize(cascadeId, {
                stepCount: hint.stepCount || null,
                status: 'IDLE',
            });
            return;
        }

        try {
            // 1. 获取 title（从 GetAllCascadeTrajectories 摘要）
            let title = hint.title || '';
            if (!title) {
                title = await this._fetchTitle(cascadeId);
            }

            // 2. 获取完整 trajectory 并转 markdown
            let markdown = '';
            try {
                const trajResult = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId });
                if (trajResult.data?.trajectory) {
                    markdown = toMarkdown(trajResult.data, title, {
                        includeToolCalls: false,
                        includeThinking: false,
                        maxToolOutputLength: 500,
                    });
                }
            } catch (err) {
                console.error(`[Archive] Failed to get trajectory for ${cascadeId}:`, err.message);
            }

            // 3. 写入索引
            this.index.finalize(cascadeId, {
                title,
                stepCount: hint.stepCount || null,
                status: 'IDLE',
                markdown,
            });
        } catch (err) {
            console.error(`[Archive] onComplete failed for ${cascadeId}:`, err.message);
        }
    }

    /**
     * 对话删除后调用
     * @param {string} cascadeId
     */
    onDelete(cascadeId) {
        if (!cascadeId) return;
        try {
            this.index.delete(cascadeId);
        } catch (err) {
            console.error(`[Archive] onDelete failed for ${cascadeId}:`, err.message);
        }
    }

    // ========== 同步 ==========

    /**
     * 从当前 LS 拉取所有对话，批量 upsert 到索引
     * @param {string} [account] — 当前账号（标记来源）
     * @returns {Promise<{ synced: number, errors: number }>}
     */
    async syncFromLS(account) {
        const ls = this._lsManager.ls;
        if (!ls) return { synced: 0, errors: 0 };

        try {
            const result = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
            const summaries = result.data?.trajectorySummaries || {};
            const entries = Object.entries(summaries);
            if (entries.length === 0) return { synced: 0, errors: 0 };

            const rows = entries.map(([id, info]) => ({
                cascadeId: id,
                trajectoryId: null,
                title: info.summary || '',
                stepCount: info.stepCount || 0,
                status: (info.status || '').replace('CASCADE_RUN_STATUS_', ''),
                account: account || null,
                workspace: info.workspaces?.[0]?.workspaceFolderAbsoluteUri || '',
                createdAt: info.createdTime || null,
                updatedAt: info.lastModifiedTime || null,
            }));

            this.index.upsertMany(rows);
            return { synced: rows.length, errors: 0 };
        } catch (err) {
            console.error('[Archive] syncFromLS failed:', err.message);
            return { synced: 0, errors: 1 };
        }
    }

    /**
     * 合并实时 LS 状态到已索引列表（就地修改）
     * @param {Array<object>} indexed — SQLite 列表
     * @param {Map<string, object>} liveStatuses — { cascadeId → { status, stepCount } }
     */
    mergeStatuses(indexed, liveStatuses) {
        if (!liveStatuses || liveStatuses.size === 0) return;
        for (const row of indexed) {
            const live = liveStatuses.get(row.cascade_id);
            if (live) {
                if (live.status) row.status = live.status;
                if (live.stepCount > row.step_count) row.step_count = live.stepCount;
            }
        }
    }

    // ========== 私有方法 ==========

    /**
     * 从 LS 摘要中获取对话 title
     * @private
     */
    async _fetchTitle(cascadeId) {
        const ls = this._lsManager.ls;
        if (!ls) return '';
        try {
            const result = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
            const info = result.data?.trajectorySummaries?.[cascadeId];
            return info?.summary || '';
        } catch {
            return '';
        }
    }

    /**
     * 关闭数据库连接
     */
    destroy() {
        this.index.close();
    }
}

module.exports = { ConversationArchive };
