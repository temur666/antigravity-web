#!/usr/bin/env node
/**
 * extract-proto-schema.js
 * 
 * 从 extension.js 中提取所有 protobuf FileDescriptorProto 的 base64 数据，
 * 解码后输出为人类可读的 .proto 格式。
 * 
 * 原理:
 *   extension.js 中的 proto 定义形如:
 *     file_exa_xxx = (0, i.fileDesc)("base64-encoded-FileDescriptorProto")
 *   base64 解码后是标准的 protobuf FileDescriptorProto 二进制序列化。
 *   我们用 @bufbuild/protobuf 的 FileDescriptorProto 来解码它。
 * 
 * 用法:
 *   node tools/extract-proto-schema.js [--filter=language_server] [--json] [--raw]
 */

const fs = require('fs');
const path = require('path');

// ========== 配置 ==========

const EXT_PATH = '/home/tiemuer/.antigravity-server/bin/1.19.6-d2597a5c475647ed306b22de1e39853c7812d07d/extensions/antigravity/dist/extension.js';

// ========== protobuf 基础解码器 ==========
// FileDescriptorProto 是自描述的，我们手写最小解码器避免循环依赖

/**
 * 最小 protobuf varint 解码器
 */
function decodeVarint(buf, offset) {
    let result = 0;
    let shift = 0;
    let pos = offset;
    while (pos < buf.length) {
        const byte = buf[pos];
        result |= (byte & 0x7f) << shift;
        pos++;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 35) throw new Error('varint too long');
    }
    return { value: result, bytesRead: pos - offset };
}

/**
 * 最小 protobuf wire format 解码器
 * 返回: [{ fieldNumber, wireType, value }]
 */
function decodeMessage(buf) {
    const fields = [];
    let offset = 0;
    while (offset < buf.length) {
        const tag = decodeVarint(buf, offset);
        offset += tag.bytesRead;
        const fieldNumber = tag.value >> 3;
        const wireType = tag.value & 0x07;

        if (fieldNumber === 0) break;

        let value;
        switch (wireType) {
            case 0: { // varint
                const v = decodeVarint(buf, offset);
                offset += v.bytesRead;
                value = v.value;
                break;
            }
            case 1: { // 64-bit
                value = buf.slice(offset, offset + 8);
                offset += 8;
                break;
            }
            case 2: { // length-delimited
                const len = decodeVarint(buf, offset);
                offset += len.bytesRead;
                value = buf.slice(offset, offset + len.value);
                offset += len.value;
                break;
            }
            case 5: { // 32-bit
                value = buf.slice(offset, offset + 4);
                offset += 4;
                break;
            }
            default:
                throw new Error(`Unknown wire type ${wireType} at offset ${offset - tag.bytesRead}`);
        }
        fields.push({ fieldNumber, wireType, value });
    }
    return fields;
}

/**
 * 从 FileDescriptorProto 二进制中提取结构化信息
 * 
 * FileDescriptorProto 字段定义 (google/protobuf/descriptor.proto):
 *   1: name (string)
 *   2: package (string)
 *   3: dependency (repeated string)
 *   4: message_type (repeated DescriptorProto)
 *   5: enum_type (repeated EnumDescriptorProto)
 *   6: service (repeated ServiceDescriptorProto)
 *   8: options (FileOptions)
 *  12: syntax (string)
 */
function decodeFileDescriptor(buf) {
    const fields = decodeMessage(buf);
    const result = {
        name: '',
        package: '',
        dependencies: [],
        messages: [],
        enums: [],
        services: [],
        syntax: '',
    };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.package = f.value.toString('utf8'); break;
            case 3: result.dependencies.push(f.value.toString('utf8')); break;
            case 4: result.messages.push(decodeDescriptorProto(f.value)); break;
            case 5: result.enums.push(decodeEnumDescriptorProto(f.value)); break;
            case 6: result.services.push(decodeServiceDescriptorProto(f.value)); break;
            case 12: result.syntax = f.value.toString('utf8'); break;
        }
    }

    return result;
}

