/**
 * probe-all-streams.js — 探测 LS 全部 7 个 Stream RPC 的实际输出
 *
 * 用法: node tools/probe-all-streams.js
 *
 * 会创建一个新对话并发送消息以触发流式事件。
 * 每个 Stream 独立连接，打印收到的原始 JSON payload。
 *
 * Stream 列表:
 *   1. StreamCascadeReactiveUpdates        — 单对话 step diff
 *   2. StreamCascadeSummariesReactiveUpdates — 对话列表 summary 变更
 *   3. StreamCascadePanelReactiveUpdates    — UI Panel 状态同步
 *   4. StreamAgentStateUpdates             — Agent 运行状态
 *   5. StreamUserTrajectoryReactiveUpdates  — 用户行为轨迹
 *   6. StreamTerminalShellCommand          — 双向 Terminal I/O
 *   7. HandleStreamingCommand              — 单次命令流式结果
 */

const https = require('https');
const http = require('http');
const { discoverLS, grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const SERVICE_BASE = '/exa.language_server_pb.LanguageServerService';

function ts() {
    return new Date().toISOString().slice(11, 23);
}

// ========== Connect Streaming 通用连接器 ==========

/**
 * 建立 Connect Streaming 连接
 * @param {number} port
 * @param {string} csrf
 * @param {string} rpcName - RPC 方法名
 * @param {object} requestBody - 请求体 JSON
 * @param {string} label - 显示标签
 * @param {number} [timeoutSec=25] - 超时自动关闭
 * @returns {Promise<{messages: Array, error: string|null}>}
 */
function connectStream(port, csrf, rpcName, requestBody, label, timeoutSec = 25) {
    return new Promise((resolve) => {
        const messages = [];
        const path = `${SERVICE_BASE}/${rpcName}`;

        const payload = JSON.stringify(requestBody);
        const payloadBuf = Buffer.from(payload, 'utf8');

        // Connect Streaming envelope: flags(1) + length(4) + data
        const envelope = Buffer.alloc(5 + payloadBuf.length);
        envelope[0] = 0x00; // data frame
        envelope.writeUInt32BE(payloadBuf.length, 1);
        payloadBuf.copy(envelope, 5);

        let buffer = Buffer.alloc(0);
        let msgCount = 0;
        let settled = false;

        function finish(error) {
            if (settled) return;
            settled = true;
            resolve({ messages, error });
        }

        // 超时自动结束
        const timer = setTimeout(() => {
            console.log(`  [${label}] ${timeoutSec}s 超时, 收到 ${msgCount} 条消息`);
            if (req) req.destroy();
            finish(null);
        }, timeoutSec * 1000);

        function tryConnect(useHttps) {
            const mod = useHttps ? https : http;
            const req = mod.request({
                hostname: '127.0.0.1',
                port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/connect+json',
                    'x-codeium-csrf-token': csrf,
                    'connect-protocol-version': '1',
                },
                rejectUnauthorized: false,
            }, (res) => {
                if (res.statusCode !== 200) {
                    const errMsg = `HTTP ${res.statusCode}`;
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => {
                        console.log(`  [${label}] ${errMsg}: ${body.slice(0, 200)}`);
                        clearTimeout(timer);
                        finish(errMsg);
                    });
                    return;
                }

                console.log(`  [${label}] Stream 已建立 (HTTP 200)`);

                res.on('data', (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length >= 5) {
                        const flags = buffer[0];
                        const len = buffer.readUInt32BE(1);
                        if (buffer.length < 5 + len) break;
                        const body = buffer.slice(5, 5 + len);
                        buffer = buffer.slice(5 + len);
                        msgCount++;

                        // flags=2 是 end-of-stream trailer
                        if (flags === 2) {
                            console.log(`  [${label}] #${msgCount} [TRAILER] ${body.toString('utf8').slice(0, 100)}`);
                            continue;
                        }

                        try {
                            const msg = JSON.parse(body.toString('utf8'));
                            messages.push(msg);
                            // 打印摘要
                            const keys = Object.keys(msg);
                            const preview = JSON.stringify(msg).slice(0, 300);
                            console.log(`  [${label}] #${msgCount} keys=[${keys.join(',')}] ${preview}`);
                        } catch {
                            console.log(`  [${label}] #${msgCount} [RAW] ${body.toString('utf8').slice(0, 200)}`);
                        }
                    }
                });

                res.on('end', () => {
                    console.log(`  [${label}] Stream 结束, 共 ${msgCount} 条消息`);
                    clearTimeout(timer);
                    finish(null);
                });
            });

            req.on('error', (err) => {
                if (useHttps && (err.message.includes('EPROTO') || err.message.includes('ERR_SSL'))) {
                    tryConnect(false);
                    return;
                }
                console.log(`  [${label}] 连接错误: ${err.message}`);
                clearTimeout(timer);
                finish(err.message);
            });

            req.write(envelope);
            req.end();
        }

        let req;
        tryConnect(true);
    });
}

// ========== 主流程 ==========

