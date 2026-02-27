#!/usr/bin/env node
/**
 * decode-protobuf.js — 手动解码 protobuf 格式的对话数据
 * 
 * Protobuf wire types:
 *   0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit
 */

const Database = require('better-sqlite3');
const path = require('path');

const homeDir = process.env.USERPROFILE || '';
const globalDb = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');

// ========== Protobuf 低级解码器 ==========

function decodeVarint(buf, offset) {
    let result = 0;
    let shift = 0;
    let pos = offset;
    while (pos < buf.length) {
        const byte = buf[pos++];
        result |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 35) throw new Error('varint too long');
    }
    return { value: result, bytesRead: pos - offset };
}

function decodeField(buf, offset) {
    if (offset >= buf.length) return null;
    const tag = decodeVarint(buf, offset);
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;
    let pos = offset + tag.bytesRead;

    switch (wireType) {
        case 0: { // varint
            const val = decodeVarint(buf, pos);
            return { fieldNumber, wireType, value: val.value, end: pos + val.bytesRead };
        }
        case 1: { // 64-bit
            return { fieldNumber, wireType, value: buf.readBigInt64LE(pos), end: pos + 8 };
        }
        case 2: { // length-delimited
            const len = decodeVarint(buf, pos);
            pos += len.bytesRead;
            const data = buf.slice(pos, pos + len.value);
            return { fieldNumber, wireType, value: data, length: len.value, end: pos + len.value };
        }
        case 5: { // 32-bit
            return { fieldNumber, wireType, value: buf.readInt32LE(pos), end: pos + 4 };
        }
        default:
            throw new Error(`Unknown wire type ${wireType} at offset ${offset}`);
    }
}

function decodeMessage(buf) {
    const fields = [];
    let pos = 0;
    while (pos < buf.length) {
        try {
            const field = decodeField(buf, pos);
            if (!field) break;
            fields.push(field);
            pos = field.end;
        } catch (e) {
            break;
        }
    }
    return fields;
}

// 尝试把 Buffer 解析为 UTF-8 字符串（如果看起来像文本）
function tryString(buf) {
    if (!Buffer.isBuffer(buf)) return null;
    const str = buf.toString('utf-8');
    // 检查是否是可打印文本
    const printable = str.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f]/g, '');
    if (printable.length > str.length * 0.7 && str.length > 0) return str;
    return null;
}

// 尝试递归解码嵌套消息
function tryDecodeNested(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 2) return null;
    try {
        const fields = decodeMessage(buf);
        if (fields.length === 0) return null;
        // 验证解码是否覆盖了大部分数据
        const lastEnd = fields[fields.length - 1].end;
        if (lastEnd < buf.length * 0.8) return null;
        return fields;
    } catch {
        return null;
    }
}

// ========== 对话解析 ==========

