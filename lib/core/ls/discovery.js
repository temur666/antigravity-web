/**
 * lib/core/ls/discovery.js — LS 发现层
 *
 * 从 ~/.gemini/antigravity/daemon/ls_*.json 读取 LS 连接信息。
 * 验证 PID 存活后返回 { port, csrf, pid, version }。
 *
 * 发现优先级:
 *   同步: Discovery File → 进程 fallback
 *   异步: Discovery File + Heartbeat → 进程端口逐个 Heartbeat 探测
 */

const fs = require('fs');
const path = require('path');

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
 * 多进程时优先选有 --server_port 的，否则取 PID 最大的（最新启动）
 * @returns {{ port: number, csrf: string, pid: number, version: string, source: string } | null}
 */
function discoverFromProcess() {
    try {
        const { execSync } = require('child_process');

        const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
        const lsLines = psOutput.split('\n')
            .filter(l => l.includes('language_server') && !l.includes('grep') && !l.includes('standalone'));

        if (lsLines.length === 0) return null;

        // 解析所有候选进程
        const candidates = [];
        for (const line of lsLines) {
            const pid = parseInt(line.trim().split(/\s+/)[1]);
            const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/);
            if (!csrfMatch) continue;

            const serverPortMatch = line.match(/--server_port\s+(\d+)/);
            candidates.push({
                pid,
                csrf: csrfMatch[1],
                hasServerPort: !!serverPortMatch,
                serverPort: serverPortMatch ? parseInt(serverPortMatch[1]) : null,
            });
        }

        if (candidates.length === 0) return null;

        // 优先选有 --server_port 的，否则取 PID 最大的
        candidates.sort((a, b) => {
            if (a.hasServerPort !== b.hasServerPort) return a.hasServerPort ? -1 : 1;
            return b.pid - a.pid; // PID 大的优先
        });

        const best = candidates[0];

        // 确定 HTTPS 端口: 优先用 --server_port，否则通过 ss 查 fd=9
        let port = best.serverPort;
        if (!port) {
            try {
                const ssOutput = execSync(`ss -tlnp 2>/dev/null | grep "pid=${best.pid}"`, { encoding: 'utf-8', timeout: 5000 });
                const fd9Match = ssOutput.match(new RegExp(`127\\.0\\.0\\.1:(\\d+).*pid=${best.pid},fd=9\\)`));
                if (fd9Match) {
                    port = parseInt(fd9Match[1]);
                } else {
                    const portMatches = [...ssOutput.matchAll(/127\.0\.0\.1:(\d+)/g)].map(m => parseInt(m[1]));
                    if (portMatches.length > 0) port = portMatches[0];
                }
            } catch { /* ss failed */ }
        }

        if (!port) return null;

        return { port, csrf: best.csrf, pid: best.pid, version: 'unknown', httpPort: 0, lspPort: 0, source: 'process', protocol: 'auto' };
    } catch {
        return null;
    }
}

/**
 * 获取 LS 进程的所有候选端口（供异步 Heartbeat 验证用）
 * @returns {Array<{ pid: number, csrf: string, ports: number[] }> | null}
 */
