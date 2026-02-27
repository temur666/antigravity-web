/**
 * final-dump.js — 把最新对话的所有原始数据整合输出到文件
 * 包括: 对话列表元数据 + protobuf 解码 + 原始 hex/base64
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { getConversations, getDbPath } = require('../lib/conversations');

const outputFile = path.join(__dirname, 'final-dump.txt');

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
                case 0: { const val = decodeVarint(buf, pos); fields.push({ fn: fieldNumber, wt: wireType, val: val.value }); pos += val.bytesRead; break; }
                case 2: { const len = decodeVarint(buf, pos); pos += len.bytesRead; if (pos + len.value > buf.length) throw new Error('overflow'); fields.push({ fn: fieldNumber, wt: wireType, val: buf.slice(pos, pos + len.value) }); pos += len.value; break; }
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

function dumpFields(fields, indent, lines, maxDepth = 8, depth = 0) {
    if (depth > maxDepth) return;
    for (const f of fields) {
        const prefix = `${indent}field${f.fn}`;
        if (f.wt === 0) {
            let extra = '';
            if (f.val > 1700000000 && f.val < 2100000000) extra = `  → ${new Date(f.val * 1000).toISOString()}`;
            lines.push(`${prefix} (varint) = ${f.val}${extra}`);
        } else if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str) {
                lines.push(`${prefix} (string, ${f.val.length}B) = "${str.length < 300 ? str : str.substring(0, 300) + '...'}"`);
                if (/^[A-Za-z0-9+/=\n\r]+$/.test(str.trim()) && str.length > 20) {
                    try {
                        const decoded = Buffer.from(str.replace(/\s/g, ''), 'base64');
                        const sub = decodeMessage(decoded);
                        if (sub.length > 0) {
                            lines.push(`${indent}  ↳ base64 → ${sub.length} fields:`);
                            dumpFields(sub, indent + '    ', lines, maxDepth, depth + 1);
                        }
                    } catch { }
                }
            } else {
                try {
                    const sub = decodeMessage(f.val);
                    if (sub.length > 0) {
                        lines.push(`${prefix} (message, ${f.val.length}B) → ${sub.length} fields:`);
                        dumpFields(sub, indent + '  ', lines, maxDepth, depth + 1);
                    } else {
                        lines.push(`${prefix} (binary, ${f.val.length}B) = ${f.val.toString('hex').substring(0, 200)}`);
                    }
                } catch {
                    lines.push(`${prefix} (binary, ${f.val.length}B) = ${f.val.toString('hex').substring(0, 200)}`);
                }
            }
        }
    }
}

// ========== Main ==========
const lines = [];
const log = (line) => lines.push(line);

const result = getConversations();
const latest = result.conversations[0];

log('═'.repeat(80));
log('ANTIGRAVITY 最新对话原始数据完整转储');
log(`生成时间: ${new Date().toISOString()}`);
log('═'.repeat(80));
log('');

// Part 1: 对话列表
log('┌──────────────────────────────────────────────────────────────────────────────┐');
log('│ Part 1: 对话列表 (最新 10 个，共 ' + result.total + ' 个)');
log('└──────────────────────────────────────────────────────────────────────────────┘');
log('');
for (let i = 0; i < Math.min(10, result.conversations.length); i++) {
    const c = result.conversations[i];
    log(JSON.stringify(c, null, 2));
    log('');
}

// Part 2: 最新对话的 protobuf 解码
log('┌──────────────────────────────────────────────────────────────────────────────┐');
log('│ Part 2: 最新对话 trajectorySummaries protobuf 结构');
log('└──────────────────────────────────────────────────────────────────────────────┘');
log('');

const dbPath = getDbPath();
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
    const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
    if (trajRow) {
        const buf = Buffer.from(trajRow.value, 'base64');
        const topFields = decodeMessage(buf);

        // 找最新的
        for (const tf of topFields) {
            if (tf.wt !== 2) continue;
            const sub = decodeMessage(tf.val);
            let hasUuid = false;
            for (const sf of sub) { if (tryStr(sf.val) === latest.id) { hasUuid = true; break; } }

            if (hasUuid) {
                log(`对话 UUID: ${latest.id}`);
                log(`对话标题: ${latest.title}`);
                log('');
                dumpFields(sub, '', lines);
                log('');
                log('--- 原始 base64 ---');
                log(tf.val.toString('base64'));
                log('');
                log('--- 原始 hex ---');
                log(tf.val.toString('hex'));
                break;
            }
        }
    }

    // Part 3: 所有数据库 key 及其值的长度
    log('');
    log('┌──────────────────────────────────────────────────────────────────────────────┐');
    log('│ Part 3: 全局数据库所有 key 列表');
    log('└──────────────────────────────────────────────────────────────────────────────┘');
    log('');

    const allKeys = db.prepare('SELECT key, value FROM ItemTable ORDER BY key').all();
    for (const row of allKeys) {
        const valLen = typeof row.value === 'string' ? row.value.length : 0;
        log(`${row.key}  (${valLen} bytes)`);
    }

    // Part 4: 完整的 trajectorySummaries base64 原始值
    log('');
    log('┌──────────────────────────────────────────────────────────────────────────────┐');
    log('│ Part 4: trajectorySummaries 原始 base64 值 (完整)');
    log('└──────────────────────────────────────────────────────────────────────────────┘');
    log('');
    if (trajRow) {
        log(trajRow.value);
    }

} finally {
    db.close();
}

// 写入文件
fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log(`✅ 已保存到: ${outputFile} (${lines.length} 行)`);
