/**
 * lib/core/ls/pool.js — LS 连接池
 *
 * 管理多个 LS 实例，通过路由表将每个对话请求定向到正确的 LS。
 *
 * 职责:
 *   1. 发现并维护所有活跃 LS 实例
 *   2. 路由表: cascadeId → LSInstance
 *   3. 合并多个 LS 的对话列表
 *   4. 管理每个 LS 的 StreamClient
 *   5. 健康检查 + 动态增删实例
 *
 * 设计:
 *   - LSPool 继承 EventEmitter，兼容 LSManager 的事件接口
 *   - 对外暴露 `.ls` (primary) 保持向后兼容
 *   - 新增路由方法供 ConversationStore 使用
 */

const EventEmitter = require('events');
const { discoverAllLS, discoverLSAsync } = require('./discovery');
const { grpcCall } = require('./grpc');
const { StreamClient } = require('./stream-client');
const { fullHealthCheck } = require('./health-check');

const HEALTH_CHECK_INTERVAL = 30000;

// ========== LSPool ==========

class LSPool extends EventEmitter {
    constructor() {
        super();
        /** @type {Map<string, LSInstance>} key → instance */
        this.instances = new Map();
        /** @type {Map<string, string>} cascadeId → instance key */
        this.routeTable = new Map();
        /** @type {string|null} */
        this.primaryKey = null;

        /** @type {NodeJS.Timeout|null} */
        this._healthTimer = null;
        /** @type {Function|null} */
        this._onStreamChangeCb = null;
        /** @type {Function|null} */
        this._getActiveSubscriptionsCb = null;
    }

    // ========== 兼容 LSManager 接口 ==========

    /**
     * 返回 primary LS 实例（兼容旧代码 controller.ls）
     * @returns {{ port: number, csrf: string, pid: number, version: string } | null}
     */
    get ls() {
        if (!this.primaryKey) return null;
        const inst = this.instances.get(this.primaryKey);
        return inst ? { port: inst.port, csrf: inst.csrf, pid: inst.pid, version: inst.version } : null;
    }

    set ls(val) {
        // 兼容旧代码，一般不应使用
        if (val === null) this.primaryKey = null;
    }

    // ========== LSManager 兼容方法 ==========

    onStreamChange(cb) { this._onStreamChangeCb = cb; }
    onGetActiveSubscriptions(cb) { this._getActiveSubscriptionsCb = cb; }

    // 返回 primary 的 StreamClient
    getStreamClient() {
        if (!this.primaryKey) return null;
        return this.instances.get(this.primaryKey)?.stream || null;
    }

    // ========== 核心方法 ==========

    /**
     * 初始化：发现所有 LS → 健康检查 → 选主 → 启动心跳
     * @returns {Promise<boolean>}
     */
    async init() {
        const allLS = await discoverAllLS();

        if (allLS.length === 0) {
            // Fallback 到单实例发现
            const single = await discoverLSAsync();
            if (single) allLS.push(single);
        }

        if (allLS.length === 0) {
            this.emit('error', new Error('No LS instances found'));
            return false;
        }

        // 对每个 LS 做健康检查并创建实例
        for (const ls of allLS) {
            const health = await fullHealthCheck(ls);
            if (!health.ok) {
                console.warn(`[LSPool] LS PID=${ls.pid} Port=${ls.port} 健康检查失败，跳过`);
                continue;
            }

            const key = `${ls.pid}:${ls.port}`;
            const stream = this._createStream(key, ls.port, ls.csrf);
            this.instances.set(key, {
                key,
                port: ls.port,
                csrf: ls.csrf,
                pid: ls.pid,
                version: ls.version || 'unknown',
                source: ls.source || 'unknown',
                stream,
                healthy: true,
                conversationCount: 0,
            });

            console.log(`[LSPool] 已加入 LS: PID=${ls.pid} Port=${ls.port} Source=${ls.source}`);
        }

        if (this.instances.size === 0) {
            this.emit('error', new Error('All LS instances failed health check'));
            return false;
        }

        // 选主：查询每个 LS 的对话数量，选最多的
        await this._electPrimary();

        // 注册工作区
        for (const inst of this.instances.values()) {
            await this._registerWorkspace(inst);
        }

        this._startHealthCheck();
        this.emit('ls_connected', this.ls);

        console.log(`[LSPool] 初始化完成: ${this.instances.size} 个 LS 实例, Primary=${this.primaryKey}`);
        return true;
    }

    /**
     * 选主：对话数最多的 LS 为 primary
     * @private
     */
    async _electPrimary() {
        let maxCount = -1;
        let bestKey = null;

        for (const [key, inst] of this.instances) {
            try {
                const result = await grpcCall(inst.port, inst.csrf, 'GetAllCascadeTrajectories', {});
                const summaries = result.data?.trajectorySummaries || {};
                inst.conversationCount = Object.keys(summaries).length;

                if (inst.conversationCount > maxCount) {
                    maxCount = inst.conversationCount;
                    bestKey = key;
                }
            } catch {
                inst.conversationCount = 0;
            }
        }

        this.primaryKey = bestKey || [...this.instances.keys()][0];
    }

