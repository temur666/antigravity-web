#!/usr/bin/env node
/**
 * decode-deep.js — 解码 jetskiStateSync.agentManagerInitState
 * field10 才是对话列表 (196 条)
 */

const Database = require('better-sqlite3');
const path = require('path');

const homeDir = process.env.USERPROFILE || '';
const globalDb = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');

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
                case 1: { fields.push({ fn: fieldNumber, wt: wireType, val: buf.slice(pos, pos + 8) }); pos += 8; break; }
                case 5: { fields.push({ fn: fieldNumber, wt: wireType, val: buf.slice(pos, pos + 4) }); pos += 4; break; }
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

function dumpFields(buf, depth, maxDepth) {
    if (depth > maxDepth || !Buffer.isBuffer(buf)) return;
    const indent = '  '.repeat(depth);
    const fields = decodeMessage(buf);
    for (const f of fields) {
        if (f.wt === 0) {
            console.log(`${indent}f${f.fn}(varint): ${f.val}`);
        } else if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str && str.length < 200) {
                console.log(`${indent}f${f.fn}(str ${f.val.length}B): "${str}"`);
            } else {
                const nested = decodeMessage(f.val);
                if (nested.length > 0 && nested[nested.length - 1]) {
                    console.log(`${indent}f${f.fn}(msg ${f.val.length}B):`);
                    dumpFields(f.val, depth + 1, maxDepth);
                } else {
                    console.log(`${indent}f${f.fn}(bytes ${f.val.length}B): ${f.val.slice(0, 30).toString('hex')}...`);
                }
            }
        }
    }
}

function main() {
    console.log('\n🔬 Deep Protobuf Decoder v2\n');
    const db = new Database(globalDb, { readonly: true });

    const row = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('jetskiStateSync.agentManagerInitState');
    if (!row) { console.log('NOT FOUND'); return; }

    const buf = Buffer.from(row.value, 'base64');
    const topFields = decodeMessage(buf);

    // 先看 field10 的第一个item结构
    const field10s = topFields.filter(f => f.fn === 10);
    console.log(`field10 (对话) 数量: ${field10s.length}\n`);

    // 深度 dump 前2个 field10
    console.log('═'.repeat(70));
    console.log('field10[0] 完整结构:');
    console.log('─'.repeat(70));
    if (field10s[0]) dumpFields(field10s[0].val, 0, 4);

    console.log('\n' + '═'.repeat(70));
    console.log('field10[1] 完整结构:');
    console.log('─'.repeat(70));
    if (field10s[1]) dumpFields(field10s[1].val, 0, 4);

    // 解析所有对话
    console.log('\n\n' + '═'.repeat(70));
    console.log('所有对话列表:');
    console.log('─'.repeat(70));

    const conversations = [];
    for (const f10 of field10s) {
        const conv = parseField10(f10.val);
        if (conv) conversations.push(conv);
    }

    // 按时间排序
    conversations.sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));

    conversations.forEach((c, i) => {
        const updated = c.updatedTs ? new Date(c.updatedTs * 1000).toISOString().replace('T', ' ').substring(0, 19) : '?';
        console.log(`[${i}] ${c.title || '(无标题)'}`);
        console.log(`     ID: ${c.id}  Steps: ${c.stepCount}  Updated: ${updated}`);
        if (c.workspace) console.log(`     WS: ${c.workspace}`);
    });

    console.log(`\n总计: ${conversations.length} 个对话`);
    console.log(`有标题: ${conversations.filter(c => c.title).length}`);

    db.close();
}

function parseField10(buf) {
    const fields = decodeMessage(buf);
    const conv = { id: '', title: '', stepCount: 0, workspace: '', createdTs: 0, updatedTs: 0 };

    for (const f of fields) {
        // 尝试找 UUID
        if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str && str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
                conv.id = str;
                continue;
            }

            // 尝试解析为嵌套消息
            const nested = decodeMessage(f.val);
            if (nested.length > 0) {
                // 从嵌套消息中提取标题
                for (const nf of nested) {
                    if (nf.wt === 2) {
                        const ns = tryStr(nf.val);
                        if (ns) {
                            // 先尝试 base64
                            try {
                                const decoded = Buffer.from(ns, 'base64').toString('utf-8');
                                const printable = [...decoded].every(c => c.charCodeAt(0) >= 0x20 || c === '\n');
                                if (printable && decoded.length >= 3 && decoded.length < 200) {
                                    if (!conv.title) conv.title = decoded;
                                    continue;
                                }
                            } catch { }
                            // Raw text as title (5-100 chars, looks like title)
                            if (!conv.title && ns.length >= 5 && ns.length < 150 && !ns.includes('://') && !ns.includes('\\')) {
                                conv.title = ns;
                            }
                        }

                        // 递归查找workspace和timestamp
                        const nn = decodeMessage(nf.val);
                        for (const nnf of nn) {
                            if (nnf.wt === 2) {
                                const s = tryStr(nnf.val);
                                if (s && s.includes('://')) {
                                    if (!conv.workspace) conv.workspace = s;
                                }
                            }
                            if (nnf.wt === 0 && nnf.val > 1700000000 && nnf.val < 2000000000) {
                                if (nnf.val > conv.updatedTs) conv.updatedTs = nnf.val;
                                if (!conv.createdTs || nnf.val < conv.createdTs) conv.createdTs = nnf.val;
                            }
                        }
                    }
                    if (nf.wt === 0) {
                        if (nf.fn === 2) conv.stepCount = nf.val;
                        if (nf.val > 1700000000 && nf.val < 2000000000) {
                            if (nf.val > conv.updatedTs) conv.updatedTs = nf.val;
                        }
                    }
                }
            }
        }
    }
    return conv.id ? conv : null;
}

main();
