/**
 * dump-latest-raw.js — 转储最新对话的原始 protobuf 解码结果
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'latest-raw-dump.txt');

// ========== Protobuf 解码工具 ==========
function decodeVarint(buf, offset) {
    let result = 0, shift = 0, pos = offset;
    while (pos < buf.length) {
        const byte = buf[pos++];
        result |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 49) throw new Error('varint too long');
    }
    return { value: result, bytesRead: pos - offset };
}

function decodeMessage(buf, depth = 0) {
    const fields = [];
    let pos = 0;
    while (pos < buf.length) {
        try {
            const tag = decodeVarint(buf, pos);
            const fieldNumber = tag.value >> 3;
            const wireType = tag.value & 0x7;
            pos += tag.bytesRead;
            if (fieldNumber === 0) break;

            switch (wireType) {
                case 0: {
                    const val = decodeVarint(buf, pos);
                    fields.push({ fn: fieldNumber, wt: wireType, val: val.value });
                    pos += val.bytesRead;
                    break;
                }
                case 2: {
                    const len = decodeVarint(buf, pos);
                    pos += len.bytesRead;
                    if (pos + len.value > buf.length) throw new Error('overflow');
                    const data = buf.slice(pos, pos + len.value);

                    // 尝试解析为字符串
                    let str = null;
                    try {
                        const s = data.toString('utf-8');
                        const ok = [...s].every(c => c.charCodeAt(0) >= 0x20 || c === '\n' || c === '\r' || c === '\t');
                        if (ok && s.length > 0) str = s;
                    } catch { }

                    // 尝试递归解析为 submessage
                    let sub = null;
                    if (depth < 6) {
                        try {
                            const subFields = decodeMessage(data, depth + 1);
                            if (subFields.length > 0) sub = subFields;
                        } catch { }
                    }

                    fields.push({
                        fn: fieldNumber, wt: wireType,
                        raw: data,
                        str: str,
                        sub: sub,
                        len: data.length
                    });
                    pos += len.value;
                    break;
                }
                case 1: { pos += 8; break; }
                case 5: { pos += 4; break; }
                default: throw new Error(`bad wt ${wireType}`);
            }
        } catch { break; }
    }
    return fields;
}

function printFields(fields, indent = '', lines) {
    for (const f of fields) {
        if (f.wt === 0) {
            // varint
            let extra = '';
            if (f.val > 1700000000 && f.val < 2100000000) {
                extra = `  (timestamp: ${new Date(f.val * 1000).toISOString()})`;
            }
            lines.push(`${indent}field${f.fn} [varint]: ${f.val}${extra}`);
        } else if (f.wt === 2) {
            if (f.str && f.str.length < 500) {
                lines.push(`${indent}field${f.fn} [bytes, ${f.len}B]: "${f.str}"`);
            } else if (f.str) {
                lines.push(`${indent}field${f.fn} [bytes, ${f.len}B]: "${f.str.substring(0, 200)}..."`);
            } else {
                lines.push(`${indent}field${f.fn} [bytes, ${f.len}B]: <binary>`);
            }

            if (f.sub) {
                lines.push(`${indent}  ↳ submessage (${f.sub.length} fields):`);
                printFields(f.sub, indent + '    ', lines);
            }

            // 尝试 base64 解码
            if (f.str && /^[A-Za-z0-9+/=]+$/.test(f.str) && f.str.length > 10) {
                try {
                    const decoded = Buffer.from(f.str, 'base64');
                    const subFields = decodeMessage(decoded);
                    if (subFields.length > 0) {
                        lines.push(`${indent}  ↳ base64 → submessage (${subFields.length} fields):`);
                        printFields(subFields, indent + '    ', lines);
                    }
                } catch { }
            }
        }
    }
}

// ========== Main ==========
const dbPath = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const lines = [];
const log = (line) => { console.log(line); lines.push(line); };

try {
    // 获取最新对话列表
    const { getConversations } = require('../lib/conversations');
    const result = getConversations();
    const latest = result.conversations[0];

    log('='.repeat(80));
    log(`最新对话: "${latest.title}"`);
    log(`UUID: ${latest.id}`);
    log(`工作区: ${latest.workspace}`);
    log(`创建时间: ${latest.createdAt}`);
    log(`更新时间: ${latest.updatedAt}`);
    log(`步骤数: ${latest.stepCount}`);
    log('='.repeat(80));
    log('');

    // 读取 trajectorySummaries 
    const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
    if (trajRow) {
        const buf = Buffer.from(trajRow.value, 'base64');
        const topFields = decodeMessage(buf);

        // 找到包含最新 UUID 的 entry
        log('━━━ trajectorySummaries 中最新对话的完整 protobuf 解码 ━━━');
        for (const tf of topFields) {
            if (tf.wt !== 2) continue;
            if (!tf.sub) continue;

            // 检查是否包含目标 UUID
            let hasUuid = false;
            for (const sf of tf.sub) {
                if (sf.str && sf.str === latest.id) {
                    hasUuid = true;
                    break;
                }
            }

            if (hasUuid) {
                log('');
                printFields([tf], '', lines);
                log('');
                break;
            }
        }
    }

    // 读取 agentManagerInitState (如果存在)
    const managerRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('jetskiStateSync.agentManagerInitState');
    if (managerRow) {
        const buf = Buffer.from(managerRow.value, 'base64');
        const topFields = decodeMessage(buf);

        log('━━━ agentManagerInitState 中最新对话的完整 protobuf 解码 ━━━');
        for (const tf of topFields) {
            if (tf.wt !== 2) continue;
            if (!tf.sub) continue;

            let hasUuid = false;
            for (const sf of tf.sub) {
                if (sf.str && sf.str === latest.id) {
                    hasUuid = true;
                    break;
                }
            }

            if (hasUuid) {
                log('');
                printFields([tf], '', lines);
                log('');
                break;
            }
        }
    } else {
        log('');
        log('jetskiStateSync.agentManagerInitState 不存在');
    }

    // 额外：列出最新 5 个对话的摘要信息
    log('');
    log('━━━ 最新 5 个对话 ━━━');
    for (let i = 0; i < Math.min(5, result.conversations.length); i++) {
        const c = result.conversations[i];
        log(`${i + 1}. [${c.updatedAt}] "${c.title}" (${c.stepCount} steps) — ${c.workspace || '无工作区'}`);
    }

} finally {
    db.close();
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log('');
console.log('✅ 已保存到:', outputFile);