    // ========== 路由方法 ==========

    /**
     * 路由到正确的 LS 并执行 gRPC 调用
     * 策略：查路由表 → 未找到则逐个尝试 → 记录结果
     * @param {string} cascadeId
     * @param {string} method
     * @param {object} body
     * @param {number} [timeout]
     * @returns {Promise<object>}
     */
    async grpcCallRouted(cascadeId, method, body, timeout) {
        // 1. 查路由表
        const routedKey = this.routeTable.get(cascadeId);
        if (routedKey) {
            const inst = this.instances.get(routedKey);
            if (inst && inst.healthy) {
                try {
                    const result = await grpcCall(inst.port, inst.csrf, method, body, timeout);
                    if (this._hasContent(result.data)) return result;
                    // 路由的 LS 返回空数据，fall through 尝试其他
                } catch {
                    // 路由的 LS 调用失败，fall through 尝试其他
                }
            }
        }

        // 2. 逐个尝试所有健康实例，找到有意义的结果
        for (const [key, inst] of this.instances) {
            if (!inst.healthy || key === routedKey) continue;
            try {
                const result = await grpcCall(inst.port, inst.csrf, method, body, timeout);
                if (this._hasContent(result.data)) {
                    // 有数据！记录到路由表
                    this.routeTable.set(cascadeId, key);
                    return result;
                }
            } catch { continue; }
        }

        // 3. 所有都没有有效数据，用 primary 兜底
        const primary = this.instances.get(this.primaryKey);
        if (primary) {
            return await grpcCall(primary.port, primary.csrf, method, body, timeout);
        }

        throw new Error('No LS available');
    }

    /**
     * 检查 gRPC 返回数据是否有实际内容
     * @private
     * @param {object} data
     * @returns {boolean}
     */
    _hasContent(data) {
        if (!data) return false;
        // GetCascadeTrajectory: 检查 trajectory.steps 非空
        if (data.trajectory?.steps?.length > 0) return true;
        // GetAllCascadeTrajectories: 检查 summaries 非空
        if (data.trajectorySummaries && Object.keys(data.trajectorySummaries).length > 0) return true;
        // 其他方法: cascadeId 存在说明有效
        if (data.cascadeId) return true;
        return false;
    }

    /**
     * 在所有健康 LS 上并行执行 gRPC 调用
     * @param {string} method
     * @param {object} body
     * @param {number} [timeout]
     * @returns {Promise<Array<{ key: string, port: number, pid: number, data: object }>>}
     */
    async grpcCallAll(method, body, timeout) {
        const promises = [];
        for (const [key, inst] of this.instances) {
            if (!inst.healthy) continue;
            promises.push(
                grpcCall(inst.port, inst.csrf, method, body, timeout)
                    .then(result => ({ key, port: inst.port, pid: inst.pid, data: result.data }))
                    .catch(() => null)
            );
        }
        const results = await Promise.all(promises);
        return results.filter(r => r !== null);
    }

    /**
     * 在 primary LS 上执行 gRPC 调用
     * @param {string} method
     * @param {object} body
     * @param {number} [timeout]
     * @returns {Promise<object>}
     */
    async grpcCallPrimary(method, body, timeout) {
        const primary = this.instances.get(this.primaryKey);
        if (!primary) throw new Error('No primary LS');
        return await grpcCall(primary.port, primary.csrf, method, body, timeout);
    }

    /**
     * 获取指定对话应该使用的 StreamClient
     * @param {string} cascadeId
     * @returns {StreamClient|null}
     */
    getStreamForConversation(cascadeId) {
        const key = this.routeTable.get(cascadeId);
        if (key) {
            const inst = this.instances.get(key);
            if (inst?.stream) return inst.stream;
        }
        // fallback to primary
        const primary = this.instances.get(this.primaryKey);
        return primary?.stream || null;
    }

    /**
     * 更新路由表（外部可调用，如 listConversations 后）
     * @param {string} cascadeId
     * @param {string} instanceKey
     */
    setRoute(cascadeId, instanceKey) {
        this.routeTable.set(cascadeId, instanceKey);
    }

    // ========== Stream 管理 ==========

    /**
     * @private
     * @param {string} key
     * @param {number} port
     * @param {string} csrf
     * @returns {StreamClient}
     */
    _createStream(key, port, csrf) {
        const stream = new StreamClient(port, csrf);
        stream.on('change', ({ cascadeId }) => {
            if (this._onStreamChangeCb) {
                this._onStreamChangeCb(cascadeId);
            }
        });
        stream.on('error', (err) => this.emit('error', err));
        stream.on('disconnected', (cascadeId) => {
            setTimeout(() => {
                if (this._getActiveSubscriptionsCb) {
                    const active = this._getActiveSubscriptionsCb();
                    if (active.includes(cascadeId)) {
                        // 重新订阅到正确的 stream
                        const s = this.getStreamForConversation(cascadeId);
                        if (s) s.subscribe(cascadeId);
                    }
                }
            }, 2000);
        });
        return stream;
    }

