/**
 * lib/core/oauth/index.js — OAuth 完整链路
 *
 * 功能:
 *   1. readToken      — 读取本地 token 文件
 *   2. saveToken       — 保存 token 到文件
 *   3. isTokenExpired  — 检查 access_token 是否过期
 *   4. refreshToken    — 用 refresh_token 换取新 access_token
 *   5. fetchUserInfo   — 用 access_token 获取账户信息
 *   6. ensureValidToken — 自动刷新过期 token (读取 → 检查 → 刷新 → 保存)
 *   7. exchangeCode    — 用 authorization_code 换取 tokens
 *   8. buildAuthUrl    — 构建 Google OAuth 授权 URL
 *   9. startLoginServer — 启动本地回调服务器完成 OAuth 登录
 *
 * Token 文件格式 (jetski-standalone-oauth-token):
 *   { access_token, token_type, refresh_token, expiry }
 *
 * 链路图:
 *   首次登录: buildAuthUrl → 浏览器授权 → startLoginServer 接收回调 → exchangeCode → saveToken
 *   日常刷新: readToken → isTokenExpired → refreshToken → saveToken
 *   一键调用: ensureValidToken (自动完成日常刷新链路)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');

const {
    loadCredentials,
    SCOPES,
    GOOGLE_TOKEN_URL,
    GOOGLE_AUTH_URL,
    GOOGLE_USERINFO_URL,
    DEFAULT_CALLBACK_PORT,
    getTokenFilePath,
} = require('./credentials');

// Lazy-loaded credentials (避免模块加载时就报错)
let _creds = null;
function getCredentials() {
    if (!_creds) _creds = loadCredentials();
    return _creds;
}

// ========== Token 文件操作 ==========

/**
 * 读取本地 token 文件
 * @param {string} [geminiDir] - gemini 目录名
 * @returns {{ access_token: string, token_type: string, refresh_token: string, expiry: string } | null}
 */
function readToken(geminiDir) {
    const filePath = getTokenFilePath(geminiDir);
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data.refresh_token) return null;
        return data;
    } catch {
        return null;
    }
}

/**
 * 保存 token 到文件
 * @param {string} geminiDir - gemini 目录名
 * @param {{ access_token: string, token_type?: string, refresh_token: string, expiry?: string }} tokenData
 */
function saveToken(geminiDir, tokenData) {
    const filePath = getTokenFilePath(geminiDir);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const toWrite = {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        refresh_token: tokenData.refresh_token,
        expiry: tokenData.expiry || new Date(Date.now() + 3600 * 1000).toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
    return filePath;
}

/**
 * 检查 access_token 是否过期 (提前 5 分钟视为过期)
 * @param {{ expiry?: string }} token
 * @returns {boolean}
 */
function isTokenExpired(token) {
    if (!token || !token.expiry) return true;
    const expiryMs = new Date(token.expiry).getTime();
    const bufferMs = 5 * 60 * 1000; // 5 min buffer
    return Date.now() >= expiryMs - bufferMs;
}

// ========== HTTP 请求工具 ==========

/**
 * 发送 POST 请求到 Google OAuth 端点
 * @param {string} urlStr
 * @param {string} postData - URL-encoded form data
 * @returns {Promise<Object>}
 */
function _postForm(urlStr, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(urlStr, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
            },
        }, (res) => {
            let body = '';
            res.on('data', (d) => body += d);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.error) {
                        let msg = `${parsed.error}: ${parsed.error_description || 'unknown'}`;
                        // 针对常见 OAuth 错误添加诊断提示
                        if (parsed.error === 'invalid_client') {
                            msg += '\n\n[诊断] CLIENT_ID 或 CLIENT_SECRET 无效。'
                                + '\n  可能原因: credentials 已被 Google 吊销/轮换。'
                                + '\n  解决方法: 从 LS binary 重新提取最新 credentials:'
                                + '\n    strings language_server_linux_x64 | grep -oP "\\d+-[a-z0-9]+\\.apps\\.googleusercontent\\.com"'
                                + '\n    strings language_server_linux_x64 | grep "GOCSPX"'
                                + `\n  然后更新: ${CREDENTIALS_FILE}`;
                        } else if (parsed.error === 'invalid_grant') {
                            msg += '\n\n[诊断] refresh_token 已失效 (可能被撤销或过期)。'
                                + '\n  解决方法: 重新执行 login 流程获取新 token。';
                        }
                        reject(new Error(msg));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`Response parse error: ${body.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * 发送 GET 请求
 * @param {string} urlStr
 * @param {Object} [headers]
 * @returns {Promise<Object>}
 */
function _getJSON(urlStr, headers = {}) {
    return new Promise((resolve, reject) => {
        https.get(urlStr, { headers }, (res) => {
            let body = '';
            res.on('data', (d) => body += d);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`Response parse error: ${body.slice(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

// ========== OAuth 核心操作 ==========

/**
 * 用 refresh_token 换取新的 access_token
 * @param {string} refreshToken
 * @returns {Promise<{ access_token: string, token_type: string, expires_in: number, scope: string }>}
 */
async function refreshToken(refreshToken) {
    const { clientId, clientSecret } = getCredentials();
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });
    return _postForm(GOOGLE_TOKEN_URL, params.toString());
}

/**
 * 用 authorization_code 换取 tokens (access_token + refresh_token)
 * @param {string} code - 授权码
 * @param {string} redirectUri - 回调地址
 * @returns {Promise<{ access_token: string, refresh_token: string, token_type: string, expires_in: number, id_token?: string }>}
 */
async function exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = getCredentials();
    const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });
    return _postForm(GOOGLE_TOKEN_URL, params.toString());
}