/**
 * DescriptorProto (message 定义)
 *   1: name (string)
 *   2: field (repeated FieldDescriptorProto)
 *   3: nested_type (repeated DescriptorProto)
 *   4: enum_type (repeated EnumDescriptorProto)
 *   8: oneof_decl (repeated OneofDescriptorProto)
 */
function decodeDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = {
        name: '',
        fields: [],
        nestedTypes: [],
        enumTypes: [],
        oneofDecls: [],
    };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.fields.push(decodeFieldDescriptorProto(f.value)); break;
            case 3: result.nestedTypes.push(decodeDescriptorProto(f.value)); break;
            case 4: result.enumTypes.push(decodeEnumDescriptorProto(f.value)); break;
            case 8: result.oneofDecls.push(decodeOneofDescriptorProto(f.value)); break;
        }
    }

    return result;
}

/**
 * FieldDescriptorProto
 *   1: name (string)
 *   3: number (int32)
 *   4: label (enum: 1=OPTIONAL, 2=REQUIRED, 3=REPEATED)
 *   5: type (enum: 见下方 TYPE_MAP)
 *   6: type_name (string) — 引用的 message/enum 全限定名
 *   7: default_value (string)
 *   9: oneof_index (int32)
 *  10: json_name (string)
 */
function decodeFieldDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = {
        name: '',
        number: 0,
        label: 0,
        type: 0,
        typeName: '',
        defaultValue: '',
        oneofIndex: -1,
        jsonName: '',
    };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 3: result.number = f.value; break;
            case 4: result.label = f.value; break;
            case 5: result.type = f.value; break;
            case 6: result.typeName = f.value.toString('utf8'); break;
            case 7: result.defaultValue = f.value.toString('utf8'); break;
            case 9: result.oneofIndex = f.value; break;
            case 10: result.jsonName = f.value.toString('utf8'); break;
        }
    }

    return result;
}

/**
 * EnumDescriptorProto
 *   1: name (string)
 *   2: value (repeated EnumValueDescriptorProto)
 */
function decodeEnumDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = { name: '', values: [] };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.values.push(decodeEnumValueDescriptorProto(f.value)); break;
        }
    }

    return result;
}

/**
 * EnumValueDescriptorProto
 *   1: name (string)
 *   2: number (int32)
 */
function decodeEnumValueDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = { name: '', number: 0 };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.number = f.value; break;
        }
    }

    return result;
}

/**
 * OneofDescriptorProto
 *   1: name (string)
 */
function decodeOneofDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    let name = '';
    for (const f of fields) {
        if (f.fieldNumber === 1) name = f.value.toString('utf8');
    }
    return { name };
}

/**
 * ServiceDescriptorProto
 *   1: name (string)
 *   2: method (repeated MethodDescriptorProto)
 */
function decodeServiceDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = { name: '', methods: [] };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.methods.push(decodeMethodDescriptorProto(f.value)); break;
        }
    }

    return result;
}

/**
 * MethodDescriptorProto
 *   1: name (string)
 *   2: input_type (string)
 *   3: output_type (string)
 *   4: client_streaming (bool)
 *   5: server_streaming (bool)
 */
function decodeMethodDescriptorProto(buf) {
    const fields = decodeMessage(buf);
    const result = {
        name: '',
        inputType: '',
        outputType: '',
        clientStreaming: false,
        serverStreaming: false,
    };

    for (const f of fields) {
        switch (f.fieldNumber) {
            case 1: result.name = f.value.toString('utf8'); break;
            case 2: result.inputType = f.value.toString('utf8'); break;
            case 3: result.outputType = f.value.toString('utf8'); break;
            case 4: result.clientStreaming = !!f.value; break;
            case 5: result.serverStreaming = !!f.value; break;
        }
    }

    return result;
}

// ========== 类型映射 ==========

const TYPE_MAP = {
    1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32',
    6: 'fixed64', 7: 'fixed32', 8: 'bool', 9: 'string', 10: 'group',
    11: 'message', 12: 'bytes', 13: 'uint32', 14: 'enum', 15: 'sfixed32',
    16: 'sfixed64', 17: 'sint32', 18: 'sint64',
};

const LABEL_MAP = { 1: 'optional', 2: 'required', 3: 'repeated' };

// ========== Proto 格式化输出 ==========

