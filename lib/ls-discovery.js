/**
 * lib/ls-discovery.js — LS 发现层 (仅 Discovery File)
 *
 * 从 ~/.gemini/antigravity/daemon/ls_*.json 读取 LS 连接信息。
 * 验证 PID 存活后返回 { port, csrf, pid, version }。
 *
 * 同时提供 grpcCall 函数，封装对 LS gRPC API 的 HTTPS 调用。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';

const DEFAULT_DAEMON_DIR = path.join(
    process.env.HOME || '/home/tiemuer',
    '.gemini', 'antigravity', 'daemon',
);

// ========== Discovery File 解析 ==========

/**
 * 解析 discovery file 的 JSON 内容
 * @param {string} jsonStr - JSON 字符串
 * @returns {{ port: number, csrf: string, pid: number, version: string, httpPort: number, lspPort: number } | null}
 */
function parseDiscoveryFile(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        const { pid, httpsPort, httpPort, lspPort, lsVersion, csrfToken } = data;

        if (!pid || !httpsPort || !csrfToken) return null;

        return {
            pid,
            port: httpsPort,
            csrf: csrfToken,
            version: lsVersion || 'unknown',
            httpPort: httpPort || 0,
            lspPort: lspPort || 0,
        };
    } catch {
        return null;
    }
}

/**
 * 检查进程是否存活
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * 从进程参数发现 LS（fallback）
 * @returns {{ port: number, csrf: string, pid: number, version: string, source: string } | null}
 */
function discoverFromProcess() {
    try {
        const { execSync } = require('child_process');

        // 找到 language_server 进程并提取 CSRF
        const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
        const lsLine = psOutput.split('\n')
            .filter(l => l.includes('language_server') && !l.includes('grep') && !l.includes('standalone'))
            .pop();

        if (!lsLine) return null;

        const pid = parseInt(lsLine.trim().split(/\s+/)[1]);
        const csrfMatch = lsLine.match(/--csrf_token\s+([a-f0-9-]+)/);
        if (!csrfMatch) return null;
        const csrf = csrfMatch[1];

        // 通过 ss 找 fd=9 对应的端口 (gRPC 端口的规律)
        let port = null;
        try {
            const ssOutput = execSync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`, { encoding: 'utf-8', timeout: 5000 });
            // 优先尝试 fd=9
            const fd9Match = ssOutput.match(new RegExp(`127\\.0\\.0\\.1:(\\d+).*pid=${pid},fd=9\\)`));
            if (fd9Match) {
                port = parseInt(fd9Match[1]);
            } else {
                // fallback: 取第一个端口
                const portMatches = [...ssOutput.matchAll(/127\.0\.0\.1:(\d+)/g)].map(m => parseInt(m[1]));
                if (portMatches.length > 0) port = portMatches[0];
            }
        } catch { /* ss failed */ }

        if (!port) return null;

        return { port, csrf, pid, version: 'unknown', httpPort: 0, lspPort: 0, source: 'process' };
    } catch {
        return null;
    }
}

/**
 * 从 daemon 目录发现 LS，fallback 到进程参数
 * @param {string} [daemonDir] - daemon 目录路径 (默认 ~/.gemini/antigravity/daemon)
 * @returns {{ port: number, csrf: string, pid: number, version: string, httpPort: number, lspPort: number, source: string } | null}
 */
function discoverLS(daemonDir = DEFAULT_DAEMON_DIR) {
    // 方式 1: Discovery file
    let files;
    try {
        files = fs.readdirSync(daemonDir).filter(f => f.startsWith('ls_') && f.endsWith('.json'));
    } catch {
        files = [];
    }

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(daemonDir, file), 'utf-8');
            const info = parseDiscoveryFile(content);
            if (!info) continue;

            if (!isPidAlive(info.pid)) continue;

            return { ...info, source: file };
        } catch {
            continue;
        }
    }

    // 方式 2: Fallback — 从进程参数提取
    return discoverFromProcess();
}

// ========== gRPC 调用 ==========

/**
 * 调用 LS 的 gRPC API
 * @param {number} port - HTTPS 端口
 * @param {string} csrf - CSRF token
 * @param {string} method - API 方法名 (如 'Heartbeat', 'StartCascade')
 * @param {object} body - 请求体
 * @param {number} [timeoutMs=30000] - 超时
 * @returns {Promise<{ status: number, data: object }>}
 */
function grpcCall(port, csrf, method, body, timeoutMs = 30000) {
    if (!port) return Promise.reject(new Error('Missing port'));
    if (!csrf) return Promise.reject(new Error('Missing csrf'));

    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body || {});
        const req = https.request({
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

module.exports = {
    parseDiscoveryFile,
    isPidAlive,
    discoverLS,
    grpcCall,
    DEFAULT_DAEMON_DIR,
    SERVICE_PATH,
};
