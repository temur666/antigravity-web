/**
 * lib/core/oauth/credentials.js — OAuth 常量
 *
 * CLIENT_ID / CLIENT_SECRET 从环境变量或 .env 文件读取
 *
 * 获取方法 (从 LS binary 提取):
 *   strings language_server_linux_x64 | grep -oP '\d+-[a-z0-9]+\.apps\.googleusercontent\.com'
 *   strings language_server_linux_x64 | grep 'GOCSPX'
 *
 * 配置方式:
 *   1. 环境变量: AG_OAUTH_CLIENT_ID, AG_OAUTH_CLIENT_SECRET
 *   2. 文件: ~/.gemini/antigravity/oauth-credentials.json
 */

const fs = require('fs');
const path = require('path');

// ========== Credentials 加载 ==========

const CREDENTIALS_FILE = path.join(
    process.env.HOME || '/home/tiemuer',
    '.gemini', 'antigravity', 'oauth-credentials.json',
);

/**
 * 加载 OAuth credentials (环境变量优先, fallback 到文件)
 * @returns {{ clientId: string, clientSecret: string }}
 */
function loadCredentials() {
    // 优先从环境变量读取
    if (process.env.AG_OAUTH_CLIENT_ID && process.env.AG_OAUTH_CLIENT_SECRET) {
        return {
            clientId: process.env.AG_OAUTH_CLIENT_ID,
            clientSecret: process.env.AG_OAUTH_CLIENT_SECRET,
        };
    }

    // Fallback: 从文件读取
    try {
        const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.client_id && data.client_secret) {
            return { clientId: data.client_id, clientSecret: data.client_secret };
        }
    } catch {
        // 文件不存在或解析失败
    }

    throw new Error(
        `OAuth credentials not found. Set AG_OAUTH_CLIENT_ID/AG_OAUTH_CLIENT_SECRET env vars, ` +
        `or create ${CREDENTIALS_FILE} with { "client_id": "...", "client_secret": "..." }`,
    );
}

// ========== Scopes ==========

const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cloud-platform',
];

// ========== Google Endpoints ==========

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ========== File Paths ==========

const TOKEN_FILENAME = 'jetski-standalone-oauth-token';
const DEFAULT_GEMINI_DIR = '.gemini';
const DEFAULT_CALLBACK_PORT = 9876;

/**
 * 获取 token 文件的完整路径
 * @param {string} [geminiDir] - gemini 目录名 (默认 '.gemini')
 * @returns {string}
 */
function getTokenFilePath(geminiDir = DEFAULT_GEMINI_DIR) {
    return path.join(process.env.HOME || '/home/tiemuer', geminiDir, TOKEN_FILENAME);
}

module.exports = {
    loadCredentials,
    CREDENTIALS_FILE,
    SCOPES,
    GOOGLE_TOKEN_URL,
    GOOGLE_AUTH_URL,
    GOOGLE_USERINFO_URL,
    TOKEN_FILENAME,
    DEFAULT_GEMINI_DIR,
    DEFAULT_CALLBACK_PORT,
    getTokenFilePath,
};
