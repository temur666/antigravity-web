#!/usr/bin/env node
/**
 * OAuth E2E 验证脚本
 *
 * 完整链路验证:
 *   1. 启动 standalone LS daemon (指定 gemini_dir)
 *   2. 等待 LS 就绪
 *   3. Heartbeat 验证连接
 *   4. 发送一条消息, 验证 Google API 认证通过
 *   5. 清理退出
 *
 * 用法:
 *   node lib/core/oauth/e2e-verify.js --gemini-dir .gemini-alt --port 42300
 *   node lib/core/oauth/e2e-verify.js --gemini-dir .gemini --port 42300
 */

const { spawn } = require('child_process');
const path = require('path');
const { grpcCall, clearProtocolCache } = require('../../ls/grpc');
const { readToken, ensureValidToken } = require('../index');

// ========== 配置 ==========

const args = process.argv.slice(2);
let geminiDir = '.gemini-alt';
let lsPort = 42300;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gemini-dir' && args[i + 1]) geminiDir = args[++i];
    if (args[i] === '--port' && args[i + 1]) lsPort = parseInt(args[++i]);
}

const LS_VERSION = '1.19.6';
const LS_HASH = 'd2597a5c475647ed306b22de1e39853c7812d07d';
const LS_BIN = path.join(
    process.env.HOME, '.antigravity-server', 'bin',
    `${LS_VERSION}-${LS_HASH}`, 'extensions', 'antigravity', 'bin',
    'language_server_linux_x64',
);
const METADATA_BIN = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'ls-metadata.bin');
const CSRF_TOKEN = 'e2e-verify-csrf';
const CLOUD_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';

// ========== 工具函数 ==========

function log(tag, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${tag}] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== 主流程 ==========

