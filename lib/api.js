/**
 * lib/api.js — Antigravity gRPC API 通信层
 *
 * 通过本地 Language Server 的 ConnectRPC 接口，
 * 实现对话创建、消息发送、历史读取等功能。
 *
 * 架构:
 *   你的代码 → api.js → 本地 Language Server (127.0.0.1:{port}) → Google 云端 AI
 *
 * 认证 (CSRF Token 获取方式，按优先级):
 *   1. 进程命令行: 从 language_server 进程的 --csrf_token 参数直接提取 (最可靠)
 *   2. CDP 拦截: 从 IDE 网络请求中拦截 x-codeium-csrf-token header (需要 CDP)
 *
 * 端口发现 (按优先级):
 *   1. 进程命令行: 从进程 PID → netstat 发现监听端口 → 逐个验证 gRPC
 *   2. CDP: 从各窗口 performance.getEntriesByType('resource') 获取
 *
 * 使用示例:
 *   const api = require('./lib/api');
 *   await api.init();  // 自动发现端口 + 获取 CSRF (优先用进程方式)
 *   const { cascadeId } = await api.startCascade();
 *   await api.sendMessage(cascadeId, '你好');
 *   const traj = await api.getTrajectory(cascadeId);
 */

const https = require('https');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const { httpGet, cdpSend, cdpEval, sleep } = require('./cdp');

// 注意: TLS 验证在 postAPI 的 rejectUnauthorized: false 中按请求禁用
// 不使用全局 NODE_TLS_REJECT_UNAUTHORIZED 以避免影响其他模块

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT || '9000');

// ========== 状态 ==========

const apiState = {
    /** @type {Map<string, { port: string, csrf: string, metadata: object|null, windowTitle: string }>} */
    endpoints: new Map(),  // port → endpoint info
    /** @type {string|null} 当前活跃的端口 */
    activePort: null,
    /** @type {boolean} */
    initialized: false,
};

// ========== HTTP 通信 ==========

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';

/**
 * 发送 POST 请求到 gRPC API (非流式)
 */
function postAPI(port, method, body, csrf) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
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
            timeout: 30000,
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

// ========== 进程级发现 (最可靠) ==========

/**
 * 进程名映射 (按平台)
 */
const LS_PROCESS_NAMES = {
    win32: 'language_server_windows_x64.exe',
    darwin: 'language_server_macos',
    linux: 'language_server_linux',
};

/**
 * 从 language_server 进程的命令行参数中直接提取 CSRF token
 * 然后通过 netstat 找到该进程实际监听的所有端口
 * 最后逐个测试找到 gRPC Connect 端口
 * @returns {Array<{ pid: number, port: string, csrf: string, allPorts: string[] }>}
 */
