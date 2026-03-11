/**
 * lib/core/ls/agent-stream-client.js — LS StreamAgentStateUpdates 客户端
 *
 * 替代 stream-client.js (StreamCascadeReactiveUpdates)。
 *
 * 区别:
 *   - 旧版只推 version + protobuf diff → 上层每次都要拉 GetCascadeTrajectory
 *   - 新版直接推结构化 AgentStateUpdate → 包含 step 增量、status、metadata
 *   - AI 回复文本 (plannerResponse.response) 仍然不在 stream 中，需要外部拉取
 *
 * 对外接口与 StreamClient 完全兼容:
 *   - subscribe(cascadeId) / unsubscribe(cascadeId) / isSubscribed(cascadeId)
 *   - 事件: 'change' (兼容 pool.js), 'error', 'disconnected'
 *   - 新增事件: 'update' (结构化数据)
 *   - destroy()
 *
 * 事件:
 *   'change'  → { cascadeId }                    — 兼容旧逻辑 (有任何变化就触发)
 *   'update'  → { cascadeId, data }              — 结构化更新数据
 *   'error'   → Error                            — 连接/解析错误
 *   'disconnected' → cascadeId                    — 流断开
 *
 * update.data 结构:
 *   {
 *     status:         string | null,   // 'RUNNING' | 'IDLE' | null (无变化)
 *     prevStatus:     string | null,   // 上一次的 status
 *     stepsUpdate:    { indices: number[], steps: object[], totalLength: number } | null,
 *     metadataUpdate: { indices: number[], metadatas: object[], totalLength: number } | null,
 *     needsTextFetch: boolean,         // 是否需要拉取文本 (有 GENERATING 的 PLANNER_RESPONSE)
 *   }
 *
 * 协议: Connect Streaming over HTTP/HTTPS (自动检测)
 *   - Content-Type: application/connect+json
 *   - Envelope: flags(1B) + length(4B big-endian) + JSON payload
 */

const https = require('https');
const http = require('http');
const EventEmitter = require('events');

// 复用 grpc 模块的协议缓存 (延迟加载避免循环依赖)
let _grpcModule = null;
function getGrpcModule() {
    if (!_grpcModule) {
        try { _grpcModule = require('./grpc'); } catch { /* ignore */ }
    }
    return _grpcModule;
}

const SSL_ERROR_KEYWORDS = ['EPROTO', 'ERR_SSL', 'wrong version number', 'ssl3_get_record'];
function _isSSLError(err) {
    const msg = err.message || '';
    return SSL_ERROR_KEYWORDS.some(kw => msg.includes(kw));
}

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates';
const STREAM_TIMEOUT_MS = 60000; // 60s 无数据视为僵死

/**
 * 从 CASCADE_RUN_STATUS_XXX 去掉前缀
 * @param {string} raw
 * @returns {string}
 */
function normalizeStatus(raw) {
    if (!raw) return '';
    return raw.replace('CASCADE_RUN_STATUS_', '');
}

class AgentStreamClient extends EventEmitter {
    /**
     * @param {number} port - LS 端口
     * @param {string} csrf - CSRF token
     */
    constructor(port, csrf) {
        super();
        this.port = port;
        this.csrf = csrf;
        /** @type {Map<string, import('http').ClientRequest>} cascadeId → req */
        this._streams = new Map();
        /** @type {Map<string, Buffer>} cascadeId → 未解析的 buffer */
        this._buffers = new Map();
        /** @type {Map<string, number>} cascadeId → 上次收到数据的时间戳 */
        this._lastActivity = new Map();
        /** @type {Map<string, string>} cascadeId → 上一次的 normalized status */
        this._lastStatus = new Map();
        /** @type {NodeJS.Timeout|null} */
        this._heartbeatTimer = null;
        this._startHeartbeat();
    }

    /**
     * 订阅某个对话的实时更新
     * @param {string} cascadeId
     */
    subscribe(cascadeId) {
        if (this._streams.has(cascadeId)) return;
        this._doSubscribe(cascadeId, this._chooseProtocol());
    }

    /**
     * 根据 protocolCache 选择协议
     * @private
     * @returns {'http'|'https'|null}
     */
    _chooseProtocol() {
        const grpc = getGrpcModule();
        if (grpc && grpc.getProtocolForPort) {
            return grpc.getProtocolForPort(this.port);
        }
        return null;
    }

    /**
     * 实际执行订阅
     * @private
     */
    _doSubscribe(cascadeId, protocol) {
        const payload = JSON.stringify({
            conversationId: cascadeId,
            subscriberId: `antigravity-agent-${Date.now()}`,
        });
        const payloadBuf = Buffer.from(payload, 'utf8');

        // Connect Streaming envelope: flags(1) + length(4) + data
        const envelope = Buffer.alloc(5 + payloadBuf.length);
        envelope[0] = 0x00; // flags: data frame
        envelope.writeUInt32BE(payloadBuf.length, 1);
        payloadBuf.copy(envelope, 5);

        this._buffers.set(cascadeId, Buffer.alloc(0));
        this._lastActivity.set(cascadeId, Date.now());

        const useHttps = protocol === 'https' || protocol === null;
        const mod = useHttps ? https : http;

        const req = mod.request({
            hostname: '127.0.0.1',
            port: this.port,
            path: SERVICE_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/connect+json',
                'x-codeium-csrf-token': this.csrf,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
        }, (res) => {
            if (res.statusCode !== 200) {
                this.emit('error', new Error(`AgentStream ${cascadeId}: HTTP ${res.statusCode}`));
                this._cleanup(cascadeId);
                return;
            }

            res.on('data', (chunk) => {
                this._lastActivity.set(cascadeId, Date.now());
                const buf = Buffer.concat([this._buffers.get(cascadeId) || Buffer.alloc(0), chunk]);
                this._buffers.set(cascadeId, buf);
                this._parseEnvelopes(cascadeId);
            });

            res.on('end', () => {
                this._cleanup(cascadeId);
                this.emit('disconnected', cascadeId);
            });
        });

        req.on('error', (err) => {
            // SSL 错误 + 当前是 HTTPS + 未明确指定协议 → 回退 HTTP
            if (_isSSLError(err) && useHttps && protocol === null) {
                this._cleanup(cascadeId);
                this._doSubscribe(cascadeId, 'http');
                return;
            }
            if (err.code !== 'ECONNRESET') {
                this.emit('error', new Error(`AgentStream ${cascadeId}: ${err.message}`));
            }
            this._cleanup(cascadeId);
        });

        req.write(envelope);
        req.end();

        this._streams.set(cascadeId, req);
    }

