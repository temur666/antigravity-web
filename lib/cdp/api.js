/**
 * lib/cdp/api.js — 精简后的 API 兼容层 (v1 → v2)
 *
 * 在 v2 重构后，绝大部分功能已迁移至 lib/core/*。
 * 这个文件的主要职责：
 * 1. 兼容旧的 CLI (ag.js) / lib/service.js 的调用方式。
 * 2. 保留 CDP 获取 CSRF 的降级路线（discoverAllPorts, getCredentialsFromWindow）。
 */

const { discoverLS, grpcCall } = require('../core/ls-discovery');
const { Controller } = require('../core/controller');
const { httpGet, cdpSend, cdpEval, sleep } = require('./cdp');
const WebSocket = require('ws');

// ========== 状态 (兼容旧接口) ==========

const apiState = {
    endpoints: new Map(),
    activePort: null,
    initialized: false,
};

// 后端全局 Controller（这里创建一个给老 API 使用的实例）
const legacyController = new Controller();

// ========== 代理核心 API ==========

/**
 * 初始化 API 层
 * 核心：直接使用 ls-discovery，若发现失败，再尝试 CDP
 */
async function init(options = {}) {
    if (apiState.initialized) return { success: true };

    // 1. 尝试快速发现 (daemon/process)
    const ls = discoverLS();
    if (ls) {
        apiState.endpoints.set(ls.port, ls);
        apiState.activePort = ls.port;
        apiState.initialized = true;

        // 初始化 legacy controller
        await legacyController.init();
        return { success: true };
    }

    // 2. 只有当明确不需要只扫描进程时，才回退到 CDP
    if (!options.processOnly) {
        try {
            const ports = await discoverAllPorts();
            if (ports.size > 0) {
                await acquireAllCredentials(ports);
                const firstPort = Array.from(apiState.endpoints.keys())[0];
                if (firstPort) {
                    apiState.activePort = firstPort;
                    apiState.initialized = true;
                    // 初始化 legacy controller (配置为当前找到的 CDP port和csrf)
                    legacyController.ls = apiState.endpoints.get(firstPort);
                    return { success: true };
                }
            }
        } catch { /* 忽略 CDP 错误 */ }
    }

    return { success: false, error: 'Could not discover LS API or CSRF' };
}

function getStatus() {
    return {
        initialized: apiState.initialized,
        activePort: apiState.activePort,
        endpoints: Array.from(apiState.endpoints.values()).map(e => ({
            port: e.port,
            pid: e.pid,
            hasCsrf: !!e.csrf,
            windowTitle: e.windowTitle || e.source || 'unknown'
        }))
    };
}

async function startCascade(options = {}) {
    try {
        const id = await legacyController.newChat();
        if (!id) throw new Error('Failed to create cascade');
        return { cascadeId: id };
    } catch (e) {
        return { error: e.message };
    }
}

async function sendMessage(cascadeId, text, options = {}) {
    try {
        await legacyController.sendMessage(cascadeId, text, options);
        return { success: true };
    } catch (e) {
        throw e;
    }
}

async function getTrajectory(cascadeId, options = {}) {
    const port = options.port || apiState.activePort;
    const ep = apiState.endpoints.get(Number(port));
    if (!ep) throw new Error(`Endpoint not found for port: ${port}`);

    const res = await grpcCall(ep.port, ep.csrf, 'GetCascadeTrajectory', { cascadeId });
    if (res.status !== 200) throw new Error(`GetTrajectory failed: ${res.status}`);
    return res.data;
}

// ========== 其余高级函数包裹 ==========

async function sendAndWait(cascadeId, text, options = {}) {
    // 复用 Controller 订阅逻辑进行等待
    await legacyController.sendMessage(cascadeId, text, options);

    // 手动轮询直到 IDLE (兼容老行为，这里可以换成 subscribe)
    const maxRetries = (options.timeoutMs || 300000) / 1000;
    for (let i = 0; i < maxRetries; i++) {
        const t = await legacyController.getTrajectory(cascadeId);
        if (options.onUpdate && t?.trajectory) options.onUpdate(t.trajectory);
        if (t && t.status === 'CASCADE_RUN_STATUS_IDLE') {
            return t.trajectory;
        }
        await sleep(1000);
    }
    throw new Error('Timeout waiting for response');
}

async function newChatAndSend(text, options = {}) {
    const { cascadeId } = await startCascade(options);
    if (!cascadeId) throw new Error('Start cascade failed');
    const trajectory = await sendAndWait(cascadeId, text, options);
    return { cascadeId, trajectory };
}

// ========== 原有的 CDP CSRF 获取功能 (降级用) ==========

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT || '9000');

async function discoverAllPorts() {
    const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
    const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    const ports = new Map();

    for (const page of pages) {
        try {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); setTimeout(() => j(new Error('timeout')), 2000); });

            const exp = `(() => {
                const reqs = performance.getEntriesByType('resource');
                const grpc = reqs.find(r => r.name.includes('/exa.language_server_pb.LanguageServerService/'));
                if (grpc) {
                    const url = new URL(grpc.name);
                    return url.port;
                }
                return null;
            })()`;

            const port = await cdpEval(ws, exp);
            ws.close();

            if (port) ports.set(port, page.title);
        } catch { }
    }
    return ports; // port → title
}

async function acquireAllCredentials(portsMap) {
    for (const [port, title] of portsMap.entries()) {
        try {
            const info = await getCredentialsFromWindow(title);
            if (info && info.csrf) {
                apiState.endpoints.set(Number(port), {
                    port: Number(port),
                    csrf: info.csrf,
                    windowTitle: title
                });
            }
        } catch { }
    }
}

async function getCredentialsFromWindow(windowTitle, timeoutMs = 20000) {
    const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
    const matches = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && t.title.includes(windowTitle));
    if (matches.length === 0) return null;

    const ws = new WebSocket(matches[0].webSocketDebuggerUrl);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
        let currentAuth = null;

        const handleMsg = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.method === 'Network.requestWillBeSent') {
                const req = msg.params.request;
                if (req.url.includes('/Heartbeat')) {
                    if (req.headers['x-codeium-csrf-token']) {
                        currentAuth = req.headers['x-codeium-csrf-token'];
                        cleanup();
                        resolve({ csrf: currentAuth });
                    }
                }
            }
        };

        const cleanup = () => { clearTimeout(timeout); ws.off('message', handleMsg); ws.close(); };

        ws.on('open', async () => {
            ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
            ws.on('message', handleMsg);
        });
        ws.on('error', () => { cleanup(); resolve(null); });
    });
}

function postAPI() {
    throw new Error('postAPI is deprecated, use ls-discovery.grpcCall directly');
}

module.exports = {
    init,
    getStatus,
    startCascade,
    sendMessage,
    getTrajectory,
    sendAndWait,
    newChatAndSend,

    // 降级 CDP 方法
    discoverAllPorts,
    acquireAllCredentials,
    getCredentialsFromWindow,

    postAPI,
    SERVICE_PATH: '/exa.language_server_pb.LanguageServerService',
    state: apiState,
};