function discoverFromProcess() {
    const platform = process.platform;
    const processName = LS_PROCESS_NAMES[platform];
    if (!processName) {
        console.log(`⚠️ 不支持的平台: ${platform}`);
        return [];
    }

    // 第一步：获取进程命令行 → CSRF token + PID
    let cmdOutput;
    try {
        if (platform === 'win32') {
            // 用 WMIC 获取进程信息（比 PowerShell 引号嵌套更简单）
            cmdOutput = execSync(
                `wmic process where "name='${processName}'" get ProcessId,CommandLine /format:list`,
                { encoding: 'utf-8', timeout: 10000, windowsHide: true }
            );
        } else {
            // macOS / Linux
            cmdOutput = execSync(
                `ps aux | grep '${processName}' | grep -v grep`,
                { encoding: 'utf-8', timeout: 5000 }
            );
        }
    } catch {
        return []; // 进程不存在
    }

    const processInfos = [];

    if (platform === 'win32') {
        // WMIC /format:list 输出格式: CommandLine=xxx\r\nProcessId=xxx\r\n\r\n (每个进程用空行分隔)
        const blocks = cmdOutput.split(/\n\s*\n/).filter(b => b.trim());
        for (const block of blocks) {
            const cmdMatch = block.match(/CommandLine=(.+)/);
            const pidMatch = block.match(/ProcessId=(\d+)/);
            const cmd = cmdMatch ? cmdMatch[1].trim() : '';
            const pid = pidMatch ? parseInt(pidMatch[1]) : 0;

            const csrfMatch = cmd.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
            if (pid && csrfMatch) {
                processInfos.push({ pid, csrf: csrfMatch[1] });
            }
        }
    } else {
        // macOS / Linux: 每行一个进程
        for (const line of cmdOutput.split('\n')) {
            if (!line.trim()) continue;
            const csrfMatch = line.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
            const pidMatch = line.match(/^\S+\s+(\d+)/);
            if (csrfMatch && pidMatch) {
                processInfos.push({ pid: parseInt(pidMatch[1]), csrf: csrfMatch[1] });
            }
        }
    }

    if (processInfos.length === 0) return [];

    // 第二步：用 netstat 找到每个进程监听的所有端口
    const results = [];
    for (const info of processInfos) {
        let ports = [];
        try {
            if (platform === 'win32') {
                const netstatOutput = execSync(
                    `netstat -ano | findstr "LISTENING"`,
                    { encoding: 'utf-8', timeout: 5000, windowsHide: true }
                );
                for (const line of netstatOutput.split('\n')) {
                    // 精确匹配 PID（netstat 最后一列是 PID，避免子串误匹配）
                    const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
                    if (m && m[2] === String(info.pid)) ports.push(m[1]);
                }
            } else {
                const lsofOutput = execSync(
                    `lsof -i -P -n -p ${info.pid} | grep LISTEN`,
                    { encoding: 'utf-8', timeout: 5000 }
                );
                for (const line of lsofOutput.split('\n')) {
                    const m = line.match(/:(\d+)\s+\(LISTEN\)/);
                    if (m) ports.push(m[1]);
                }
            }
        } catch {
            // netstat 失败时没有端口信息
        }

        // 去重
        ports = [...new Set(ports)];
        results.push({ pid: info.pid, csrf: info.csrf, allPorts: ports, port: null });
    }

    return results;
}

/**
 * SSH 远程 LS 配置
 * 可通过环境变量覆盖
 */
const SSH_CONFIG = {
    host: process.env.SSH_HOST || 'gcp-iap',
    remotePath: process.env.SSH_PATH || '/home/tiemuer',
    timeout: 30000,
};

/**
 * 从 SSH 远程主机的 language_server 进程中提取 CSRF token
 * 然后扫描本地端口转发，找到能响应该 CSRF 的 gRPC 端口
 * 
 * 链路: ssh → 远程 ps aux → CSRF → 本地端口扫描 → gRPC 验证
 * 
 * @param {object} [options]
 * @param {string} [options.host] - SSH 主机名
 * @returns {Array<{ pid: number, csrf: string, allPorts: string[], source: string }>}
 */
function discoverFromSSH(options = {}) {
    const host = options.host || SSH_CONFIG.host;

    // 第一步: SSH 获取远程 LS 进程的 CSRF
    let remoteOutput;
    try {
        remoteOutput = execSync(
            `ssh -T ${host} "ps aux | grep language_server | grep -v grep" 2>nul`,
            { encoding: 'utf-8', timeout: SSH_CONFIG.timeout, windowsHide: true }
        );
    } catch (e) {
        // SSH 可能在 stderr 输出警告，stdout 可能有有效数据
        remoteOutput = (e.stdout || '') + '\n' + (e.stderr || '');
    }

    const remoteCSRFs = [];
    for (const line of remoteOutput.split('\n')) {
        const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/i);
        const pidMatch = line.match(/(\d+)\s+[\d.]+\s+[\d.]+/); // ps aux 格式
        if (csrfMatch) {
            const pid = pidMatch ? parseInt(pidMatch[1]) : 0;
            remoteCSRFs.push({ pid, csrf: csrfMatch[1] });
        }
    }

    if (remoteCSRFs.length === 0) return [];

    // 第二步: 扫描本地所有 127.0.0.1 LISTENING 端口
    let localPorts = [];
    try {
        const netstat = execSync('netstat -ano | findstr "LISTENING"', {
            encoding: 'utf-8', timeout: 5000, windowsHide: true,
        });
        const seen = new Set();
        for (const line of netstat.split('\n')) {
            const m = line.match(/127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING/);
            if (m && !seen.has(m[1])) {
                seen.add(m[1]);
                localPorts.push(m[1]);
            }
        }
    } catch {
        return [];
    }

    // 排除已知的本地 LS 端口（避免重复）
    const localEps = discoverFromProcess();
    const localPortSet = new Set();
    for (const ep of localEps) {
        for (const p of ep.allPorts) localPortSet.add(p);
    }
    localPorts = localPorts.filter(p => !localPortSet.has(p));

    // 返回: 每个远程 CSRF + 候选的本地端口（验证交给 init）
    return remoteCSRFs.map(r => ({
        pid: r.pid,
        csrf: r.csrf,
        allPorts: localPorts,  // 候选端口，后续由 verifyEndpoint 筛选
        port: null,
        source: 'ssh',
    }));
}