/**
 * 用 access_token 获取用户信息
 * @param {string} accessToken
 * @returns {Promise<{ email: string, name: string, picture: string } | null>}
 */
async function fetchUserInfo(accessToken) {
    try {
        return await _getJSON(GOOGLE_USERINFO_URL, {
            Authorization: `Bearer ${accessToken}`,
        });
    } catch {
        return null;
    }
}

/**
 * 从 id_token 解析用户邮箱 (无需网络请求)
 * @param {string} idToken - JWT id_token
 * @returns {string | null}
 */
function parseEmailFromIdToken(idToken) {
    try {
        const payload = JSON.parse(
            Buffer.from(idToken.split('.')[1], 'base64url').toString(),
        );
        return payload.email || null;
    } catch {
        return null;
    }
}

// ========== 高级操作 ==========

/**
 * 确保 token 有效: 读取 → 检查过期 → 自动刷新 → 保存
 * @param {string} [geminiDir] - gemini 目录名
 * @returns {Promise<{ access_token: string, refresh_token: string, expiry: string, email?: string } | null>}
 */
async function ensureValidToken(geminiDir) {
    const token = readToken(geminiDir);
    if (!token) return null;

    if (!isTokenExpired(token)) {
        return token;
    }

    // Token 过期，尝试刷新
    try {
        const fresh = await refreshToken(token.refresh_token);
        const expiry = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
        const updated = {
            access_token: fresh.access_token,
            token_type: fresh.token_type || 'Bearer',
            refresh_token: token.refresh_token, // refresh_token 不会变
            expiry,
        };
        saveToken(geminiDir, updated);
        return updated;
    } catch (err) {
        console.error(`[OAuth] Token refresh failed: ${err.message}`);
        return null;
    }
}

/**
 * 从 refresh_token 直接创建 token 文件 (跳过浏览器登录)
 * @param {string} refreshTokenStr - refresh_token 字符串
 * @param {string} [geminiDir] - gemini 目录名
 * @returns {Promise<{ filePath: string, email: string | null }>}
 */
async function createTokenFromRefresh(refreshTokenStr, geminiDir) {
    const fresh = await refreshToken(refreshTokenStr);
    const expiry = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
    const tokenData = {
        access_token: fresh.access_token,
        token_type: fresh.token_type || 'Bearer',
        refresh_token: refreshTokenStr,
        expiry,
    };

    const filePath = saveToken(geminiDir, tokenData);

    // 获取账户邮箱
    const userInfo = await fetchUserInfo(fresh.access_token);
    const email = userInfo?.email || null;

    return { filePath, email };
}

// ========== OAuth 登录流程 ==========

/**
 * 构建 Google OAuth 授权 URL
 * @param {number} [callbackPort] - 本地回调端口
 * @returns {string}
 */