async function main() {
    console.log('========================================');
    console.log('  LS Stream API 全量探测');
    console.log(`  时间: ${new Date().toISOString()}`);
    console.log('========================================\n');

    const ls = discoverLS();
    if (!ls) { console.error('LS 未找到'); process.exit(1); }
    console.log(`LS: port=${ls.port} csrf=${ls.csrf.slice(0, 8)}...\n`);

    // 创建对话
    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cascadeId = r1.data.cascadeId;
    console.log(`对话: ${cascadeId}\n`);

    // ======== 1. StreamCascadeReactiveUpdates ========
    console.log('── 1/7: StreamCascadeReactiveUpdates ──');
    console.log('  (单对话 step-level diff, 使用 reactive_component_pb.StreamReactiveUpdatesRequest)');
    const p1 = connectStream(ls.port, ls.csrf, 'StreamCascadeReactiveUpdates', {
        protocolVersion: 1,
        id: cascadeId,
        subscriberId: `probe-cascade-${Date.now()}`,
    }, 'CascadeUpdates', 20);

    // ======== 2. StreamCascadeSummariesReactiveUpdates ========
    console.log('── 2/7: StreamCascadeSummariesReactiveUpdates ──');
    console.log('  (对话列表 summary 变更, 同类型 Request)');
    const p2 = connectStream(ls.port, ls.csrf, 'StreamCascadeSummariesReactiveUpdates', {
        protocolVersion: 1,
        id: '',  // summary 流不需要指定对话 ID
        subscriberId: `probe-summaries-${Date.now()}`,
    }, 'Summaries', 20);

    // ======== 3. StreamCascadePanelReactiveUpdates ========
    console.log('── 3/7: StreamCascadePanelReactiveUpdates ──');
    console.log('  (UI Panel 状态同步, 同类型 Request)');
    const p3 = connectStream(ls.port, ls.csrf, 'StreamCascadePanelReactiveUpdates', {
        protocolVersion: 1,
        id: cascadeId,
        subscriberId: `probe-panel-${Date.now()}`,
    }, 'Panel', 20);

    // ======== 4. StreamAgentStateUpdates ========
    console.log('── 4/7: StreamAgentStateUpdates ──');
    console.log('  (Agent 运行状态, 使用 jetski_cortex_pb.StreamAgentStateUpdatesRequest)');
    const p4 = connectStream(ls.port, ls.csrf, 'StreamAgentStateUpdates', {
        conversationId: cascadeId,
        subscriberId: `probe-agent-${Date.now()}`,
    }, 'AgentState', 20);

    // ======== 5. StreamUserTrajectoryReactiveUpdates ========
    console.log('── 5/7: StreamUserTrajectoryReactiveUpdates ──');
    console.log('  (用户行为轨迹, 同 ReactiveUpdates 类型)');
    const p5 = connectStream(ls.port, ls.csrf, 'StreamUserTrajectoryReactiveUpdates', {
        protocolVersion: 1,
        id: '',
        subscriberId: `probe-user-traj-${Date.now()}`,
    }, 'UserTrajectory', 20);

    // ======== 6. StreamTerminalShellCommand ========
    console.log('── 6/7: StreamTerminalShellCommand ──');
    console.log('  (双向 Terminal I/O, 使用 TerminalShellCommandStreamChunk)');
    const p6 = connectStream(ls.port, ls.csrf, 'StreamTerminalShellCommand', {
        header: {
            terminalId: `probe-term-${Date.now()}`,
            shellPid: 0,
            commandLine: 'echo hello',
            cwd: '/tmp',
        }
    }, 'Terminal', 10);

    // ======== 7. HandleStreamingCommand ========
    console.log('── 7/7: HandleStreamingCommand ──');
    console.log('  (单次命令流式结果, 使用 HandleStreamingCommandRequest)');
    const p7 = connectStream(ls.port, ls.csrf, 'HandleStreamingCommand', {
        commandText: 'hello',
    }, 'StreamingCmd', 10);

    // 等所有 stream 建立 1 秒后发消息
    await new Promise(r => setTimeout(r, 2000));
    console.log('\n--- 发送消息触发事件 ---');
    const body = buildSendBody(cascadeId, '回答：1+1等于几？只说结果。', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
    console.log('--- 消息已发送, 等待各 Stream 响应... ---\n');

    // 等待所有 stream 结束
    const results = await Promise.all([p1, p2, p3, p4, p5, p6, p7]);

    // ======== 汇总 ========
    console.log('\n========================================');
    console.log('  汇总');
    console.log('========================================');
    const names = [
        'StreamCascadeReactiveUpdates',
        'StreamCascadeSummariesReactiveUpdates',
        'StreamCascadePanelReactiveUpdates',
        'StreamAgentStateUpdates',
        'StreamUserTrajectoryReactiveUpdates',
        'StreamTerminalShellCommand',
        'HandleStreamingCommand',
    ];
    for (let i = 0; i < names.length; i++) {
        const r = results[i];
        const status = r.error ? `ERROR: ${r.error}` : `${r.messages.length} 条消息`;
        console.log(`  ${i + 1}. ${names[i].padEnd(45)} → ${status}`);
    }

    // 清理对话
    try {
        await grpcCall(ls.port, ls.csrf, 'DeleteCascadeTrajectory', { cascadeId });
        console.log(`\n[清理] 对话已删除`);
    } catch { }

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