/**
 * 验证一个端口+CSRF 组合是否能正常工作
 * @param {string} port
 * @param {string} csrf
 * @returns {boolean}
 */
async function verifyEndpoint(port, csrf) {
    try {
        const res = await postAPI(port, 'GetUnleashData', {}, csrf);
        return res.status === 200;
    } catch {
        return false;
    }
}

// ========== CDP 端口发现 (fallback) ==========

/**
 * 从一个 CDP 窗口中获取 Language Server 端口列表
 */
async function discoverPortsFromWindow(ws) {
    const raw = await cdpEval(ws, `(() => {
        var entries = performance.getEntriesByType('resource');
        var ports = [];
        entries.forEach(function(e) {
            if (e.name.includes('LanguageServer')) {
                try {
                    var p = new URL(e.name).port;
                    if (ports.indexOf(p) === -1) ports.push(p);
                } catch {}
            }
        });
        return JSON.stringify(ports);
    })()`);
    return JSON.parse(raw || '[]');
}

/**
 * 从所有 CDP 窗口中发现所有端口及其关联的窗口
 * @returns {Map<string, string>} port → windowTitle
 */
async function discoverAllPorts() {
    const portMap = new Map();
    const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);

    for (const t of targets.filter(t => t.type === 'page')) {
        let ws;
        try {
            ws = new WebSocket(t.webSocketDebuggerUrl);
            await new Promise((r, j) => {
                ws.on('open', r);
                ws.on('error', j);
                setTimeout(() => j(new Error('timeout')), 3000);
            });
            await cdpSend(ws, 'Runtime.enable');
            const ports = await discoverPortsFromWindow(ws);
            for (const p of ports) {
                // 给端口关联到最具体的窗口（非 Manager、非 Launchpad）
                if (!portMap.has(p) || (t.title !== 'Manager' && t.title !== 'Launchpad')) {
                    portMap.set(p, t.title);
                }
            }
            ws.close();
        } catch {
            if (ws) try { ws.close(); } catch { }
        }
    }
    return portMap;
}

// ========== CSRF + Metadata 获取 ==========

/**
 * 等待 IDE 自然发出的请求来拦截 CSRF token 和 metadata
 * @param {WebSocket} ws  CDP WebSocket
 * @param {number} timeoutMs  超时毫秒
 * @returns {{ csrf: string|null, metadata: object|null, port: string|null }}
 */
function interceptCredentials(ws, timeoutMs = 30000) {
    return new Promise(resolve => {
        let csrf = null;
        let metadata = null;
        let port = null;

        const handler = raw => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.method === 'Network.requestWillBeSent') {
                    const headers = msg.params.request.headers;
                    const url = msg.params.request.url;

                    // 拦截 CSRF
                    if (headers['x-codeium-csrf-token'] && !csrf) {
                        csrf = headers['x-codeium-csrf-token'];
                        try { port = new URL(url).port; } catch { }
                    }

                    // 拦截 metadata (包含 apiKey)
                    if (msg.params.request.postData && !metadata) {
                        try {
                            const body = JSON.parse(msg.params.request.postData);
                            if (body.metadata && body.metadata.apiKey) {
                                metadata = body.metadata;
                            }
                        } catch { }
                    }

                    // 拿到 CSRF 就够了（metadata 可以后续补充）
                    if (csrf) {
                        cleanup();
                        resolve({ csrf, metadata, port });
                    }
                }
            } catch { }
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve({ csrf, metadata, port });
        }, timeoutMs);

        function cleanup() {
            clearTimeout(timer);
            ws.off('message', handler);
        }

        ws.on('message', handler);
    });
}