function buildAuthUrl(callbackPort = DEFAULT_CALLBACK_PORT) {
    const redirectUri = `http://localhost:${callbackPort}/callback`;
    const { clientId } = getCredentials();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * 启动本地 HTTP 服务器, 完成 OAuth 登录流程
 *
 * 流程: 打印授权 URL → 等待 Google 回调 → 交换 code → 保存 token → 关闭服务器
 *
 * @param {Object} [options]
 * @param {number} [options.port=9876] - 回调端口
 * @param {string} [options.geminiDir='.gemini'] - gemini 目录名
 * @param {number} [options.timeoutMs=300000] - 超时时间 (默认 5 分钟)
 * @returns {Promise<{ email: string | null, tokenFile: string }>}
 */
function startLoginServer(options = {}) {
    const port = options.port || DEFAULT_CALLBACK_PORT;
    const geminiDir = options.geminiDir || 'gemini';
    const timeoutMs = options.timeoutMs || 300000;

    return new Promise((resolve, reject) => {
        let timer = null;

        const server = http.createServer(async (req, res) => {
            const parsed = url.parse(req.url, true);
            if (parsed.pathname !== '/callback' && parsed.pathname !== '/') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const code = parsed.query.code;
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>Missing authorization code</h1>');
                return;
            }

            try {
                const redirectUri = `http://localhost:${port}/callback`;
                const tokens = await exchangeCode(code, redirectUri);
                const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
                const tokenData = {
                    access_token: tokens.access_token,
                    token_type: tokens.token_type || 'Bearer',
                    refresh_token: tokens.refresh_token,
                    expiry,
                };

                const tokenFile = saveToken(geminiDir, tokenData);

                // 解析账户邮箱
                let email = null;
                if (tokens.id_token) {
                    email = parseEmailFromIdToken(tokens.id_token);
                }
                if (!email) {
                    const userInfo = await fetchUserInfo(tokens.access_token);
                    email = userInfo?.email || null;
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end([
                    '<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0;">',
                    `<h1 style="color:#4ade80;">Login Success</h1>`,
                    `<p>Account: <strong>${email || 'unknown'}</strong></p>`,
                    `<p>Token saved to: <code>${tokenFile}</code></p>`,
                    '<p style="color:#888;">You can close this page.</p>',
                    '</body></html>',
                ].join(''));

                clearTimeout(timer);
                setTimeout(() => {
                    server.close();
                    resolve({ email, tokenFile });
                }, 500);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h1>Failed</h1><p>${err.message}</p>`);
                clearTimeout(timer);
                setTimeout(() => {
                    server.close();
                    reject(err);
                }, 500);
            }
        });

        server.listen(port, '127.0.0.1', () => {
            const authUrl = buildAuthUrl(port);
            const tokenFile = getTokenFilePath(geminiDir);

            console.log('');
            console.log('=== OAuth Login for Daemon LS ===');
            console.log(`Token file: ${tokenFile}`);
            console.log(`Callback:   http://127.0.0.1:${port}/callback`);
            console.log('');
            console.log('Open this URL in your LOCAL browser:');
            console.log('');
            console.log(authUrl);
            console.log('');
            console.log('Waiting for callback...');
        });

        server.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Login server failed: ${err.message}`));
        });

        timer = setTimeout(() => {
            server.close();
            reject(new Error(`Login timeout after ${timeoutMs / 1000}s`));
        }, timeoutMs);
    });
}

// ========== CLI 入口 ==========

/**
 * 作为独立脚本运行时的入口
 *
 * 用法:
 *   node lib/core/oauth/index.js login [--gemini-dir .gemini] [--port 9876]
 *   node lib/core/oauth/index.js refresh [--gemini-dir .gemini]
 *   node lib/core/oauth/index.js create --refresh-token <token> [--gemini-dir .gemini-alt]
 *   node lib/core/oauth/index.js status [--gemini-dir .gemini]
 */
async function cli() {
    const args = process.argv.slice(2);
    const command = args[0] || 'login';

    // 解析参数
    let geminiDir = '.gemini';
    let port = DEFAULT_CALLBACK_PORT;
    let refreshTokenArg = null;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--gemini-dir' && args[i + 1]) { geminiDir = args[++i]; }
        else if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i]); }
        else if (args[i] === '--refresh-token' && args[i + 1]) { refreshTokenArg = args[++i]; }
    }

    switch (command) {
        case 'login': {
            try {
                const result = await startLoginServer({ port, geminiDir });
                console.log(`\nDone! Account: ${result.email || 'unknown'}`);
                console.log(`Token file: ${result.tokenFile}`);
            } catch (err) {
                console.error(`\nLogin failed: ${err.message}`);
                process.exit(1);
            }
            break;
        }
        case 'refresh': {
            const result = await ensureValidToken(geminiDir);
            if (result) {
                console.log(`Token refreshed. Expiry: ${result.expiry}`);
            } else {
                console.error('No token found or refresh failed.');
                process.exit(1);
            }
            break;
        }
        case 'create': {
            if (!refreshTokenArg) {
                console.error('Usage: create --refresh-token <token> [--gemini-dir <dir>]');
                process.exit(1);
            }
            try {
                const result = await createTokenFromRefresh(refreshTokenArg, geminiDir);
                console.log(`Token created: ${result.filePath}`);
                console.log(`Account: ${result.email || 'unknown'}`);
            } catch (err) {
                console.error(`Failed: ${err.message}`);
                process.exit(1);
            }
            break;
        }
        case 'status': {
            const token = readToken(geminiDir);
            const tokenFile = getTokenFilePath(geminiDir);
            if (!token) {
                console.log(`No token found at: ${tokenFile}`);
                process.exit(1);
            }
            const expired = isTokenExpired(token);
            console.log(`Token file:  ${tokenFile}`);
            console.log(`Expiry:      ${token.expiry}`);
            console.log(`Status:      ${expired ? 'EXPIRED' : 'VALID'}`);
            if (!expired) {
                const info = await fetchUserInfo(token.access_token);
                if (info?.email) console.log(`Account:     ${info.email}`);
            }
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Commands: login, refresh, create, status');
            process.exit(1);
    }
}

// 如果直接运行此文件, 执行 CLI
if (require.main === module) {
    cli().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    // Token 文件操作
    readToken,
    saveToken,
    isTokenExpired,

    // OAuth 核心
    refreshToken,
    exchangeCode,
    fetchUserInfo,
    parseEmailFromIdToken,

    // 高级操作
    ensureValidToken,
    createTokenFromRefresh,

    // 登录流程
    buildAuthUrl,
    startLoginServer,

    // Re-export credentials
    ...require('./credentials'),
};