function formatType(field) {
    if (field.type === 11 || field.type === 14) {
        // message or enum — use typeName (strip leading dot)
        return field.typeName.replace(/^\./, '');
    }
    return TYPE_MAP[field.type] || `unknown(${field.type})`;
}

function formatMessage(msg, indent = 0) {
    const pad = '  '.repeat(indent);
    const lines = [];
    lines.push(`${pad}message ${msg.name} {`);

    // oneof declarations
    const oneofFields = new Map(); // oneofIndex → fields[]
    for (const f of msg.fields) {
        if (f.oneofIndex >= 0) {
            if (!oneofFields.has(f.oneofIndex)) oneofFields.set(f.oneofIndex, []);
            oneofFields.get(f.oneofIndex).push(f);
        }
    }

    // Enum types
    for (const e of msg.enumTypes) {
        lines.push(formatEnum(e, indent + 1));
    }

    // Non-oneof fields
    const oneofFieldNumbers = new Set();
    for (const fields of oneofFields.values()) {
        for (const f of fields) oneofFieldNumbers.add(f.number);
    }

    for (const f of msg.fields) {
        if (oneofFieldNumbers.has(f.number)) continue;
        const label = f.label === 3 ? 'repeated ' : '';
        const type = formatType(f);
        lines.push(`${pad}  ${label}${type} ${f.name} = ${f.number};`);
    }

    // Oneof groups
    for (const [idx, fields] of oneofFields) {
        const oneofName = msg.oneofDecls[idx]?.name || `_oneof_${idx}`;
        // Skip synthetic oneofs (proto3 optional)
        if (fields.length === 1 && oneofName === `_${fields[0].name}`) continue;
        lines.push(`${pad}  oneof ${oneofName} {`);
        for (const f of fields) {
            const type = formatType(f);
            lines.push(`${pad}    ${type} ${f.name} = ${f.number};`);
        }
        lines.push(`${pad}  }`);
    }

    // Nested types 
    for (const nested of msg.nestedTypes) {
        lines.push(formatMessage(nested, indent + 1));
    }

    lines.push(`${pad}}`);
    return lines.join('\n');
}