/**
 * 从指定窗口获取 CSRF token
 * 连接窗口 → 开启 Network → 等待自然请求
 * @param {string} windowTitle  目标窗口标题（部分匹配）
 * @param {number} timeoutMs  超时
 */
async function getCredentialsFromWindow(windowTitle, timeoutMs = 20000) {
    const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
    const target = targets.find(t =>
        t.type === 'page' && t.title && t.title.includes(windowTitle)
    );
    if (!target) throw new Error(`窗口未找到: ${windowTitle}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => {
        ws.on('open', r);
        ws.on('error', j);
        setTimeout(() => j(new Error('connect timeout')), 5000);
    });
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Network.enable');

    const result = await interceptCredentials(ws, timeoutMs);
    await cdpSend(ws, 'Network.disable');
    ws.close();

    return result;
}

/**
 * 自动为所有已知端口获取 CSRF token
 * 连接每个端口对应的窗口，等待自然请求
 */
async function acquireAllCredentials() {
    const portMap = await discoverAllPorts();
    console.log(`🔍 发现 ${portMap.size} 个端口:`,
        [...portMap.entries()].map(([p, t]) => `${p} (${t})`).join(', '));

    const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);

    // 对每个窗口监听
    const windowNames = new Set(portMap.values());
    const promises = [];

    for (const name of windowNames) {
        const target = targets.find(t =>
            t.type === 'page' && t.title === name
        );
        if (!target) continue;

        promises.push((async () => {
            let ws;
            try {
                ws = new WebSocket(target.webSocketDebuggerUrl);
                await new Promise((r, j) => {
                    ws.on('open', r);
                    ws.on('error', j);
                    setTimeout(() => j(new Error('timeout')), 3000);
                });
                await cdpSend(ws, 'Runtime.enable');
                await cdpSend(ws, 'Network.enable');

                const creds = await interceptCredentials(ws, 20000);
                if (creds.csrf && creds.port) {
                    apiState.endpoints.set(creds.port, {
                        port: creds.port,
                        csrf: creds.csrf,
                        metadata: creds.metadata,
                        windowTitle: name,
                    });
                    console.log(`🔑 端口 ${creds.port} (${name}): CSRF ✅`);
                }

                await cdpSend(ws, 'Network.disable');
                ws.close();
            } catch {
                if (ws) try { ws.close(); } catch { }
            }
        })());
    }

    await Promise.allSettled(promises);

    // 设置默认活跃端口
    if (apiState.endpoints.size > 0 && !apiState.activePort) {
        apiState.activePort = [...apiState.endpoints.keys()][0];
    }
}

// ========== 初始化 ==========

/**
 * 初始化 API 层：发现端口 + 获取 CSRF
 * 
 * 优先级:
 *   1. 进程命令行 (最快最可靠，不需要 CDP)
 *   2. CDP 窗口 + 指定优先窗口
 *   3. CDP 全量扫描
 * 
 * @param {object} options
 * @param {string} [options.preferWindow] 优先使用的窗口名（部分匹配）
 * @param {boolean} [options.processOnly] 只用进程方式，不回退到 CDP
 * @param {boolean} [options.includeSSH] 是否也发现 SSH 远程端口 (默认 false)
 */
async function init(options = {}) {
    console.log('🚀 API 初始化...');

    // 清空旧状态（支持多次调用，如 IDE 重启后端口变化）
    apiState.endpoints.clear();
    apiState.activePort = null;
    apiState.initialized = false;

    // === 方式 1: 从进程命令行直接获取 (最可靠) ===
    const processEndpoints = discoverFromProcess();

    // 合并 SSH 远程端点
    let allEndpoints = [...processEndpoints];
    if (options.includeSSH) {
        console.log('🌐 扫描 SSH 远程 Language Server...');
        try {
            const sshEndpoints = discoverFromSSH();
            if (sshEndpoints.length > 0) {
                console.log(`  📡 从 SSH 发现 ${sshEndpoints.length} 个远程 LS`);
                allEndpoints.push(...sshEndpoints);
            } else {
                console.log('  ⚠️ SSH 未发现远程 LS（可能未连接）');
            }
        } catch (e) {
            console.log(`  ⚠️ SSH 发现失败: ${e.message}`);
        }
    }

    if (allEndpoints.length > 0) {
        console.log(`📋 发现 ${allEndpoints.length} 个 Language Server:`);
        for (const ep of allEndpoints) {
            const src = ep.source === 'ssh' ? ' [SSH]' : '';
            console.log(`  🔍 PID=${ep.pid}${src}  csrf=${ep.csrf.substring(0, 12)}...  候选 ${ep.allPorts.length} 个端口`);

            // 逐个端口测试，找到能响应 gRPC 的那个
            let foundPort = null;
            for (const port of ep.allPorts) {
                const ok = await verifyEndpoint(port, ep.csrf);
                if (ok) {
                    foundPort = port;
                    break;
                }
            }

            if (foundPort) {
                const label = ep.source === 'ssh' ? `SSH:${ep.pid}` : `PID:${ep.pid}`;
                apiState.endpoints.set(foundPort, {
                    port: foundPort,
                    csrf: ep.csrf,
                    metadata: null,
                    windowTitle: label,
                });
                console.log(`  ✅ gRPC 端口: ${foundPort}${src}`);
            } else {
                console.log(`  ⚠️ PID=${ep.pid}${src} 未找到可用的 gRPC 端口`);
            }
        }

        if (apiState.endpoints.size > 0) {
            apiState.activePort = [...apiState.endpoints.keys()][0];
            apiState.initialized = true;
            console.log(`✅ API 就绪 — ${apiState.endpoints.size} 个端口`);
            return apiState;
        }
    }

    if (options.processOnly) {
        throw new Error('未找到 language_server 进程。确保 Antigravity IDE 正在运行');
    }

    // === 方式 2: CDP fallback ===
    console.log('⚠️ 进程方式未发现端口，回退到 CDP...');

    const portMap = await discoverAllPorts();
    if (portMap.size === 0) {
        throw new Error('未找到任何 Language Server 端口，确保 IDE 正在运行');
    }

    // 如果指定了优先窗口，先尝试
    if (options.preferWindow) {
        try {
            const creds = await getCredentialsFromWindow(options.preferWindow);
            if (creds.csrf && creds.port) {
                apiState.endpoints.set(creds.port, {
                    port: creds.port,
                    csrf: creds.csrf,
                    metadata: creds.metadata,
                    windowTitle: options.preferWindow,
                });
                apiState.activePort = creds.port;
                apiState.initialized = true;
                console.log(`✅ API 就绪 — 端口 ${creds.port} (${options.preferWindow})`);
                return apiState;
            }
        } catch (e) {
            console.log(`⚠️ 优先窗口 "${options.preferWindow}" 初始化失败: ${e.message}`);
        }
    }

    // 全量获取
    await acquireAllCredentials();

    if (apiState.endpoints.size === 0) {
        throw new Error('未能获取任何 CSRF Token。请在 IDE 中做一个操作（如切换对话）来触发网络请求');
    }

    apiState.initialized = true;
    console.log(`✅ API 就绪 — ${apiState.endpoints.size} 个端口`);
    return apiState;
}

// ========== 内部工具 ==========

function _getEndpoint(port) {
    const p = port || apiState.activePort;
    if (!p) throw new Error('未初始化：没有活跃端口。请先调用 init()');
    const ep = apiState.endpoints.get(p);
    if (!ep) throw new Error(`端口 ${p} 未注册。已知端口: ${[...apiState.endpoints.keys()].join(', ')}`);
    return ep;
}

// ========== 核心 API ==========

/**
 * 创建新对话
 * @param {object} [options]
 * @param {string} [options.port] 指定端口（默认用 activePort）
 * @returns {{ cascadeId: string }}
 */
async function startCascade(options = {}) {
    const ep = _getEndpoint(options.port);
    const res = await postAPI(ep.port, 'StartCascade', {}, ep.csrf);

    if (res.status !== 200) {
        throw new Error(`StartCascade 失败 [${res.status}]: ${JSON.stringify(res.data)}`);
    }
    return res.data; // { cascadeId: "xxx" }
}

/**
 * 发送用户消息
 * @param {string} cascadeId
 * @param {string} text 消息文本
 * @param {object} [options]
 * @param {string} [options.port]
 * @param {boolean} [options.agenticMode=false] true = Plan 模式, false = Fast 模式
 * @param {string} [options.model] 模型标识 (默认 MODEL_PLACEHOLDER_M26)
 */
async function sendMessage(cascadeId, text, options = {}) {
    const ep = _getEndpoint(options.port);

    const body = {
        cascadeId,
        items: [{ text }],
        metadata: ep.metadata || {
            ideName: 'antigravity',
            apiKey: '',
            locale: 'en',
            ideVersion: '1.19.4',
            extensionName: 'antigravity',
        },
        cascadeConfig: {
            plannerConfig: {
                conversational: {
                    plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT',
                    agenticMode: options.agenticMode || false,
                },
                toolConfig: {
                    runCommand: {
                        autoCommandConfig: {
                            autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
                        },
                    },
                    notifyUser: {
                        artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
                    },
                },
                requestedModel: {
                    model: options.model || 'MODEL_PLACEHOLDER_M26',
                },
                ephemeralMessagesConfig: { enabled: true },
                knowledgeConfig: { enabled: true },
            },
            conversationHistoryConfig: { enabled: true },
        },
        clientType: 'CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE',
    };

    // SendUserCascadeMessage 是流式 API，这里只做基本调用
    // 流式读取留给 Task 2
    const res = await postAPI(ep.port, 'SendUserCascadeMessage', body, ep.csrf);
    return res;
}

/**
 * 获取对话的完整内容 (trajectory)
 * @param {string} cascadeId
 * @param {object} [options]
 * @param {string} [options.port]
 */
async function getTrajectory(cascadeId, options = {}) {
    const ep = _getEndpoint(options.port);
    const res = await postAPI(ep.port, 'GetCascadeTrajectory', { cascadeId }, ep.csrf);

    if (res.status !== 200) {
        throw new Error(`GetCascadeTrajectory 失败 [${res.status}]: ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * 获取可用模型配置
 * @param {object} [options]
 * @param {string} [options.port]
 */
async function getModelConfigs(options = {}) {
    const ep = _getEndpoint(options.port);
    const body = { metadata: ep.metadata || {} };
    const res = await postAPI(ep.port, 'GetCommandModelConfigs', body, ep.csrf);
    return res.data;
}

/**
 * 发送消息并等待 AI 回复完成（通过 GetCascadeTrajectory 轮询）
 * @param {string} cascadeId
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.agenticMode=false]
 * @param {string} [options.model]
 * @param {string} [options.port]
 * @param {number} [options.pollIntervalMs=1000] 轮询间隔
 * @param {number} [options.timeoutMs=300000] 超时 (默认 5 分钟)
 * @param {function} [options.onUpdate] 回调 (trajectory) => void
 * @returns {object} 最终的 trajectory 数据
 */
async function sendAndWait(cascadeId, text, options = {}) {
    const pollInterval = options.pollIntervalMs || 1000;
    const timeout = options.timeoutMs || 300000;
    const onUpdate = options.onUpdate;

    // 发送消息
    await sendMessage(cascadeId, text, options);

    // 轮询等待回复
    const startTime = Date.now();
    let lastStepCount = 0;
    let stableCount = 0;

    while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeout) {
            throw new Error(`等待回复超时 (${timeout / 1000}s)`);
        }

        await sleep(pollInterval);

        try {
            const traj = await getTrajectory(cascadeId, options);
            const stepCount = traj.numTotalSteps || traj.trajectory?.steps?.length || 0;
            const status = traj.status || '';

            if (onUpdate) onUpdate(traj);

            // 更新 step 计数
            if (stepCount > lastStepCount) {
                lastStepCount = stepCount;
                stableCount = 0;
            }

            // IDLE 且 step 数不再变化 → AI 已完成
            if (status === 'CASCADE_RUN_STATUS_IDLE' && stepCount > 0) {
                stableCount++;
                if (stableCount >= 2) return traj;
            } else {
                stableCount = 0;
            }
        } catch (e) {
            // GetTrajectory 可能在生成中暂时失败
            console.log(`  轮询异常: ${e.message}`);
        }
    }
}

