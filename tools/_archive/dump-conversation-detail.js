/**
 * dump-conversation-detail.js — 转储指定对话的完整原始 protobuf 结构到文件
 * 
 * 找到 trajectorySummaries 中该对话的完整编码，以及所有可能的数据
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { getConversations, getDbPath } = require('../lib/conversations');

const outputFile = path.join(__dirname, 'conversation-detail-dump.txt');

// ========== Protobuf 工具 ==========
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

function decodeMessage(buf) {
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
                    fields.push({ fn: fieldNumber, wt: wireType, val: buf.slice(pos, pos + len.value) });
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

function tryStr(buf) {
    if (!Buffer.isBuffer(buf)) return null;
    const str = buf.toString('utf-8');
    const ok = [...str].every(c => c.charCodeAt(0) >= 0x20 || c === '\n' || c === '\r' || c === '\t');
    return ok && str.length > 0 ? str : null;
}

function dumpFields(fields, indent, lines) {
    for (const f of fields) {
        const prefix = `${indent}field${f.fn}`;
        if (f.wt === 0) {
            let extra = '';
            if (f.val > 1700000000 && f.val < 2100000000) {
                extra = `  → ${new Date(f.val * 1000).toISOString()}`;
            }
            lines.push(`${prefix} (varint) = ${f.val}${extra}`);
        } else if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str) {
                if (str.length < 200) {
                    lines.push(`${prefix} (string, ${f.val.length}B) = "${str}"`);
                } else {
                    lines.push(`${prefix} (string, ${f.val.length}B) = "${str.substring(0, 200)}..."`);
                }
                // 如果是 base64, 尝试解码
                if (/^[A-Za-z0-9+/=\n\r]+$/.test(str.trim()) && str.length > 20) {
                    try {
                        const decoded = Buffer.from(str.replace(/\s/g, ''), 'base64');
                        const subFields = decodeMessage(decoded);
                        if (subFields.length > 0) {
                            lines.push(`${indent}  ↳ base64 decoded → ${subFields.length} fields:`);
                            dumpFields(subFields, indent + '    ', lines);
                        }
                    } catch { }
                }
            } else {
                // 尝试作为 submessage
                try {
                    const sub = decodeMessage(f.val);
                    if (sub.length > 0) {
                        lines.push(`${prefix} (message, ${f.val.length}B) → ${sub.length} fields:`);
                        dumpFields(sub, indent + '  ', lines);
                    } else {
                        lines.push(`${prefix} (binary, ${f.val.length}B) = ${f.val.toString('hex').substring(0, 100)}`);
                    }
                } catch {
                    lines.push(`${prefix} (binary, ${f.val.length}B) = ${f.val.toString('hex').substring(0, 100)}`);
                }
            }
        }
    }
}

// ========== Main ==========
const lines = [];
const log = (line) => { console.log(line); lines.push(line); };

const result = getConversations();
log('='.repeat(80));
log('最新 10 个对话列表:');
log('='.repeat(80));
for (let i = 0; i < Math.min(10, result.conversations.length); i++) {
    const c = result.conversations[i];
    log(`${i + 1}. [${c.updatedAt}] "${c.title}" (${c.stepCount} steps) — ${c.workspace || '(none)'} — ${c.id}`);
}
log('');

// 选择有内容的第二个对话（35 步）
const targetIdx = 1; // 第 2 个
const target = result.conversations[targetIdx];
log('━'.repeat(80));
log(`目标对话 #${targetIdx + 1}:`);
log(`  标题: ${target.title}`);
log(`  UUID: ${target.id}`);
log(`  步骤: ${target.stepCount}`);
log(`  工作区: ${target.workspace}`);
log(`  更新: ${target.updatedAt}`);
log('━'.repeat(80));
log('');

const dbPath = getDbPath();
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
    // 从 trajectorySummaries 中提取该对话的完整 protobuf
    const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
    if (trajRow) {
        const buf = Buffer.from(trajRow.value, 'base64');
        const topFields = decodeMessage(buf);

        log('━━━ trajectorySummaries 完整 protobuf 解码 ━━━');
        log('');

        for (const tf of topFields) {
            if (tf.wt !== 2) continue;
            const sub = decodeMessage(tf.val);

            // 检查是否包含目标 UUID
            let hasUuid = false;
            for (const sf of sub) {
                const str = tryStr(sf.val);
                if (str === target.id) { hasUuid = true; break; }
            }

            if (hasUuid) {
                log(`entry (${tf.val.length}B):`);
                dumpFields(sub, '  ', lines);
                log('');

                // 打印原始 hex
                log('原始 entry hex:');
                log(tf.val.toString('hex'));
                log('');

                // 打印原始 base64
                log('原始 entry base64:');
                log(tf.val.toString('base64'));
                log('');
                break;
            }
        }
    }

} finally {
    db.close();
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log('');
console.log('✅ 已保存到:', outputFile);
