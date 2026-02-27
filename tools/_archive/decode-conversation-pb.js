/**
 * decode-conversation-pb.js — 解码 .pb 对话文件并输出到文本
 * 
 * Usage: node tools/decode-conversation-pb.js [path-to-pb-file]
 * Default: tools/latest.pb
 */
const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.join(__dirname, 'latest.pb');
const outputFile = inputFile.replace(/\.pb$/, '-decoded.txt');

// ========== Protobuf 解码 ==========
function decodeVarint(buf, offset) {
    let result = 0n, shift = 0n, pos = offset;
    while (pos < buf.length) {
        const byte = buf[pos++];
        result |= BigInt(byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7n;
        if (shift > 63n) throw new Error('varint too long');
    }
    return { value: Number(result), bytesRead: pos - offset };
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
            if (fieldNumber === 0 || fieldNumber > 10000) break;

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
                    if (len.value < 0 || pos + len.value > buf.length) throw new Error('overflow');
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
    try {
        const str = buf.toString('utf-8');
        // Check if most chars are printable
        let printable = 0;
        for (let i = 0; i < Math.min(str.length, 200); i++) {
            const c = str.charCodeAt(i);
            if ((c >= 0x20 && c < 0x7F) || c > 0x7F || c === 10 || c === 13 || c === 9) printable++;
        }
        if (str.length > 0 && printable / Math.min(str.length, 200) > 0.8) return str;
    } catch { }
    return null;
}

function dumpFields(fields, indent, lines, maxDepth = 10, depth = 0) {
    if (depth > maxDepth) { lines.push(`${indent}... (max depth)`); return; }
    for (const f of fields) {
        const prefix = `${indent}f${f.fn}`;
        if (f.wt === 0) {
            let extra = '';
            if (f.val > 1700000000 && f.val < 2100000000) extra = ` → ${new Date(f.val * 1000).toISOString()}`;
            lines.push(`${prefix} (varint) = ${f.val}${extra}`);
        } else if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str) {
                if (str.length < 500) {
                    lines.push(`${prefix} (str ${f.val.length}B) = "${str}"`);
                } else {
                    lines.push(`${prefix} (str ${f.val.length}B) = "${str.substring(0, 500)}..."`);
                }
            } else {
                // Try as sub-message
                try {
                    const sub = decodeMessage(f.val);
                    if (sub.length > 0 && sub.length < 500) {
                        lines.push(`${prefix} (msg ${f.val.length}B, ${sub.length} fields):`);
                        dumpFields(sub, indent + '  ', lines, maxDepth, depth + 1);
                    } else if (sub.length >= 500) {
                        lines.push(`${prefix} (msg ${f.val.length}B, ${sub.length} fields) [too many to expand]`);
                    } else {
                        lines.push(`${prefix} (bin ${f.val.length}B) = ${f.val.toString('hex').substring(0, 100)}...`);
                    }
                } catch {
                    lines.push(`${prefix} (bin ${f.val.length}B) = ${f.val.toString('hex').substring(0, 100)}...`);
                }
            }
        }
    }
}

// ========== Main ==========
console.log(`读取文件: ${inputFile}`);
const buf = fs.readFileSync(inputFile);
console.log(`文件大小: ${buf.length} bytes`);

const lines = [];
const log = (l) => lines.push(l);

log('═'.repeat(80));
log(`Protobuf 对话文件解码`);
log(`文件: ${path.basename(inputFile)} (${buf.length} bytes)`);
log('═'.repeat(80));
log('');

// 顶层解码
const topFields = decodeMessage(buf);
log(`顶层字段数: ${topFields.length}`);
log('');

// 先输出结构概览
log('━━━ 结构概览 ━━━');
const fieldCounts = {};
for (const f of topFields) {
    const key = `f${f.fn}_wt${f.wt}`;
    fieldCounts[key] = (fieldCounts[key] || 0) + 1;
}
for (const [k, v] of Object.entries(fieldCounts)) {
    log(`  ${k}: ${v} 个`);
}
log('');

// 输出前 10 个顶层字段的详细解码
log('━━━ 前 10 个顶层字段详细解码 ━━━');
for (let i = 0; i < Math.min(10, topFields.length); i++) {
    log(`\n--- 顶层字段 #${i + 1} ---`);
    dumpFields([topFields[i]], '', lines, 4);
}

// 搜索所有可读文本
log('');
log('━━━ 文件中所有可识别的文本内容 ━━━');

function extractTexts(fields, depth = 0) {
    const texts = [];
    if (depth > 8) return texts;
    for (const f of fields) {
        if (f.wt === 2) {
            const str = tryStr(f.val);
            if (str && str.length > 10) {
                texts.push({ fn: f.fn, depth, text: str });
            }
            // Recurse into sub-messages
            try {
                const sub = decodeMessage(f.val);
                if (sub.length > 0 && sub.length < 1000) {
                    texts.push(...extractTexts(sub, depth + 1));
                }
            } catch { }
        }
    }
    return texts;
}

const allTexts = extractTexts(topFields);
log(`找到 ${allTexts.length} 个文本片段`);
log('');

// 过滤出有意义的长文本（可能是对话内容）
const longTexts = allTexts.filter(t => t.text.length > 50);
log(`其中长文本 (>50字符): ${longTexts.length} 个`);
log('');

for (let i = 0; i < Math.min(50, longTexts.length); i++) {
    const t = longTexts[i];
    log(`--- 文本 #${i + 1} (f${t.fn}, depth=${t.depth}, ${t.text.length}B) ---`);
    log(t.text.substring(0, 2000));
    if (t.text.length > 2000) log(`... [截断，总 ${t.text.length} 字符]`);
    log('');
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log(`✅ 已保存到: ${outputFile} (${lines.length} 行)`);