/**
 * 创建新对话并发送第一条消息，等待回复
 * @param {string} text 消息文本
 * @param {object} [options] 同 sendAndWait
 * @returns {{ cascadeId: string, trajectory: object }}
 */
async function newChatAndSend(text, options = {}) {
    const { cascadeId } = await startCascade(options);
    console.log(`📝 新对话: ${cascadeId}`);

    const trajectory = await sendAndWait(cascadeId, text, options);
    return { cascadeId, trajectory };
}

// ========== 工具 API ==========

/**
 * 手动注册一个端点 (当自动获取 CSRF 失败时使用)
 * @param {string} port
 * @param {string} csrf
 * @param {object} [options]
 * @param {string} [options.windowTitle]
 * @param {object} [options.metadata]
 */
function registerEndpoint(port, csrf, options = {}) {
    apiState.endpoints.set(port, {
        port,
        csrf,
        metadata: options.metadata || null,
        windowTitle: options.windowTitle || 'manual',
    });
    if (!apiState.activePort) apiState.activePort = port;
    apiState.initialized = true;
    console.log(`🔧 手动注册端口 ${port}`);
}

/**
 * 刷新 CSRF token（如果 token 失效）
 */
async function refreshCredentials(port) {
    const p = port || apiState.activePort;
    const ep = apiState.endpoints.get(p);
    if (!ep) return;

    // 方式 1: 从进程命令行重新获取（进程模式注册的端口）
    if (ep.windowTitle && ep.windowTitle.startsWith('PID:')) {
        const processEps = discoverFromProcess();
        for (const pep of processEps) {
            if (ep.windowTitle === `PID:${pep.pid}`) {
                ep.csrf = pep.csrf;
                console.log(`🔄 端口 ${p} CSRF 已从进程刷新`);
                return;
            }
        }
        console.log(`⚠️ 端口 ${p} 的进程已不存在，无法刷新`);
        return;
    }

    // 方式 2: CDP fallback
    try {
        const creds = await getCredentialsFromWindow(ep.windowTitle);
        if (creds.csrf) {
            ep.csrf = creds.csrf;
            if (creds.metadata) ep.metadata = creds.metadata;
            console.log(`🔄 端口 ${p} CSRF 已刷新 (CDP)`);
        }
    } catch (e) {
        console.log(`⚠️ CSRF 刷新失败: ${e.message}`);
    }
}