    /**
     * 取消订阅
     * @param {string} cascadeId
     */
    unsubscribe(cascadeId) {
        const req = this._streams.get(cascadeId);
        if (req) req.destroy();
        this._cleanup(cascadeId);
    }

    /**
     * 解析 Connect Streaming envelope 消息
     * @private
     */
    _parseEnvelopes(cascadeId) {
        let buf = this._buffers.get(cascadeId);
        if (!buf) return;

        while (buf.length >= 5) {
            const flags = buf[0];
            const len = buf.readUInt32BE(1);
            if (buf.length < 5 + len) break; // 数据不完整，等下一个 chunk

            const body = buf.slice(5, 5 + len);
            buf = buf.slice(5 + len);

            // flags=2 是 end-of-stream (trailer)
            if (flags === 2) continue;

            try {
                const msg = JSON.parse(body.toString('utf8'));
                this._handleUpdate(cascadeId, msg);
            } catch {
                // JSON 解析失败，忽略
            }
        }

        this._buffers.set(cascadeId, buf);
    }

    /**
     * 处理单条 AgentStateUpdate 消息
     * @private
     * @param {string} cascadeId
     * @param {object} msg - { update: AgentStateUpdate }
     */
    _handleUpdate(cascadeId, msg) {
        const update = msg.update;
        if (!update) return;

        // ── Status 变化检测 ──
        const newStatus = normalizeStatus(update.status);
        const prevStatus = this._lastStatus.get(cascadeId) || null;
        const statusChanged = newStatus && newStatus !== prevStatus;
        if (statusChanged) {
            this._lastStatus.set(cascadeId, newStatus);
        }

        // ── Steps 增量 ──
        const su = update.mainTrajectoryUpdate?.stepsUpdate;
        let stepsUpdate = null;
        if (su && su.steps && su.steps.length > 0) {
            stepsUpdate = {
                indices: su.indices || [],
                steps: su.steps,
                totalLength: su.totalLength || 0,
            };
        }

        // ── GeneratorMetadata 增量 ──
        const gmu = update.mainTrajectoryUpdate?.generatorMetadatasUpdate;
        let metadataUpdate = null;
        if (gmu && gmu.generatorMetadatas && gmu.generatorMetadatas.length > 0) {
            metadataUpdate = {
                indices: gmu.indices || [],
                metadatas: gmu.generatorMetadatas,
                totalLength: gmu.totalLength || 0,
            };
        }

        // ── 判断是否需要拉文本 ──
        // 当有 PLANNER_RESPONSE + GENERATING 时，stream 不包含文本内容，需要外部拉取
        let needsTextFetch = false;
        if (stepsUpdate) {
            for (const step of stepsUpdate.steps) {
                if (step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
                    needsTextFetch = true;
                    break;
                }
            }
        }

        // 跳过无实质内容的消息 (只有 status 没变 + 没有 step/metadata 更新)
        if (!statusChanged && !stepsUpdate && !metadataUpdate) return;

        // ── 发射事件 ──

        // 兼容事件: 'change' — pool.js 依赖此事件
        this.emit('change', { cascadeId });

        // 结构化事件: 'update' — 新逻辑可以直接消费
        this.emit('update', {
            cascadeId,
            data: {
                status: statusChanged ? newStatus : null,
                prevStatus: statusChanged ? prevStatus : null,
                stepsUpdate,
                metadataUpdate,
                needsTextFetch,
            },
        });
    }

    /**
     * 清理资源
     * @private
     */
    _cleanup(cascadeId) {
        this._streams.delete(cascadeId);
        this._buffers.delete(cascadeId);
        this._lastActivity.delete(cascadeId);
        // 保留 _lastStatus 用于重连后状态比较
    }

    /**
     * 是否已订阅
     * @param {string} cascadeId
     * @returns {boolean}
     */
    isSubscribed(cascadeId) {
        return this._streams.has(cascadeId);
    }

    // ========== 心跳检测 ==========

    /**
     * 启动心跳检测：每 15s 检查一次，超过 STREAM_TIMEOUT_MS 无数据的流视为僵死
     * @private
     */
    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            const now = Date.now();
            for (const [cascadeId, lastTime] of this._lastActivity) {
                if (now - lastTime > STREAM_TIMEOUT_MS && this._streams.has(cascadeId)) {
                    const req = this._streams.get(cascadeId);
                    if (req) req.destroy();
                    this._cleanup(cascadeId);
                    this.emit('disconnected', cascadeId);
                }
            }
        }, 15000);
    }

    /**
     * 销毁所有连接
     */
    destroy() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        for (const [, req] of this._streams) {
            req.destroy();
        }
        this._streams.clear();
        this._buffers.clear();
        this._lastStatus.clear();
        this._lastActivity.clear();
        this.removeAllListeners();
    }
}

module.exports = { AgentStreamClient };
