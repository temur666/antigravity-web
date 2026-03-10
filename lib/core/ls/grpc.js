/**
 * lib/core/ls/grpc.js — LS gRPC 传输层
 *
 * 封装对 LS gRPC API 的 HTTP/HTTPS 调用。
 * 自动检测协议并按端口缓存结果。
 */

const https = require('https');
const http = require('http');

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';

/** 协议缓存: port → 'http' | 'https' */
const protocolCache = new Map();

/** SSL 相关错误关键词 */
const SSL_ERROR_KEYWORDS = ['EPROTO', 'ERR_SSL', 'wrong version number', 'ssl3_get_record'];

function _isSSLError(err) {
    const msg = err.message || '';
    return SSL_ERROR_KEYWORDS.some(kw => msg.includes(kw));
}

/**
 * 发送单次 HTTP/HTTPS 请求
 * @private
 */
function _makeRequest(useHttps, port, csrf, method, body, timeoutMs) {
    const mod = useHttps ? https : http;
    const data = JSON.stringify(body || {});

    return new Promise((resolve, reject) => {
        const req = mod.request({
            hostname: '127.0.0.1',
            port: Number(port),
            path: `${SERVICE_PATH}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-codeium-csrf-token': csrf,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(d) });
                } catch {
                    resolve({ status: res.statusCode, data: d });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(data);
        req.end();
    });
}

/**
 * 调用 LS 的 gRPC API（自动检测 HTTPS/HTTP 协议，并按端口缓存结果）
 * @param {number} port - LS 端口
 * @param {string} csrf - CSRF token
 * @param {string} method - API 方法名 (如 'Heartbeat', 'StartCascade')
 * @param {object} body - 请求体
 * @param {number} [timeoutMs=30000] - 超时
 * @returns {Promise<{ status: number, data: object }>}
 */
async function grpcCall(port, csrf, method, body, timeoutMs = 30000) {
    if (!port) throw new Error('Missing port');
    if (!csrf) throw new Error('Missing csrf');

    const cached = protocolCache.get(port);
    if (cached) {
        return _makeRequest(cached === 'https', port, csrf, method, body, timeoutMs);
    }

    // 未缓存: HTTPS 优先 → SSL 错误时回退 HTTP
    try {
        const result = await _makeRequest(true, port, csrf, method, body, timeoutMs);
        protocolCache.set(port, 'https');
        return result;
    } catch (err) {
        if (!_isSSLError(err)) throw err;

        // SSL 错误 → 回退 HTTP
        const result = await _makeRequest(false, port, csrf, method, body, timeoutMs);
        protocolCache.set(port, 'http');
        return result;
    }
}

/**
 * 清除协议缓存（LS 重连时可调用）
 */
function clearProtocolCache() {
    protocolCache.clear();
}

/**
 * 查询某端口已缓存的协议
 * @param {number} port
 * @returns {'http'|'https'|null}
 */
function getProtocolForPort(port) {
    return protocolCache.get(port) || null;
}

module.exports = {
    grpcCall,
    clearProtocolCache,
    getProtocolForPort,
    SERVICE_PATH,
};
