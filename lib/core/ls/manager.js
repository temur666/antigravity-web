/**
 * lib/core/ls/manager.js — LS 连接生命周期管理
 *
 * 职责:
 *   1. init: 发现 LS + 创建 AgentStreamClient
 *   2. refreshLS: 重连 + 重建 AgentStreamClient
 *   3. 健康检查: 30s 心跳 + 断线重连
 *   4. 工作区注册: AddTrackedWorkspace + SetWorkingDirectories
 *   5. destroy: 清理所有资源
 *
 * 设计:
 *   LSManager 继承 EventEmitter，发出以下事件:
 *     - ls_connected(ls)
 *     - ls_disconnected()
 *     - ls_reconnected(ls)
 *     - ls_changed({ old, new })
 *     - error(err)
 */

const EventEmitter = require('events');
const { discoverLSAsync } = require('./discovery');
const { grpcCall } = require('./grpc');
const { AgentStreamClient } = require('./agent-stream-client');
const { fullHealthCheck } = require('./health-check');

const HEALTH_CHECK_INTERVAL = 30000; // 30s 心跳检查

class LSManager extends EventEmitter {
    constructor() {
        super();
        /** @type {{ port: number, csrf: string, pid: number, version: string } | null} */
        this.ls = null;
        /** @type {AgentStreamClient|null} */
        this._streamClient = null;
        /** @type {NodeJS.Timeout|null} */
        this._healthTimer = null;
        /** @type {boolean} */
        this._lsHealthy = false;
        /** @type {Function|null} 外部注册的 stream change 回调 */
        this._onStreamChangeCb = null;
        /** @type {Function|null} 外部注册的 stream update 回调 */
        this._onStreamUpdateCb = null;
        /** @type {Function|null} 外部注册的获取活跃订阅回调 */
        this._getActiveSubscriptionsCb = null;
    }

    /**
     * 注册 stream change 回调（由 ConversationSync 设置）
     * @param {Function} cb - (cascadeId: string) => void
     */
    onStreamChange(cb) {
        this._onStreamChangeCb = cb;
    }

    /**
     * 注册 stream update 回调（结构化数据，由 ConversationSync 设置）
     * @param {Function} cb - ({ cascadeId, data }) => void
     */
    onStreamUpdate(cb) {
        this._onStreamUpdateCb = cb;
    }

    /**
     * 注册获取活跃订阅回调（refreshLS 时用于重新订阅）
     * @param {Function} cb - () => string[] (返回需要重新订阅的 cascadeId 列表)
     */
    onGetActiveSubscriptions(cb) {
        this._getActiveSubscriptionsCb = cb;
    }

    /**
     * 获取 AgentStreamClient 实例（供订阅管理使用）
     * @returns {AgentStreamClient|null}
     */
    getStreamClient() {
        return this._streamClient;
    }

    /**
     * 初始化: 发现 LS + 健康检查 + 创建 AgentStreamClient + 启动心跳
     * @returns {Promise<boolean>}
     */
    async init() {
        this.ls = await discoverLSAsync();
        if (!this.ls) {
            this.emit('error', new Error('LS not found'));
            return false;
        }

        // 版本校验 + 业务冒烟测试
        const health = await fullHealthCheck(this.ls);
        if (!health.ok) {
            const reason = health.version?.error || health.smoke?.error || 'Health check failed';
            this.emit('error', new Error(`LS health check failed: ${reason}`));
            this.ls = null;
            return false;
        }

        this._createStreamClient();
        this._lsHealthy = true;
        this._startHealthCheck();

        await this._registerWorkspace();

        this.emit('ls_connected', this.ls);
        return true;
    }

