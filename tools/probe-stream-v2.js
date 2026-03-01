/**
 * probe-stream-v2.js
 *
 * 更精准地探测 stream 中的字段路径和值。
 * 递归解析 protobuf diff 结构，提取所有字段更新（含 stringValue/enumValue/int32Value 等）。
 *
 * 用法: node tools/probe-stream-v2.js
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
 * 递归提取 diff 中所有字段更新（含类型信息）
 */
function extractAllUpdates(obj, path = '') {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    for (const [key, val] of Object.entries(obj)) {
        if (key === 'stringValue') results.push({ path, type: 'string', value: val.slice(0, 100) });
        else if (key === 'enumValue') results.push({ path, type: 'enum', value: val });
        else if (key === 'int32Value') results.push({ path, type: 'int32', value: val });
        else if (key === 'boolValue') results.push({ path, type: 'bool', value: val });
    }

    if (obj.fieldDiffs) {
        for (const fd of obj.fieldDiffs) {
            const newPath = path ? `${path}.f${fd.fieldNumber}` : `f${fd.fieldNumber}`;
            if (fd.updateSingular) {
                results.push(...extractAllUpdates(fd.updateSingular, newPath));
            }
            if (fd.updateRepeated) {
                results.push({ path: newPath, type: 'repeated', newLength: fd.updateRepeated.newLength });
                if (fd.updateRepeated.updateValues) {
                    fd.updateRepeated.updateValues.forEach((v, i) => {
                        const idx = fd.updateRepeated.updateIndices?.[i] ?? i;
                        results.push(...extractAllUpdates(v, `${newPath}[${idx}]`));
                    });
                }
            }
        }
    }

    if (obj.messageValue) {
        results.push(...extractAllUpdates(obj.messageValue, path));
    }

    return results;
}

function subscribeAndLog(port, csrf, cascadeId) {
    const payload = JSON.stringify({
        protocolVersion: 1,
        id: cascadeId,
        subscriberId: `probe-v2-${Date.now()}`,
    });
    const payloadBuf = Buffer.from(payload, 'utf8');
    const envelope = Buffer.alloc(5 + payloadBuf.length);
    envelope[0] = 0x00;
    envelope.writeUInt32BE(payloadBuf.length, 1);
    payloadBuf.copy(envelope, 5);

    let buffer = Buffer.alloc(0);
    let msgCount = 0;

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
            console.log(`[${ts()}] Stream 已建立 (HTTP ${res.statusCode})\n`);

            res.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= 5) {
                    const flags = buffer[0];
                    const len = buffer.readUInt32BE(1);
                    if (buffer.length < 5 + len) break;
                    const body = buffer.slice(5, 5 + len);
                    buffer = buffer.slice(5 + len);
                    msgCount++;
                    if (flags === 2) continue;

                    try {
                        const msg = JSON.parse(body.toString('utf8'));
                        const updates = extractAllUpdates(msg.diff || {});
                        const strings = updates.filter(u => u.type === 'string');

                        const updSummary = updates.map(u => {
                            if (u.type === 'string') return `${u.path}="${u.value.slice(0, 40)}"`;
                            if (u.type === 'enum') return `${u.path}=E${u.value}`;
                            if (u.type === 'int32') return `${u.path}=${u.value}`;
                            if (u.type === 'repeated') return `${u.path}[len=${u.newLength}]`;
                            return `${u.path}=${JSON.stringify(u.value)}`;
                        }).join('  |  ');

                        const isEmpty = updates.length === 0;
                        const hasText = strings.length > 0;
                        const marker = hasText ? ' [TEXT]' : (isEmpty ? ' [EMPTY]' : '');

                        console.log(`#${String(msgCount).padStart(3)} v${msg.version}${marker}  ${updSummary}`);
                    } catch { }
                }
            });

            res.on('end', () => {
                console.log(`\n[${ts()}] Stream 结束, 共 ${msgCount} 条消息`);
            });
        });

        req.on('error', (err) => {
            if (useHttps && err.message.includes('EPROTO')) {
                tryConnect(false);
                return;
            }
            console.error('Stream 错误:', err.message);
        });

        req.write(envelope);
        req.end();
    }

    tryConnect(true);
}

async function main() {
    console.log('== Stream Payload 探测 v2 (字段路径解析) ==\n');

    const ls = discoverLS();
    if (!ls) { console.error('LS 未找到'); process.exit(1); }
    console.log(`LS: port=${ls.port}`);

    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cid = r1.data.cascadeId;
    console.log(`对话: ${cid}\n`);

    subscribeAndLog(ls.port, ls.csrf, cid);
    await new Promise(r => setTimeout(r, 1000));

    const body = buildSendBody(cid, '用一句话回答：天空为什么是蓝色的？', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
    console.log(`\n--- 消息已发送 ---\n`);

    setTimeout(() => {
        console.log(`\n[${ts()}] 完成`);
        process.exit(0);
    }, 30000);
}

main().catch(err => { console.error(err); process.exit(1); });
