#!/usr/bin/env node
/**
 * 轻量 Extension Server — 为 Daemon LS 提供文件/终端操作能力
 *
 * 协议: Connect Protocol (JSON over HTTP POST)
 * 路径: /exa.extension_server_pb.ExtensionServerService/{Method}
 *
 * 阶段 1 (当前): 探测模式 — 记录所有 LS 调用的方法和参数
 * 阶段 2: 实现核心方法（文件读写、命令执行）
 *
 * 用法:
 *   node scripts/ext-server.js                # 启动，默认端口 42200
 *   EXT_PORT=42200 node scripts/ext-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PORT = Number(process.env.EXT_PORT || 42200);
const CSRF_TOKEN = process.env.EXT_CSRF_TOKEN || 'ext-server-csrf-token';
const IDE_VERSION = '1.19.6';
const OAUTH_TOKEN_FILE = path.join(process.env.HOME || '/home/tiemuer', '.gemini', 'jetski-standalone-oauth-token');

// ========== OAuth Token ==========
function readOAuthToken() {
    try {
        const raw = fs.readFileSync(OAUTH_TOKEN_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('[ExtServer] Failed to read OAuth token:', e.message);
        return null;
    }
}

// ========== 终端进程池 ==========
const terminals = new Map(); // id -> { proc, output, cwd }

// ========== 方法实现 ==========

const handlers = {
    /**
     * LS 启动后第一个调用 — 通知 Extension Server 自己已就绪
     */
    LanguageServerStarted(req) {
        console.log('[ExtServer] LS started, ports:', req.httpsPort, req.httpPort);
        return {};
    },

    /**
     * 检查终端 shell 支持
     */
    CheckTerminalShellSupport(req) {
        return { shellSupported: true };
    },

    /**
     * 是否启用 Agent Manager
     */
    IsAgentManagerEnabled(req) {
        return { enabled: false };
    },

    /**
     * 日志事件（遥测）
     */
    LogEvent(req) {
        // 静默处理
        return {};
    },

    /**
     * 记录错误
     */
    RecordError(req) {
        return {};
    },

    /**
     * 存储密钥
     */
    StoreSecretValue(req) {
        return {};
    },

    /**
     * 获取密钥
     */
    GetSecretValue(req) {
        return { value: '' };
    },

    /**
     * 播放声音
     */
    PlaySound(req) {
        return {};
    },

    /**
     * 获取 lint 错误
     */
    GetLintErrors(req) {
        // TODO: 调用 eslint/tsc
        return { lintErrors: [] };
    },

    /**
     * 打开文件指针（IDE 中打开文件并定位）
     */
    OpenFilePointer(req) {
        console.log('[ExtServer] OpenFilePointer:', req.uri || req.absoluteUri);
        return {};
    },

    /**
     * 保存文档（写文件）
     */
    SaveDocument(req) {
        const uri = req.uri || req.absoluteUri || '';
        const filePath = uri.replace('file://', '');
        if (filePath && req.content !== undefined) {
            try {
                fs.writeFileSync(filePath, req.content);
                console.log('[ExtServer] SaveDocument:', filePath);
                return { success: true };
            } catch (e) {
                console.error('[ExtServer] SaveDocument failed:', e.message);
                return { success: false, error: e.message };
            }
        }
        return {};
    },

    /**
     * 写代码编辑（应用 diff）
     */
    WriteCascadeEdit(req) {
        console.log('[ExtServer] WriteCascadeEdit:', JSON.stringify(req).substring(0, 200));
        // TODO: 应用文件编辑
        return {};
    },

    /**
     * 打开终端
     */
    OpenTerminal(req) {
        const id = req.terminalId || `term-${Date.now()}`;
        const cwd = req.workingDirectory || req.cwd || process.env.HOME;
        console.log('[ExtServer] OpenTerminal:', id, 'cwd:', cwd);

        const proc = spawn('/bin/bash', ['-l'], {
            cwd,
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('exit', (code) => {
            const t = terminals.get(id);
            if (t) t.exitCode = code;
        });

        terminals.set(id, { proc, output: '', cwd, exitCode: null });

        // 将 stdout/stderr 追加到 output
        proc.stdout.on('data', (d) => {
            const t = terminals.get(id);
            if (t) t.output += d.toString();
        });
        proc.stderr.on('data', (d) => {
            const t = terminals.get(id);
            if (t) t.output += d.toString();
        });

        return { terminalId: id };
    },

    /**
     * 向终端发送输入
     */
    SendTerminalInput(req) {
        const id = req.terminalId;
        const t = terminals.get(id);
        if (t && t.proc && !t.proc.killed) {
            t.proc.stdin.write(req.input || req.data || '');
            return {};
        }
        return { error: 'terminal not found' };
    },

    /**
     * 读取终端输出
     */
    ReadTerminal(req) {
        const id = req.terminalId;
        const t = terminals.get(id);
        if (t) {
            const output = t.output;
            t.output = ''; // 清空已读
            return {
                output,
                isRunning: t.proc && !t.proc.killed,
                exitCode: t.exitCode,
            };
        }
        return { output: '', isRunning: false };
    },

    /**
     * 显示终端
     */
    ShowTerminal(req) {
        return {};
    },

    /**
     * 终止命令
     */
    TerminateCommand(req) {
        const id = req.terminalId;
        const t = terminals.get(id);
        if (t && t.proc && !t.proc.killed) {
            t.proc.kill('SIGTERM');
            console.log('[ExtServer] TerminateCommand:', id);
        }
        return {};
    },

    /**
     * 执行命令
     */
    ExecuteCommand(req) {
        console.log('[ExtServer] ExecuteCommand:', req.command);
        try {
            const result = execSync(req.command, {
                cwd: req.cwd || process.env.HOME,
                encoding: 'utf-8',
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
            });
            return { output: result, exitCode: 0 };
        } catch (e) {
            return { output: e.stdout || e.message, exitCode: e.status || 1 };
        }
    },

    /**
     * 打开 diff 视图
     */
    OpenDiffZones(req) {
        return {};
    },

    /**
     * 打开外部 URL
     */
    OpenExternalUrl(req) {
        console.log('[ExtServer] OpenExternalUrl:', req.url);
        return {};
    },

    /**
     * 插入代码到光标位置
     */
    InsertCodeAtCursor(req) {
        return {};
    },

    /**
     * 打开虚拟文件
     */
    OpenVirtualFile(req) {
        return {};
    },

    /**
     * 跳转到定义
     */
    GetDefinition(req) {
        return { definitions: [] };
    },

    /**
     * 查找引用
     */
    FindAllReferences(req) {
        return { references: [] };
    },

    /**
     * 打开设置
     */
    OpenSetting(req) {
        return {};
    },

    /**
     * 统一状态同步订阅 (流式)
     * LS 通过此接口订阅 OAuth token 等状态。
     * 返回 '__stream__' 标记让 HTTP handler 进入流式模式。
     */
    SubscribeToUnifiedStateSyncTopic(req, res) {
        const topic = req.topicId || req.topic || 'unknown';
        console.log(`[ExtServer] SubscribeToUnifiedStateSyncTopic: topic=${topic}`);

        if (topic === 'uss-oauth') {
            // 推送 OAuth token
            const token = readOAuthToken();
            if (token) {
                const update = {
                    topicId: 'uss-oauth',
                    data: JSON.stringify({
                        access_token: token.access_token,
                        token_type: token.token_type || 'Bearer',
                        refresh_token: token.refresh_token,
                        expiry: token.expiry,
                    }),
                };
                console.log('[ExtServer] Pushing OAuth token to LS');
                res.write(JSON.stringify(update) + '\n');
            }
            // 保持连接打开，定期刷新 token
            const interval = setInterval(() => {
                const freshToken = readOAuthToken();
                if (freshToken) {
                    const update = {
                        topicId: 'uss-oauth',
                        data: JSON.stringify({
                            access_token: freshToken.access_token,
                            token_type: freshToken.token_type || 'Bearer',
                            refresh_token: freshToken.refresh_token,
                            expiry: freshToken.expiry,
                        }),
                    };
                    try { res.write(JSON.stringify(update) + '\n'); } catch { clearInterval(interval); }
                }
            }, 30000); // 每 30s 刷新
            res.on('close', () => clearInterval(interval));
            return '__stream__';
        }

        // 其他 topic: 保持连接打开但不推送数据
        console.log(`[ExtServer] Keeping stream open for topic: ${topic}`);
        return '__stream__';
    },

    /**
     * 推送统一状态同步
     */
    PushUnifiedStateSyncUpdate(req) {
        return {};
    },

    /**
     * 更新对话摘要
     */
    UpdateCascadeTrajectorySummaries(req) {
        return {};
    },

    /**
     * 广播对话删除
     */
    BroadcastConversationDeletion(req) {
        return {};
    },

    /**
     * 获取浏览器 onboarding 端口
     */
    GetBrowserOnboardingPort(req) {
        return { port: 0 };
    },

    /**
     * 打开 Antigravity 规则文件
     */
    OpenAntigravityRulesFile(req) {
        return {};
    },

    /**
     * 智能聚焦对话
     */
    SmartFocusConversation(req) {
        return {};
    },

    /**
     * 显示对话选择器
     */
    ShowConversationPicker(req) {
        return {};
    },

    /**
     * 终端研究结果
     */
    TerminalResearchResult(req) {
        return {};
    },

    /**
     * 更新详情视图
     */
    UpdateDetailedViewWithCascadeInput(req) {
        return {};
    },

    /**
     * 获取 Chrome DevTools MCP URL
     */
    GetChromeDevtoolsMcpUrl(req) {
        return { url: '' };
    },

    /**
     * 异步消息处理
     */
    HandleAsyncPostMessage(req) {
        return {};
    },

    /**
     * 打开对话工作区选择器
     */
    OpenConversationWorkspaceQuickPick(req) {
        return {};
    },

    /**
     * 代码验证
     */
    HandleProposeCodeExtensionVerification(req) {
        return {};
    },

    /**
     * 重启用户状态更新器
     */
    RestartUserStatusUpdater(req) {
        return {};
    },

    /**
     * 获取 MCP 认证 token
     */
    FetchMCPAuthToken(req) {
        return {};
    },

    /**
     * 运行扩展代码
     */
    RunExtensionCode(req) {
        return {};
    },

    /**
     * 启动浏览器
     */
    LaunchBrowser(req) {
        return {};
    },
};

// ========== HTTP 服务 ==========

const SERVICE_PREFIX = '/exa.extension_server_pb.ExtensionServerService/';

const server = http.createServer((req, res) => {
    // CORS / health
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Extension Server OK');
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    // 解析方法名
    const url = req.url || '';
    if (!url.startsWith(SERVICE_PREFIX)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `unknown path: ${url}` }));
        return;
    }

    const method = url.slice(SERVICE_PREFIX.length);

    // 读取请求体
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        let parsed = {};
        try {
            parsed = body ? JSON.parse(body) : {};
        } catch {
            // 有些请求可能是空的
        }

        const handler = handlers[method];
        if (handler) {
            try {
                // 流式方法：传入 res 让 handler 自己控制响应
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'connect-protocol-version': '1',
                });
                const result = handler(parsed, res);
                if (result === '__stream__') {
                    // 流式响应，handler 自己管理 res 生命周期
                    return;
                }
                res.end(JSON.stringify(result));
            } catch (e) {
                console.error(`[ExtServer] ERROR ${method}:`, e.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: e.message }));
            }
        } else {
            // 未实现的方法 — 记录并返回空
            console.log(`[ExtServer] UNIMPLEMENTED: ${method}`, JSON.stringify(parsed).substring(0, 200));
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'connect-protocol-version': '1',
            });
            res.end('{}');
        }
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[ExtServer] Extension Server listening on 127.0.0.1:${PORT}`);
    console.log(`[ExtServer] CSRF Token: ${CSRF_TOKEN}`);
    console.log(`[ExtServer] Handlers: ${Object.keys(handlers).length} methods`);
    console.log('');
});