function discoverProcessCandidates() {
    try {
        const { execSync } = require('child_process');

        const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
        const lsLines = psOutput.split('\n')
            .filter(l => l.includes('language_server') && !l.includes('grep') && !l.includes('standalone'));

        if (lsLines.length === 0) return null;

        const candidates = [];
        for (const line of lsLines) {
            const pid = parseInt(line.trim().split(/\s+/)[1]);
            const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/);
            if (!csrfMatch) continue;
            if (!isPidAlive(pid)) continue;

            // 获取该进程的所有 127.0.0.1 监听端口
            let ports = [];
            try {
                const ssOutput = execSync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`, { encoding: 'utf-8', timeout: 5000 });
                ports = [...ssOutput.matchAll(/127\.0\.0\.1:(\d+)/g)].map(m => parseInt(m[1]));
            } catch { /* ss failed */ }

            if (ports.length > 0) {
                candidates.push({ pid, csrf: csrfMatch[1], ports });
            }
        }

        // PID 大的（最新启动的）优先
        candidates.sort((a, b) => b.pid - a.pid);

        return candidates.length > 0 ? candidates : null;
    } catch {
        return null;
    }
}

/**
 * 异步发现 LS（带 Heartbeat 验证）
 * 优先级: Discovery File (+ Heartbeat 验证) -> 进程端口逐个 Heartbeat 探测
 * @param {string} [daemonDir]
 * @returns {Promise<{ port, csrf, pid, version, source, protocol } | null>}
 */
async function discoverLSAsync(daemonDir = DEFAULT_DAEMON_DIR) {
    // 延迟加载 grpc 模块避免循环依赖
    const { grpcCall } = require('./grpc');

    // 方式 1: Discovery file + Heartbeat 验证
    const fileResult = discoverLS(daemonDir);
    if (fileResult) {
        try {
            await grpcCall(fileResult.port, fileResult.csrf, 'Heartbeat', { metadata: {} }, 3000);
            return fileResult;
        } catch {
            console.warn('[!] Discovery file 中的 LS 连接无效，尝试进程发现...');
        }
    }

    // 方式 2: 进程发现 + 逐端口 Heartbeat 探测
    const candidates = discoverProcessCandidates();
    if (!candidates) return null;

    for (const candidate of candidates) {
        for (const port of candidate.ports) {
            try {
                await grpcCall(port, candidate.csrf, 'Heartbeat', { metadata: {} }, 3000);
                console.log(`[+] 探测到 LS: PID=${candidate.pid} Port=${port}`);
                return {
                    port,
                    csrf: candidate.csrf,
                    pid: candidate.pid,
                    version: 'unknown',
                    httpPort: 0,
                    lspPort: 0,
                    source: 'process-heartbeat',
                    protocol: 'auto',
                };
            } catch {
                continue;
            }
        }
    }

    return null;
}

/**
 * 从 daemon 目录发现 LS，fallback 到进程参数（同步版本，返回单个实例）
 * @param {string} [daemonDir] - daemon 目录路径 (默认 ~/.gemini/antigravity/daemon)
 * @returns {{ port: number, csrf: string, pid: number, version: string, httpPort: number, lspPort: number, source: string } | null}
 */
function discoverLS(daemonDir = DEFAULT_DAEMON_DIR) {
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
            return { ...info, source: file, protocol: 'https' };
        } catch { continue; }
    }

    return discoverFromProcess();
}

/**
 * 发现所有活跃的 LS 实例（带 Heartbeat 验证）
 * 同时扫描 daemon 目录和进程列表，去重后返回所有可用实例
 * @param {string} [daemonDir]
 * @returns {Promise<Array<{ port: number, csrf: string, pid: number, version: string, source: string }>>}
 */
async function discoverAllLS(daemonDir = DEFAULT_DAEMON_DIR) {
    const { grpcCall } = require('./grpc');
    const found = new Map(); // key: "pid:port" → instance

    // 方式 1: Discovery files
    let files = [];
    try {
        files = fs.readdirSync(daemonDir).filter(f => f.startsWith('ls_') && f.endsWith('.json'));
    } catch { /* 目录不存在 */ }

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(daemonDir, file), 'utf-8');
            const info = parseDiscoveryFile(content);
            if (!info || !isPidAlive(info.pid)) continue;

            const key = `${info.pid}:${info.port}`;
            if (!found.has(key)) {
                try {
                    await grpcCall(info.port, info.csrf, 'Heartbeat', { metadata: {} }, 3000);
                    found.set(key, { ...info, source: file, protocol: 'https' });
                } catch { /* heartbeat 失败，跳过 */ }
            }
        } catch { continue; }
    }

    // 方式 2: 进程发现
    const candidates = discoverProcessCandidates();
    if (candidates) {
        for (const candidate of candidates) {
            for (const port of candidate.ports) {
                const key = `${candidate.pid}:${port}`;
                if (found.has(key)) continue; // 已通过 discovery file 找到
                try {
                    await grpcCall(port, candidate.csrf, 'Heartbeat', { metadata: {} }, 3000);
                    found.set(key, {
                        port,
                        csrf: candidate.csrf,
                        pid: candidate.pid,
                        version: 'unknown',
                        httpPort: 0,
                        lspPort: 0,
                        source: 'process-heartbeat',
                        protocol: 'auto',
                    });
                    break; // 每个 PID 找到一个可用端口即可
                } catch { continue; }
            }
        }
    }

    return [...found.values()];
}

module.exports = {
    parseDiscoveryFile,
    isPidAlive,
    discoverLS,
    discoverLSAsync,
    discoverAllLS,
    discoverProcessCandidates,
    DEFAULT_DAEMON_DIR,
};