    // ========== 工作区注册 ==========

    /**
     * @private
     * @param {LSInstance} inst
     */
    async _registerWorkspace(inst) {
        const homeDir = process.env.HOME || '/home/tiemuer';
        const workspaceUri = `file://${homeDir}`;
        try {
            await grpcCall(inst.port, inst.csrf, 'AddTrackedWorkspace', { workspace: homeDir });
            await grpcCall(inst.port, inst.csrf, 'SetWorkingDirectories', { directoryUris: [workspaceUri] });
            console.log(`[LSPool] Workspace registered on PID=${inst.pid}`);
        } catch (err) {
            console.warn(`[LSPool] Workspace registration failed on PID=${inst.pid}: ${err.message}`);
        }
    }

    // ========== 健康检查 ==========

    _startHealthCheck() {
        this._stopHealthCheck();
        this._healthTimer = setInterval(() => this._doHealthCheck(), HEALTH_CHECK_INTERVAL);
    }

    _stopHealthCheck() {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
    }

    async _doHealthCheck() {
        let anyHealthy = false;

        // 检查现有实例
        for (const [key, inst] of this.instances) {
            try {
                await grpcCall(inst.port, inst.csrf, 'Heartbeat', { metadata: {} }, 5000);
                if (!inst.healthy) {
                    inst.healthy = true;
                    console.log(`[LSPool] LS PID=${inst.pid} 恢复健康`);
                }
                anyHealthy = true;
            } catch {
                if (inst.healthy) {
                    inst.healthy = false;
                    console.warn(`[LSPool] LS PID=${inst.pid} 不健康`);
                }
            }
        }

        // 尝试发现新实例
        try {
            const allLS = await discoverAllLS();
            for (const ls of allLS) {
                const key = `${ls.pid}:${ls.port}`;
                if (!this.instances.has(key)) {
                    // 新 LS 实例出现！
                    const stream = this._createStream(key, ls.port, ls.csrf);
                    this.instances.set(key, {
                        key,
                        port: ls.port,
                        csrf: ls.csrf,
                        pid: ls.pid,
                        version: ls.version || 'unknown',
                        source: ls.source || 'unknown',
                        stream,
                        healthy: true,
                        conversationCount: 0,
                    });
                    await this._registerWorkspace(this.instances.get(key));
                    console.log(`[LSPool] 动态发现新 LS: PID=${ls.pid} Port=${ls.port}`);
                    anyHealthy = true;
                }
            }

            // 清理已死亡的实例
            for (const [key, inst] of this.instances) {
                const stillExists = allLS.some(ls => `${ls.pid}:${ls.port}` === key);
                if (!stillExists && !inst.healthy) {
                    inst.stream?.destroy();
                    this.instances.delete(key);
                    console.log(`[LSPool] 移除已死亡的 LS: PID=${inst.pid}`);
                }
            }
        } catch { /* discovery 失败不影响 */ }

        // 重选主（如果 primary 不健康了）
        if (this.primaryKey && !this.instances.get(this.primaryKey)?.healthy) {
            const oldPrimary = this.primaryKey;
            await this._electPrimary();
            if (this.primaryKey !== oldPrimary) {
                console.log(`[LSPool] Primary 切换: ${oldPrimary} → ${this.primaryKey}`);
            }
        }

        // 发出连接状态事件
        if (anyHealthy && this.ls) {
            this.emit('ls_reconnected', this.ls);
        } else if (!anyHealthy) {
            this.emit('ls_disconnected');
        }
    }

    // ========== 状态查询 ==========

    getStatus() {
        const primary = this.instances.get(this.primaryKey);
        return {
            connected: !!primary?.healthy,
            port: primary?.port || null,
            pid: primary?.pid || null,
            version: primary?.version || null,
            totalInstances: this.instances.size,
            healthyInstances: [...this.instances.values()].filter(i => i.healthy).length,
        };
    }

    isHealthy() {
        return [...this.instances.values()].some(i => i.healthy);
    }

    /**
     * 兼容 LSManager.refreshLS
     * @returns {Promise<boolean>}
     */
    async refreshLS() {
        await this._doHealthCheck();
        return this.isHealthy();
    }

    // ========== 销毁 ==========

    destroy() {
        this._stopHealthCheck();
        for (const inst of this.instances.values()) {
            inst.stream?.destroy();
        }
        this.instances.clear();
        this.routeTable.clear();
        this.primaryKey = null;
        this.removeAllListeners();
    }
}

/**
 * @typedef {Object} LSInstance
 * @property {string} key
 * @property {number} port
 * @property {string} csrf
 * @property {number} pid
 * @property {string} version
 * @property {string} source
 * @property {StreamClient|null} stream
 * @property {boolean} healthy
 * @property {number} conversationCount
 */

module.exports = { LSPool };
