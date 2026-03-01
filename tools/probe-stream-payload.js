/**
 * probe-stream-payload.js
 *
 * 探测 StreamCascadeReactiveUpdates 的完整 payload 结构。
 * 创建新对话 → 订阅 stream → 发消息 → 打印每条 stream 消息的完整 JSON。
 *
 * 用法: node tools/probe-stream-payload.js
 * 注意: 会创建一个新对话并发送一条消息，消耗少量配额。
 */

const https = require('https');
const http = require('http');
const { discoverLS, grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService/StreamCascadeReactiveUpdates';

function ts() {
    return new Date().toISOString().slice(11, 23);
}

/**
 * 连接 stream 并打印每条消息的完整 JSON
 */
function subscribeAndLog(port, csrf, cascadeId) {
    const payload = JSON.stringify({
        protocolVersion: 1,
        id: cascadeId,
        subscriberId: `probe-${Date.now()}`,
    });
    const payloadBuf = Buffer.from(payload, 'utf8');

    // Connect Streaming envelope
    const envelope = Buffer.alloc(5 + payloadBuf.length);
    envelope[0] = 0x00;
    envelope.writeUInt32BE(payloadBuf.length, 1);
    payloadBuf.copy(envelope, 5);

    let buffer = Buffer.alloc(0);
    let msgCount = 0;

    function tryConnect(useHttps) {
        const mod = useHttps ? https : http;
        const proto = useHttps ? 'HTTPS' : 'HTTP';

        console.log(`[${ts()}] 尝试 ${proto} 连接 stream...`);

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
            console.log(`[${ts()}] Stream 已建立 (${proto}, HTTP ${res.statusCode})`);

            res.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= 5) {
                    const flags = buffer[0];
                    const len = buffer.readUInt32BE(1);
                    if (buffer.length < 5 + len) break;

                    const body = buffer.slice(5, 5 + len);
                    buffer = buffer.slice(5 + len);

                    msgCount++;

                    if (flags === 2) {
                        console.log(`\n[${ts()}] === 消息 #${msgCount} (TRAILER, flags=2) ===`);
                        console.log(body.toString('utf8'));
                        continue;
                    }

                    try {
                        const msg = JSON.parse(body.toString('utf8'));
                        console.log(`\n[${ts()}] === 消息 #${msgCount} (flags=${flags}) ===`);

                        const keys = Object.keys(msg);
                        console.log(`  顶层字段: [${keys.join(', ')}]`);

                        const fullJson = JSON.stringify(msg, null, 2);
                        if (fullJson.length > 2000) {
                            console.log(fullJson.slice(0, 1500));
                            console.log(`  ... (截断, 完整长度 ${fullJson.length} 字符)`);
                        } else {
                            console.log(fullJson);
                        }
                    } catch (e) {
                        console.log(`\n[${ts()}] === 消息 #${msgCount} (非JSON, flags=${flags}) ===`);
                        console.log(body.toString('utf8').slice(0, 500));
                    }
                }
            });

            res.on('end', () => {
                console.log(`\n[${ts()}] Stream 结束, 共收到 ${msgCount} 条消息`);
            });
        });

        req.on('error', (err) => {
            if (useHttps && (err.message.includes('EPROTO') || err.message.includes('wrong version'))) {
                console.log(`[${ts()}] HTTPS 失败, 回退 HTTP...`);
                tryConnect(false);
                return;
            }
            console.error(`[${ts()}] Stream 错误:`, err.message);
        });

        req.write(envelope);
        req.end();

        return req;
    }

    return tryConnect(true);
}

async function main() {
    console.log('==================================================');
    console.log('  Stream Payload 探测 (完整 JSON)');
    console.log('==================================================\n');

    const ls = discoverLS();
    if (!ls) {
        console.error('LS 未找到');
        process.exit(1);
    }
    console.log(`[${ts()}] LS: port=${ls.port} pid=${ls.pid}`);

    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cascadeId = r1.data.cascadeId;
    console.log(`[${ts()}] 新对话: ${cascadeId}`);

    subscribeAndLog(ls.port, ls.csrf, cascadeId);
    await new Promise(r => setTimeout(r, 1000));

    const body = buildSendBody(cascadeId, '用一句话回答：1+1等于几？', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
    console.log(`\n[${ts()}] 消息已发送, 等待 stream 推送...\n`);

    setTimeout(() => {
        console.log(`\n[${ts()}] 探测结束`);
        process.exit(0);
    }, 30000);
}

main().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