    /**
     * 刷新 LS 连接 (重新发现 + 重建 AgentStreamClient + 重新订阅)
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
            // 重建 AgentStreamClient
            if (this._streamClient) {
                this._streamClient.destroy();
            }
            this._createStreamClient();

            // 重新订阅所有活跃对话
            if (this._getActiveSubscriptionsCb) {
                const cascadeIds = this._getActiveSubscriptionsCb();
                for (const cascadeId of cascadeIds) {
                    this._streamClient.subscribe(cascadeId);
                }
            }

            this.emit('ls_changed', { old: oldLs, new: this.ls });

            // LS 切换后重新注册工作区
            await this._registerWorkspace();
        }

        if (!this._lsHealthy) {
            this._lsHealthy = true;
            this.emit('ls_reconnected', this.ls);
        }

        return true;
    }

    /**
     * 创建并绑定 AgentStreamClient
     * @private
     */
    _createStreamClient() {
        this._streamClient = new AgentStreamClient(this.ls.port, this.ls.csrf);
        this._streamClient.on('change', ({ cascadeId }) => {
            if (this._onStreamChangeCb) {
                this._onStreamChangeCb(cascadeId);
            }
        });
        this._streamClient.on('update', (payload) => {
            if (this._onStreamUpdateCb) {
                this._onStreamUpdateCb(payload);
            }
        });
        this._streamClient.on('error', (err) => this.emit('error', err));
        this._streamClient.on('disconnected', (cascadeId) => {
            // 流断开后尝试重连
            setTimeout(() => {
                if (this._getActiveSubscriptionsCb) {
                    const active = this._getActiveSubscriptionsCb();
                    if (active.includes(cascadeId)) {
                        this._streamClient?.subscribe(cascadeId);
                    }
                }
            }, 2000);
        });
    }

    // ========== 工作区注册 ==========

    /**
     * 向 LS 注册工作区目录
     * @private
     */
    async _registerWorkspace() {
        if (!this.ls) return;

        const homeDir = process.env.HOME || '/home/tiemuer';
        const workspaceUri = `file://${homeDir}`;

        try {
            await grpcCall(this.ls.port, this.ls.csrf, 'AddTrackedWorkspace', {
                workspace: homeDir,
            });
            await grpcCall(this.ls.port, this.ls.csrf, 'SetWorkingDirectories', {
                directoryUris: [workspaceUri],
            });
            console.log(`[LSManager] Workspace registered: ${homeDir}`);
        } catch (err) {
            console.warn(`[LSManager] Workspace registration failed (non-fatal): ${err.message}`);
        }
    }

    // ========== 健康检查 ==========

    /** @private */
    _startHealthCheck() {
        this._stopHealthCheck();
        this._healthTimer = setInterval(() => this._doHealthCheck(), HEALTH_CHECK_INTERVAL);
    }

    /** @private */
    _stopHealthCheck() {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
    }

    /** @private */
    async _doHealthCheck() {
        if (!this.ls) {
            await this.refreshLS();
            return;
        }

        try {
            await grpcCall(this.ls.port, this.ls.csrf, 'Heartbeat', { metadata: {} });
            if (!this._lsHealthy) {
                this._lsHealthy = true;
                this.emit('ls_reconnected', this.ls);
            }
        } catch {
            console.warn('[!] 健康检查失败，尝试重新发现 LS...');
            if (this._lsHealthy) {
                this._lsHealthy = false;
                this.emit('ls_disconnected');
            }
            this.ls = null;
            await this.refreshLS();
        }
    }

    // ========== 状态查询 ==========

    /**
     * @returns {{ connected: boolean, port: number|null, pid: number|null, version: string|null }}
     */
    getStatus() {
        return {
            connected: !!this.ls,
            port: this.ls?.port || null,
            pid: this.ls?.pid || null,
            version: this.ls?.version || null,
        };
    }

    /** @returns {boolean} */
    isHealthy() {
        return this._lsHealthy;
    }

    // ========== 销毁 ==========

    destroy() {
        this._stopHealthCheck();
        if (this._streamClient) {
            this._streamClient.destroy();
            this._streamClient = null;
        }
        this.ls = null;
        this._lsHealthy = false;
        this.removeAllListeners();
    }
}

module.exports = { LSManager };