function parseConversation(buf) {
    const fields = decodeMessage(buf);
    const conv = { id: '', title: '', stepCount: 0, workspace: '', createdAt: null, updatedAt: null };

    for (const f of fields) {
        if (f.wireType === 2) {
            const str = tryString(f.value);
            if (f.fieldNumber === 1 && str && str.match(/^[0-9a-f-]{36}$/)) {
                conv.id = str;
            } else if (f.fieldNumber === 2) {
                // 嵌套消息 - 对话详情
                const nested = tryDecodeNested(f.value);
                if (nested) {
                    for (const nf of nested) {
                        if (nf.wireType === 2) {
                            const ns = tryString(nf.value);
                            if (nf.fieldNumber === 1 && ns) {
                                // 这可能是 base64 编码的标题
                                try {
                                    const decoded = Buffer.from(ns, 'base64').toString('utf-8');
                                    if (decoded.length > 2 && decoded.length < 200) {
                                        conv.title = decoded;
                                    }
                                } catch {
                                    if (ns.length < 200) conv.title = ns;
                                }
                            }
                        }
                        if (nf.wireType === 0 && nf.fieldNumber === 2) {
                            conv.stepCount = nf.value;
                        }
                    }
                    // 深入解析工作区和时间戳
                    for (const nf of nested) {
                        if (nf.wireType === 2 && nf.fieldNumber === 9) {
                            // workspace
                            const wsNested = tryDecodeNested(nf.value);
                            if (wsNested) {
                                for (const wf of wsNested) {
                                    const ws = tryString(wf.value);
                                    if (ws && ws.includes('/')) {
                                        conv.workspace = ws;
                                        break;
                                    }
                                }
                            }
                        }
                        if (nf.wireType === 2) {
                            // 查找时间戳（嵌套的 varint）
                            const tsNested = tryDecodeNested(nf.value);
                            if (tsNested) {
                                for (const tf of tsNested) {
                                    if (tf.wireType === 0 && tf.value > 1700000000 && tf.value < 2000000000) {
                                        // Unix timestamp in seconds
                                        if (!conv.createdAt) conv.createdAt = tf.value;
                                        conv.updatedAt = tf.value;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return conv;
}

// ========== 主旋律: 解码 trajectorySummaries ==========

function main() {
    console.log('\n🔬 Protobuf Decoder for Antigravity Conversations\n');

    const db = new Database(globalDb, { readonly: true });

    // ---- trajectorySummaries ----
    console.log('═'.repeat(70));
    console.log('解码 antigravityUnifiedStateSync.trajectorySummaries');
    console.log('─'.repeat(70));

    const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
    if (!trajRow) { console.log('  NOT FOUND'); db.close(); return; }

    const trajBuf = Buffer.from(trajRow.value, 'base64');
    console.log(`  解码后大小: ${trajBuf.length} bytes\n`);

    // 顶层消息解码
    const topFields = decodeMessage(trajBuf);
    console.log(`  顶层字段数: ${topFields.length}`);

    // 每个顶层字段应该是一个对话记录
    const conversations = [];
    for (const tf of topFields) {
        if (tf.wireType === 2 && tf.fieldNumber === 1) {
            const conv = parseConversation(tf.value);
            conversations.push(conv);
        }
    }

    console.log(`  解析出 ${conversations.length} 个对话\n`);

    // 显示前30个对话
    console.log('  前30个对话:');
    conversations.slice(0, 30).forEach((c, i) => {
        const time = c.updatedAt ? new Date(c.updatedAt * 1000).toISOString().replace('T', ' ').substring(0, 19) : '?';
        console.log(`  [${i}] ${c.title || '(无标题)'}`);
        console.log(`       ID: ${c.id}  Steps: ${c.stepCount}  Time: ${time}`);
        if (c.workspace) console.log(`       WS: ${c.workspace}`);
    });

    // 统计
    const titled = conversations.filter(c => c.title);
    const withWs = conversations.filter(c => c.workspace);
    console.log(`\n  统计: ${conversations.length} 总数, ${titled.length} 有标题, ${withWs.length} 有工作区`);

    // --- 深入分析第一个对话的完整结构 ---
    if (topFields.length > 0 && topFields[0].wireType === 2) {
        console.log('\n\n' + '═'.repeat(70));
        console.log('第一个对话的完整 protobuf 结构');
        console.log('─'.repeat(70));
        dumpFields(topFields[0].value, 0, 3);
    }

    db.close();
    console.log('\n' + '═'.repeat(70));
    console.log('🏁 完成\n');
}

function dumpFields(buf, depth, maxDepth) {
    if (depth > maxDepth) return;
    const indent = '  '.repeat(depth + 1);
    const fields = decodeMessage(buf);
    for (const f of fields) {
        if (f.wireType === 0) {
            console.log(`${indent}field${f.fieldNumber} (varint): ${f.value}`);
        } else if (f.wireType === 2) {
            const str = tryString(f.value);
            if (str && str.length < 200) {
                console.log(`${indent}field${f.fieldNumber} (string): "${str}"`);
            } else {
                const nested = tryDecodeNested(f.value);
                if (nested) {
                    console.log(`${indent}field${f.fieldNumber} (message, ${f.value.length}B):`);
                    dumpFields(f.value, depth + 1, maxDepth);
                } else {
                    console.log(`${indent}field${f.fieldNumber} (bytes, ${f.value.length}B): ${f.value.slice(0, 30).toString('hex')}...`);
                }
            }
        } else if (f.wireType === 1) {
            console.log(`${indent}field${f.fieldNumber} (64bit): ${f.value}`);
        } else if (f.wireType === 5) {
            console.log(`${indent}field${f.fieldNumber} (32bit): ${f.value}`);
        }
    }
}

main();
