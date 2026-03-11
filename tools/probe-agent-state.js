/**
 * probe-agent-state.js — 深入探测 StreamAgentStateUpdates 的完整 payload
 *
 * 重点关注: mainTrajectoryUpdate.stepsUpdate 是否包含完整 step 文本内容
 */

const https = require('https');
const http = require('http');
const { discoverLS, grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates';

function ts() { return new Date().toISOString().slice(11, 23); }

function connectAgentStream(port, csrf, cascadeId) {
    return new Promise((resolve) => {
        const messages = [];
        const payload = JSON.stringify({
            conversationId: cascadeId,
            subscriberId: `probe-deep-${Date.now()}`,
        });
        const payloadBuf = Buffer.from(payload, 'utf8');
        const envelope = Buffer.alloc(5 + payloadBuf.length);
        envelope[0] = 0x00;
        envelope.writeUInt32BE(payloadBuf.length, 1);
        payloadBuf.copy(envelope, 5);

        let buffer = Buffer.alloc(0);
        let msgCount = 0;

        const timer = setTimeout(() => {
            console.log(`\n[${ts()}] 25s 超时, 共 ${msgCount} 条消息`);
            resolve(messages);
        }, 25000);

        function tryConnect(useHttps) {
            const mod = useHttps ? https : http;
            const req = mod.request({
                hostname: '127.0.0.1',
                port,
                path: SERVICE_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/connect+json',
                    'x-codeium-csrf-token': csrf,
                    'connect-protocol-version': '1',
                },
                rejectUnauthorized: false,
            }, (res) => {
                console.log(`[${ts()}] Stream 建立 (HTTP ${res.statusCode})\n`);

                res.on('data', (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);
                    while (buffer.length >= 5) {
                        const flags = buffer[0];
                        const len = buffer.readUInt32BE(1);
                        if (buffer.length < 5 + len) break;
                        const body = buffer.slice(5, 5 + len);
                        buffer = buffer.slice(5 + len);
                        msgCount++;
                        if (flags === 2) { continue; }

                        try {
                            const msg = JSON.parse(body.toString('utf8'));
                            messages.push(msg);
                            const u = msg.update || {};

                            // 状态摘要
                            const statusLine = `status=${u.status} exec=${u.executableStatus} loop=${u.executorLoopStatus}`;

                            // stepsUpdate 详情
                            const su = u.mainTrajectoryUpdate?.stepsUpdate;
                            let stepInfo = '';
                            if (su && su.steps && su.steps.length > 0) {
                                for (let i = 0; i < su.steps.length; i++) {
                                    const step = su.steps[i];
                                    const idx = su.indices?.[i] ?? '?';
                                    const type = step.type || '?';

                                    // 提取文本内容
                                    let text = '';
                                    if (step.userInput?.text) text = step.userInput.text;
                                    if (step.plannerResponse?.response) text = step.plannerResponse.response;
                                    if (step.error?.message) text = step.error.message;

                                    const textPreview = text ? ` "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"` : '';
                                    const stepStatus = step.status || '?';
                                    stepInfo += `\n    step[${idx}] type=${type} status=${stepStatus}${textPreview}`;
                                }
                            }

                            // generatorMetadatasUpdate 详情
                            const gmu = u.mainTrajectoryUpdate?.generatorMetadatasUpdate;
                            let metaInfo = '';
                            if (gmu && gmu.generatorMetadatas) {
                                for (const gm of gmu.generatorMetadatas) {
                                    const model = gm.chatModel?.model || '?';
                                    const input = gm.chatModel?.usage?.inputTokens || '?';
                                    const output = gm.chatModel?.usage?.outputTokens || '?';
                                    metaInfo += `\n    metadata: model=${model} input=${input} output=${output}`;
                                }
                            }

                            const extra = stepInfo || metaInfo || '';
                            console.log(`#${String(msgCount).padStart(2)} ${statusLine}${extra}`);
                        } catch (e) {
                            console.log(`#${String(msgCount).padStart(2)} [parse error] ${e.message}`);
                        }
                    }
                });

                res.on('end', () => {
                    clearTimeout(timer);
                    resolve(messages);
                });
            });

            req.on('error', (err) => {
                if (useHttps && err.message.includes('EPROTO')) { tryConnect(false); return; }
                console.error('连接错误:', err.message);
                clearTimeout(timer);
                resolve(messages);
            });

            req.write(envelope);
            req.end();
        }

        tryConnect(true);
    });
}

async function main() {
    console.log('== StreamAgentStateUpdates 深度探测 ==\n');

    const ls = discoverLS();
    if (!ls) { console.error('LS 未找到'); process.exit(1); }
    console.log(`LS: port=${ls.port}\n`);

    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cascadeId = r1.data.cascadeId;
    console.log(`对话: ${cascadeId}\n`);

    // 先建立 stream
    const streamPromise = connectAgentStream(ls.port, ls.csrf, cascadeId);

    // 等 stream 建立
    await new Promise(r => setTimeout(r, 1500));

    // 发消息
    console.log('--- 发送消息 ---\n');
    const body = buildSendBody(cascadeId, '用一句话回答：地球到月球的距离是多少？', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);

    const messages = await streamPromise;

    // 打印最后一条包含完整 step 的消息
    console.log('\n== 最后一条含 steps 的完整消息 (JSON) ==\n');
    for (let i = messages.length - 1; i >= 0; i--) {
        const su = messages[i].update?.mainTrajectoryUpdate?.stepsUpdate;
        if (su?.steps?.length > 0) {
            console.log(JSON.stringify(messages[i], null, 2).slice(0, 3000));
            break;
        }
    }

    // 清理
    try {
        await grpcCall(ls.port, ls.csrf, 'DeleteCascadeTrajectory', { cascadeId });
        console.log('\n[清理] 对话已删除');
    } catch { }

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
