/**
 * stream-client.js — LS StreamCascadeReactiveUpdates 客户端
 *
 * 用 Connect Streaming 协议订阅 LS 的实时变更通知。
 * 收到变更后 emit 'change' 事件，由 Controller 决定如何处理。
 *
 * 协议: Connect Streaming over HTTP/HTTPS (自动检测)
 *   - Content-Type: application/connect+json
 *   - Envelope: flags(1B) + length(4B big-endian) + JSON payload
 */

const https = require('https');
const http = require('http');
const EventEmitter = require('events');

// 复用 ls-discovery 的协议缓存 (延迟加载避免循环依赖)
let _protocolCache = null;
function getProtocolCache() {
    if (!_protocolCache) {
        try { _protocolCache = require('./ls-discovery'); } catch { /* ignore */ }
    }
    return _protocolCache;
}

const SSL_ERROR_KEYWORDS = ['EPROTO', 'ERR_SSL', 'wrong version number', 'ssl3_get_record'];
function _isSSLError(err) {
    const msg = err.message || '';
    return SSL_ERROR_KEYWORDS.some(kw => msg.includes(kw));
}

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService/StreamCascadeReactiveUpdates';

class StreamClient extends EventEmitter {
    /**
     * @param {number} port - LS HTTPS 端口
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
        /** @type {Map<string, string>} cascadeId → 最新 version */
        this._versions = new Map();
    }

    /**
     * 订阅某个对话的实时更新
     * @param {string} cascadeId
     */
    subscribe(cascadeId) {
        if (this._streams.has(cascadeId)) return; // 已订阅
        this._doSubscribe(cascadeId, this._chooseProtocol());
    }

    /**
     * 根据 protocolCache 选择协议
     * @private
     * @returns {'http'|'https'|null} null 表示未知，需自动检测
     */
    _chooseProtocol() {
        const discovery = getProtocolCache();
        if (discovery && discovery.getProtocolForPort) {
            return discovery.getProtocolForPort(this.port);
        }
        return null;
    }

    /**
     * 实际执行订阅
     * @private
     */
    _doSubscribe(cascadeId, protocol) {
        const payload = JSON.stringify({
            protocolVersion: 1,
            id: cascadeId,
            subscriberId: `antigravity-web-${Date.now()}`,
        });
        const payloadBuf = Buffer.from(payload, 'utf8');

        // Connect Streaming envelope: flags(1) + length(4) + data
        const envelope = Buffer.alloc(5 + payloadBuf.length);
        envelope[0] = 0x00; // flags: data frame
        envelope.writeUInt32BE(payloadBuf.length, 1);
        payloadBuf.copy(envelope, 5);

        this._buffers.set(cascadeId, Buffer.alloc(0));

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
                this.emit('error', new Error(`Stream ${cascadeId}: HTTP ${res.statusCode}`));
                this._cleanup(cascadeId);
                return;
            }

            res.on('data', (chunk) => {
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
                this.emit('error', new Error(`Stream ${cascadeId}: ${err.message}`));
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
        if (req) {
            req.destroy();
        }
        this._cleanup(cascadeId);
    }

    /**
     * 解析 envelope 消息
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
                const oldVersion = this._versions.get(cascadeId);
                const newVersion = msg.version;

                if (newVersion && newVersion !== oldVersion) {
                    this._versions.set(cascadeId, newVersion);
                    // 不是第一条消息时才触发 change（第一条是初始快照）
                    if (oldVersion) {
                        this.emit('change', { cascadeId, version: newVersion });
                    } else {
                        this.emit('snapshot', { cascadeId, version: newVersion });
                    }
                }
            } catch {
                // JSON 解析失败，忽略
            }
        }

        this._buffers.set(cascadeId, buf);
    }

    /**
     * 清理资源
     * @private
     */
    _cleanup(cascadeId) {
        this._streams.delete(cascadeId);
        this._buffers.delete(cascadeId);
        // 保留 _versions 用于重连判断
    }

    /**
     * 是否已订阅
     */
    isSubscribed(cascadeId) {
        return this._streams.has(cascadeId);
    }

    /**
     * 销毁所有连接
     */
    destroy() {
        for (const [id, req] of this._streams) {
            req.destroy();
        }
        this._streams.clear();
        this._buffers.clear();
        this._versions.clear();
        this.removeAllListeners();
    }
}

module.exports = { StreamClient };
