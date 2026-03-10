/**
 * lib/data/conversation-index.js — 对话索引 SQLite CRUD
 *
 * 纯数据层，零业务逻辑。
 * 负责对话元数据的持久化：insert、finalize、list、get、delete、upsertMany、stats。
 *
 * Schema 设计见 docs/tasks/conversation-index.md Phase 1。
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/conversations.db');

class ConversationIndex {
    /**
     * @param {string} [dbPath] — 数据库文件路径，默认 data/conversations.db
     */
    constructor(dbPath) {
        this._dbPath = dbPath || DEFAULT_DB_PATH;
        this._ensureDir();
        this._db = new Database(this._dbPath);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('foreign_keys = ON');
        this._initSchema();
        this._prepareStatements();
    }

    // ========== 私有方法 ==========

    _ensureDir() {
        const dir = path.dirname(this._dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    _initSchema() {
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                cascade_id    TEXT PRIMARY KEY,
                trajectory_id TEXT,
                title         TEXT DEFAULT '',
                step_count    INTEGER DEFAULT 0,
                status        TEXT DEFAULT 'IDLE',
                account       TEXT,
                gemini_dir    TEXT,
                source        TEXT,
                workspace     TEXT DEFAULT '',
                created_at    TEXT,
                updated_at    TEXT,
                archived_at   TEXT,
                yolo_task     TEXT,
                yolo_summary  TEXT,
                markdown      TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_account ON conversations(account);
            CREATE INDEX IF NOT EXISTS idx_conv_source  ON conversations(source);
        `);
    }

    _prepareStatements() {
        this._stmts = {
            insert: this._db.prepare(`
                INSERT OR IGNORE INTO conversations
                    (cascade_id, account, gemini_dir, source, workspace, created_at, updated_at)
                VALUES
                    (@cascadeId, @account, @geminiDir, @source, @workspace, @createdAt, @createdAt)
            `),

            finalize: this._db.prepare(`
                UPDATE conversations SET
                    title         = COALESCE(@title, title),
                    step_count    = COALESCE(@stepCount, step_count),
                    trajectory_id = COALESCE(@trajectoryId, trajectory_id),
                    status        = COALESCE(@status, status),
                    updated_at    = COALESCE(@updatedAt, updated_at),
                    archived_at   = COALESCE(@archivedAt, archived_at),
                    markdown      = COALESCE(@markdown, markdown),
                    yolo_task     = COALESCE(@yoloTask, yolo_task),
                    yolo_summary  = COALESCE(@yoloSummary, yolo_summary)
                WHERE cascade_id = @cascadeId
            `),

            get: this._db.prepare(`
                SELECT * FROM conversations WHERE cascade_id = ?
            `),

            delete: this._db.prepare(`
                DELETE FROM conversations WHERE cascade_id = ?
            `),

            upsert: this._db.prepare(`
                INSERT INTO conversations
                    (cascade_id, trajectory_id, title, step_count, status, account, workspace, created_at, updated_at)
                VALUES
                    (@cascadeId, @trajectoryId, @title, @stepCount, @status, @account, @workspace, @createdAt, @updatedAt)
                ON CONFLICT(cascade_id) DO UPDATE SET
                    trajectory_id = COALESCE(@trajectoryId, trajectory_id),
                    title         = CASE WHEN LENGTH(@title) > 0 THEN @title ELSE title END,
                    step_count    = CASE WHEN @stepCount > step_count THEN @stepCount ELSE step_count END,
                    status        = COALESCE(@status, status),
                    updated_at    = COALESCE(@updatedAt, updated_at)
            `),

            countTotal: this._db.prepare(`SELECT COUNT(*) as total FROM conversations`),
            countByAccount: this._db.prepare(`SELECT account, COUNT(*) as count FROM conversations GROUP BY account`),
            countBySource: this._db.prepare(`SELECT source, COUNT(*) as count FROM conversations GROUP BY source`),
        };

        this._upsertMany = this._db.transaction((rows) => {
            for (const row of rows) {
                this._stmts.upsert.run(row);
            }
        });
    }

    // ========== 公开 API ==========

    /**
     * 插入新对话记录（INSERT OR IGNORE — 已存在则跳过）
     * @param {string} cascadeId
     * @param {object} meta - { account, geminiDir, source, workspace, createdAt }
     * @returns {{ changes: number }}
     */
    insert(cascadeId, meta = {}) {
        if (!cascadeId) throw new Error('cascadeId is required');
        const now = new Date().toISOString();
        return this._stmts.insert.run({
            cascadeId,
            account: meta.account || null,
            geminiDir: meta.geminiDir || null,
            source: meta.source || 'manual',
            workspace: meta.workspace || '',
            createdAt: meta.createdAt || now,
        });
    }

    /**
     * 归档完成的对话 — 更新 title、stepCount、markdown 等
     * @param {string} cascadeId
     * @param {object} data
     * @returns {{ changes: number }}
     */
    finalize(cascadeId, data = {}) {
        if (!cascadeId) throw new Error('cascadeId is required');
        const now = new Date().toISOString();
        return this._stmts.finalize.run({
            cascadeId,
            title: data.title || null,
            stepCount: data.stepCount ?? null,
            trajectoryId: data.trajectoryId || null,
            status: data.status || null,
            updatedAt: data.updatedAt || now,
            archivedAt: data.archivedAt || now,
            markdown: data.markdown || null,
            yoloTask: data.yoloTask || null,
            yoloSummary: data.yoloSummary || null,
        });
    }

    /**
     * 查询对话列表（分页 + 过滤 + 模糊搜索）
     * @param {object} opts - { limit, offset, account, source, search }
     * @returns {Array<object>}
     */
    list(opts = {}) {
        const { limit = 100, offset = 0, account, source, search } = opts;

        const conditions = [];
        const params = {};

        if (account) {
            conditions.push('account = @account');
            params.account = account;
        }
        if (source) {
            conditions.push('source = @source');
            params.source = source;
        }
        if (search) {
            conditions.push('(title LIKE @search OR yolo_task LIKE @search)');
            params.search = `%${search}%`;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
            SELECT * FROM conversations
            ${where}
            ORDER BY updated_at DESC, created_at DESC
            LIMIT @limit OFFSET @offset
        `;
        params.limit = limit;
        params.offset = offset;

        return this._db.prepare(sql).all(params);
    }

    /**
     * 获取单条对话
     * @param {string} cascadeId
     * @returns {object|undefined}
     */
    get(cascadeId) {
        return this._stmts.get.get(cascadeId);
    }

    /**
     * 删除对话（硬删除）
     * @param {string} cascadeId
     * @returns {{ changes: number }}
     */
    delete(cascadeId) {
        return this._stmts.delete.run(cascadeId);
    }

    /**
     * 批量 upsert — 从 LS 同步时使用，事务包裹
     * @param {Array<object>} conversations
     *   每项: { cascadeId, trajectoryId?, title?, stepCount?, status?, account?, workspace?, createdAt?, updatedAt? }
     */
    upsertMany(conversations) {
        const rows = conversations.map(c => ({
            cascadeId: c.cascadeId,
            trajectoryId: c.trajectoryId || null,
            title: c.title || '',
            stepCount: c.stepCount ?? 0,
            status: c.status || 'IDLE',
            account: c.account || null,
            workspace: c.workspace || '',
            createdAt: c.createdAt || null,
            updatedAt: c.updatedAt || null,
        }));
        this._upsertMany(rows);
    }

    /**
     * 统计信息
     * @returns {{ total: number, byAccount: object, bySource: object }}
     */
    stats() {
        const total = this._stmts.countTotal.get().total;

        const byAccount = {};
        for (const row of this._stmts.countByAccount.all()) {
            byAccount[row.account || 'unknown'] = row.count;
        }

        const bySource = {};
        for (const row of this._stmts.countBySource.all()) {
            bySource[row.source || 'unknown'] = row.count;
        }

        return { total, byAccount, bySource };
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }
}

module.exports = ConversationIndex;