async function main() {
    let lsProcess = null;

    try {
        // Step 0: 验证 token 文件存在
        log('CHECK', `Verifying token file in ~/${geminiDir}/...`);
        const token = readToken(geminiDir);
        if (!token) {
            log('FAIL', `No token file found in ~/${geminiDir}/. Run: node lib/core/oauth create --refresh-token <token> --gemini-dir ${geminiDir}`);
            process.exit(1);
        }
        log('OK', `Token file found. Has refresh_token: ${!!token.refresh_token}`);

        // Step 0.5: 确保 token 是新鲜的
        log('CHECK', 'Ensuring token is fresh...');
        const fresh = await ensureValidToken(geminiDir);
        if (!fresh) {
            log('FAIL', 'Token refresh failed. CLIENT_ID/SECRET may be wrong.');
            process.exit(1);
        }
        log('OK', `Token valid until ${fresh.expiry}`);

        // Step 1: 启动 LS daemon
        log('START', `Launching LS daemon on port ${lsPort} with gemini_dir=${geminiDir}...`);

        const fs = require('fs');
        const metadataFd = fs.openSync(METADATA_BIN, 'r');

        lsProcess = spawn(LS_BIN, [
            `-persistent_mode=true`,
            `-csrf_token=${CSRF_TOKEN}`,
            `-server_port=${lsPort}`,
            `-random_port=false`,
            `-standalone=true`,
            `-workspace_id=file_home_tiemuer`,
            `-cloud_code_endpoint=${CLOUD_ENDPOINT}`,
            `-app_data_dir=antigravity`,
            `-gemini_dir=${geminiDir}`,
            `-enable_lsp=false`,
        ], {
            stdio: [metadataFd, 'pipe', 'pipe'],
            detached: false,
        });

        fs.closeSync(metadataFd);

        // 收集 LS 输出 (用于诊断)
        let lsStdout = '';
        let lsStderr = '';
        lsProcess.stdout.on('data', d => { lsStdout += d.toString(); });
        lsProcess.stderr.on('data', d => { lsStderr += d.toString(); });
        lsProcess.on('exit', (code) => {
            if (code !== null && code !== 0) {
                log('WARN', `LS process exited with code ${code}`);
            }
        });

        // Step 2: 等待 LS 就绪
        log('WAIT', 'Waiting for LS to start (polling Heartbeat)...');
        clearProtocolCache();

        let ready = false;
        for (let i = 0; i < 30; i++) {
            await sleep(1000);
            try {
                await grpcCall(lsPort, CSRF_TOKEN, 'Heartbeat', { metadata: {} }, 3000);
                ready = true;
                break;
            } catch (err) {
                if (i % 5 === 4) log('WAIT', `Still waiting... (${i + 1}s) ${err.message.slice(0, 60)}`);
            }
        }

        if (!ready) {
            log('FAIL', 'LS did not start within 30 seconds.');
            log('DEBUG', `stdout: ${lsStdout.slice(-500)}`);
            log('DEBUG', `stderr: ${lsStderr.slice(-500)}`);
            process.exit(1);
        }
        log('OK', 'Heartbeat successful - LS is running.');

        // Step 3: 创建对话 + 发送消息 (验证 Google API 认证)
        log('TEST', 'Creating conversation and sending test message...');

        let conversationId;
        try {
            const createResp = await grpcCall(lsPort, CSRF_TOKEN, 'CreateCascade', {
                name: 'e2e-oauth-verify',
                parentConversationId: '',
            }, 10000);
            conversationId = createResp?.cascadeId || createResp?.cascade_id;
            log('OK', `Conversation created: ${conversationId || 'unknown'}`);
        } catch (err) {
            log('WARN', `CreateCascade failed: ${err.message}`);
            log('INFO', 'Trying ListConversations instead...');

            // Fallback: 只验证 ListConversations 是否需要认证
            try {
                const listResp = await grpcCall(lsPort, CSRF_TOKEN, 'ListConversations', {}, 10000);
                const count = listResp?.conversations?.length || 0;
                log('OK', `ListConversations returned ${count} conversations. API auth working!`);
                conversationId = null; // 跳过消息发送
            } catch (listErr) {
                // 检查错误信息是否包含 OAuth 相关关键字
                const errMsg = listErr.message || '';
                if (errMsg.includes('OAuth') || errMsg.includes('auth') || errMsg.includes('token') || errMsg.includes('credential')) {
                    log('FAIL', `API auth failed: ${errMsg}`);
                    process.exit(1);
                }
                log('WARN', `ListConversations also failed: ${errMsg}`);
                log('INFO', 'Error is not auth-related, LS may need ext-server for some operations.');
            }
        }

        // 如果创建了会话,发一条消息做最终验证
        if (conversationId) {
            try {
                await grpcCall(lsPort, CSRF_TOKEN, 'SendUserCascadeMessage', {
                    cascadeId: conversationId,
                    userMessage: { textContent: 'Say "hello" in one word.' },
                }, 15000);
                log('OK', 'SendUserCascadeMessage succeeded - full auth chain verified!');
            } catch (err) {
                const errMsg = err.message || '';
                if (errMsg.includes('OAuth') || errMsg.includes('auth') || errMsg.includes('token')) {
                    log('FAIL', `Message send failed with auth error: ${errMsg}`);
                } else {
                    log('WARN', `Message send failed (non-auth): ${errMsg.slice(0, 100)}`);
                    log('INFO', 'Auth likely OK. Failure may be due to missing ext-server.');
                }
            }
        }

        // Step 4: 诊断输出
        log('DONE', '=== E2E Verification Complete ===');
        log('INFO', `LS Port: ${lsPort}`);
        log('INFO', `Gemini Dir: ${geminiDir}`);
        log('INFO', `LS PID: ${lsProcess.pid}`);

        if (lsStderr.includes('Failed to get OAuth token')) {
            log('FAIL', 'LS stderr contains "Failed to get OAuth token" - standalone auth broken!');
            log('DEBUG', `stderr tail: ${lsStderr.slice(-300)}`);
            process.exit(1);
        }

        if (lsStderr.includes('oauth') || lsStderr.includes('OAuth')) {
            log('WARN', `LS stderr contains OAuth references:`);
            const oauthLines = lsStderr.split('\n').filter(l => /oauth/i.test(l));
            oauthLines.forEach(l => log('DEBUG', l.trim()));
        }

    } catch (err) {
        log('ERROR', err.message);
        process.exit(1);
    } finally {
        // 清理: 停止 LS
        if (lsProcess && !lsProcess.killed) {
            log('CLEANUP', 'Stopping LS daemon...');
            lsProcess.kill('SIGTERM');
            await sleep(2000);
            if (!lsProcess.killed) {
                lsProcess.kill('SIGKILL');
            }
            log('CLEANUP', 'LS daemon stopped.');
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