function formatEnum(e, indent = 0) {
    const pad = '  '.repeat(indent);
    const lines = [`${pad}enum ${e.name} {`];
    for (const v of e.values) {
        lines.push(`${pad}  ${v.name} = ${v.number};`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
}

function formatService(svc, indent = 0) {
    const pad = '  '.repeat(indent);
    const lines = [`${pad}service ${svc.name} {`];
    for (const m of svc.methods) {
        const inputType = m.inputType.replace(/^\./, '');
        const outputType = m.outputType.replace(/^\./, '');
        const clientStream = m.clientStreaming ? 'stream ' : '';
        const serverStream = m.serverStreaming ? 'stream ' : '';
        lines.push(`${pad}  rpc ${m.name} (${clientStream}${inputType}) returns (${serverStream}${outputType});`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
}

function formatFileDescriptor(fd) {
    const lines = [];
    lines.push(`// Proto file: ${fd.name}`);
    lines.push(`// Package: ${fd.package}`);
    if (fd.syntax) lines.push(`syntax = "${fd.syntax}";`);
    lines.push(`package ${fd.package};`);
    lines.push('');

    if (fd.dependencies.length > 0) {
        for (const dep of fd.dependencies) {
            lines.push(`import "${dep}";`);
        }
        lines.push('');
    }

    for (const e of fd.enums) {
        lines.push(formatEnum(e));
        lines.push('');
    }

    for (const msg of fd.messages) {
        lines.push(formatMessage(msg));
        lines.push('');
    }

    for (const svc of fd.services) {
        lines.push(formatService(svc));
        lines.push('');
    }

    return lines.join('\n');
}

// ========== 提取逻辑 ==========

function extractProtoSchemas(extJsContent) {
    // 匹配所有 fileDesc 调用: variable=(0,i.fileDesc)("base64data")
    // 还可能有第二个参数: (0,i.fileDesc)("base64", "base64dep1", ...)
    const regex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"/g;
    const results = [];
    let match;

    while ((match = regex.exec(extJsContent)) !== null) {
        const varName = match[1];
        const b64Data = match[2];

        try {
            const buf = Buffer.from(b64Data, 'base64');
            const fd = decodeFileDescriptor(buf);
            results.push({
                variableName: varName,
                base64Length: b64Data.length,
                binaryLength: buf.length,
                descriptor: fd,
            });
        } catch (err) {
            console.error(`[!] Failed to decode ${varName}: ${err.message}`);
        }
    }

    return results;
}

// ========== 统计 ==========

function countFields(msg) {
    let count = msg.fields.length;
    for (const nested of msg.nestedTypes) {
        count += countFields(nested);
    }
    return count;
}

function printStats(schemas) {
    let totalMessages = 0;
    let totalEnums = 0;
    let totalServices = 0;
    let totalMethods = 0;
    let totalFields = 0;

    for (const s of schemas) {
        const fd = s.descriptor;
        const msgCount = countMessagesRecursive(fd.messages);
        totalMessages += msgCount;
        totalEnums += countEnumsRecursive(fd.messages) + fd.enums.length;
        totalServices += fd.services.length;
        for (const svc of fd.services) totalMethods += svc.methods.length;
        for (const msg of fd.messages) totalFields += countFields(msg);
    }

    console.log('\n========== 统计 ==========');
    console.log(`Proto 文件数: ${schemas.length}`);
    console.log(`Message 类型: ${totalMessages}`);
    console.log(`Enum 类型:    ${totalEnums}`);
    console.log(`Service 数:   ${totalServices}`);
    console.log(`RPC 方法数:   ${totalMethods}`);
    console.log(`字段总数:     ${totalFields}`);
}

function countMessagesRecursive(messages) {
    let count = messages.length;
    for (const m of messages) count += countMessagesRecursive(m.nestedTypes);
    return count;
}

function countEnumsRecursive(messages) {
    let count = 0;
    for (const m of messages) {
        count += m.enumTypes.length;
        count += countEnumsRecursive(m.nestedTypes);
    }
    return count;
}

// ========== Main ==========

function main() {
    const args = process.argv.slice(2);
    const filter = args.find(a => a.startsWith('--filter='))?.split('=')[1];
    const jsonMode = args.includes('--json');
    const rawMode = args.includes('--raw');

    if (!fs.existsSync(EXT_PATH)) {
        console.error(`[!] extension.js not found: ${EXT_PATH}`);
        process.exit(1);
    }

    console.log(`[*] Reading extension.js (${(fs.statSync(EXT_PATH).size / 1024 / 1024).toFixed(1)} MB)...`);
    const content = fs.readFileSync(EXT_PATH, 'utf8');

    console.log('[*] Extracting proto schemas...');
    let schemas = extractProtoSchemas(content);
    console.log(`[*] Found ${schemas.length} proto file descriptors`);

    if (filter) {
        schemas = schemas.filter(s =>
            s.variableName.includes(filter) ||
            s.descriptor.name.includes(filter) ||
            s.descriptor.package.includes(filter)
        );
        console.log(`[*] Filtered to ${schemas.length} matching "${filter}"`);
    }

    if (jsonMode) {
        console.log(JSON.stringify(schemas.map(s => s.descriptor), null, 2));
        return;
    }

    // 输出目录
    const outDir = path.join(__dirname, '..', 'docs', 'reference', 'proto');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const s of schemas) {
        const fd = s.descriptor;
        const protoText = formatFileDescriptor(fd);

        if (rawMode) {
            console.log('\n' + '='.repeat(80));
            console.log(protoText);
        }

        // 写入文件
        const fileName = s.variableName
            .replace(/^file_/, '')
            .replace(/_/g, '-') + '.proto';
        const outPath = path.join(outDir, fileName);
        fs.writeFileSync(outPath, protoText);

        const msgCount = countMessagesRecursive(fd.messages);
        const svcCount = fd.services.length;
        const methodCount = fd.services.reduce((a, s) => a + s.methods.length, 0);
        console.log(`  -> ${fileName} (${msgCount} messages, ${fd.enums.length} enums, ${svcCount} services, ${methodCount} methods)`);
    }

    printStats(schemas);
    console.log(`\n[*] Proto files written to: ${outDir}`);
}

main();