/**
 * 设置活跃端口
 */
function setActivePort(port) {
    if (!apiState.endpoints.has(port)) {
        throw new Error(`未知端口 ${port}。已知: ${[...apiState.endpoints.keys()].join(', ')}`);
    }
    apiState.activePort = port;
}

/**
 * 获取当前状态摘要
 */
function getStatus() {
    return {
        initialized: apiState.initialized,
        activePort: apiState.activePort,
        endpoints: [...apiState.endpoints.entries()].map(([port, ep]) => ({
            port,
            windowTitle: ep.windowTitle,
            hasCsrf: !!ep.csrf,
            hasMetadata: !!ep.metadata,
        })),
    };
}

module.exports = {
    // 初始化
    init,
    discoverFromProcess,
    discoverFromSSH,
    discoverAllPorts,
    acquireAllCredentials,
    getCredentialsFromWindow,
    verifyEndpoint,

    // 核心 API
    startCascade,
    sendMessage,
    getTrajectory,
    getModelConfigs,

    // 高级 API
    sendAndWait,
    newChatAndSend,

    // 工具
    registerEndpoint,
    refreshCredentials,
    setActivePort,
    getStatus,

    // 低级 API (供外部直接调用)
    postAPI,
    SERVICE_PATH,

    // 状态
    state: apiState,
};
