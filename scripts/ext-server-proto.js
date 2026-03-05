#!/usr/bin/env node
/**
 * ext-server-proto.js — Proto 格式 Extension Server
 *
 * LS 要求 Connect Protocol + Proto 格式通信。
 * 大部分方法返回空 proto (Buffer.alloc(0))，
 * Subscribe 方法保持连接打开。
 *
 * 用法:
 *   node scripts/ext-server-proto.js
 *   EXT_PORT=42200 node scripts/ext-server-proto.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PORT = Number(process.env.EXT_PORT || 42200);

// ========== Proto 编码/解码工具 ==========

// Minimal protobuf varint encoder
function encodeVarint(value) {
    const bytes = [];
    while (value > 0x7f) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
}

// Decode varint from buffer at offset, returns { value, bytesRead }
function decodeVarint(buf, offset) {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    while (offset < buf.length) {
        const byte = buf[offset++];
        bytesRead++;
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
    }
    return { value, bytesRead };
}

// Decode all fields from a proto buffer, returns Map<fieldNumber, value[]>
// Only handles wire type 0 (varint) and 2 (length-delimited/string)
function decodeProtoFields(buf) {
    const fields = new Map();
    let offset = 0;
    while (offset < buf.length) {
        const { value: tag, bytesRead: tagBytes } = decodeVarint(buf, offset);
        offset += tagBytes;
        const fieldNumber = tag >>> 3;
        const wireType = tag & 0x07;

        if (wireType === 0) {
            // varint
            const { value, bytesRead } = decodeVarint(buf, offset);
            offset += bytesRead;
            if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
            fields.get(fieldNumber).push(value);
        } else if (wireType === 2) {
            // length-delimited (string, bytes, embedded message)
            const { value: len, bytesRead } = decodeVarint(buf, offset);
            offset += bytesRead;
            const data = buf.slice(offset, offset + len);
            offset += len;
            if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
            fields.get(fieldNumber).push(data);
        } else {
            // skip unknown wire types (not expected in our use case)
            console.warn(`[Proto] Unknown wire type ${wireType} for field ${fieldNumber}`);
            break;
        }
    }
    return fields;
}

// Helper: get first string value for a field number
function getStringField(fields, fieldNumber) {
    const vals = fields.get(fieldNumber);
    if (!vals || vals.length === 0) return '';
    const v = vals[0];
    return Buffer.isBuffer(v) ? v.toString('utf-8') : String(v);
}

// Convert file:// URI to local path
function fileUriToPath(uri) {
    if (uri.startsWith('file:///')) return uri.slice(7);       // file:///home/... -> /home/...
    if (uri.startsWith('file://')) return uri.slice(7);
    return uri; // already a path
}

// Encode a string into protobuf field (field_number, string_value)
function encodeStringField(fieldNumber, value) {
    if (!value) return Buffer.alloc(0);
    const tag = (fieldNumber << 3) | 2; // wire type 2 = length-delimited
    const valBuf = Buffer.from(value, 'utf-8');
    return Buffer.concat([encodeVarint(tag), encodeVarint(valBuf.length), valBuf]);
}

// Encode a bool into protobuf field
function encodeBoolField(fieldNumber, value) {
    if (!value) return Buffer.alloc(0);
    const tag = (fieldNumber << 3) | 0; // wire type 0 = varint
    return Buffer.concat([encodeVarint(tag), Buffer.from([value ? 1 : 0])]);
}

// Empty proto response
const EMPTY_PROTO = Buffer.alloc(0);

// ========== 终端进程池 ==========
const terminals = new Map();

// ========== Subscribe 连接池 ==========
const subscriptions = new Map(); // topic -> Set<res>

// ========== 方法处理 ==========

const handlers = {
    // --- 生命周期 ---
    LanguageServerStarted(bodyBuf, res) {
        console.log('[ExtServer] LS started notification received');
        return EMPTY_PROTO;
    },

    CheckTerminalShellSupport(bodyBuf, res) {
        // field 1 = shellSupported (bool, true)
        return encodeBoolField(1, true);
    },

    IsAgentManagerEnabled(bodyBuf, res) {
        return EMPTY_PROTO; // enabled = false (default)
    },

    // --- 遥测/日志 ---
    LogEvent(bodyBuf, res) { return EMPTY_PROTO; },
    RecordError(bodyBuf, res) { return EMPTY_PROTO; },

    // --- 密钥 ---
    StoreSecretValue(bodyBuf, res) { return EMPTY_PROTO; },
    GetSecretValue(bodyBuf, res) { return EMPTY_PROTO; },

    // --- UI/声音 ---
    PlaySound(bodyBuf, res) { return EMPTY_PROTO; },
    OpenFilePointer(bodyBuf, res) {
        console.log('[ExtServer] OpenFilePointer');
        return EMPTY_PROTO;
    },
    OpenDiffZones(bodyBuf, res) { return EMPTY_PROTO; },
    OpenExternalUrl(bodyBuf, res) { return EMPTY_PROTO; },
    InsertCodeAtCursor(bodyBuf, res) { return EMPTY_PROTO; },
    OpenVirtualFile(bodyBuf, res) { return EMPTY_PROTO; },
    OpenSetting(bodyBuf, res) { return EMPTY_PROTO; },
    SmartFocusConversation(bodyBuf, res) { return EMPTY_PROTO; },
    ShowConversationPicker(bodyBuf, res) { return EMPTY_PROTO; },
    OpenConversationWorkspaceQuickPick(bodyBuf, res) { return EMPTY_PROTO; },
    OpenAntigravityRulesFile(bodyBuf, res) { return EMPTY_PROTO; },

    // --- Lint ---
    GetLintErrors(bodyBuf, res) { return EMPTY_PROTO; }, // lintErrors: []

    // --- 定义/引用 ---
    GetDefinition(bodyBuf, res) { return EMPTY_PROTO; },
    FindAllReferences(bodyBuf, res) { return EMPTY_PROTO; },

    // --- 文件操作 ---
    SaveDocument(bodyBuf, res) {
        // SaveDocumentRequest: field 1 = uri (string)
        const fields = decodeProtoFields(bodyBuf);
        const uri = getStringField(fields, 1);
        const filePath = fileUriToPath(uri);
        console.log(`[ExtServer] SaveDocument: ${filePath}`);
        // 文件内容已由 WriteCascadeEdit 写入，Save 只是通知
        return EMPTY_PROTO;
    },

    WriteCascadeEdit(bodyBuf, res) {
        // WriteCascadeEditRequest: field 1 = uri (string), field 2 = target_content (string)
        const fields = decodeProtoFields(bodyBuf);
        const uri = getStringField(fields, 1);
        const content = getStringField(fields, 2);
        const filePath = fileUriToPath(uri);

        console.log(`[ExtServer] WriteCascadeEdit: ${filePath} (${content.length} chars)`);

        try {
            // 确保目录存在
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[ExtServer]   Created directory: ${dir}`);
            }
            // 写入文件
            fs.writeFileSync(filePath, content, 'utf-8');
            console.log(`[ExtServer]   File written successfully!`);
        } catch (e) {
            console.error(`[ExtServer]   ERROR writing file: ${e.message}`);
        }
        return EMPTY_PROTO;
    },

    // --- 终端 ---
    OpenTerminal(bodyBuf, res) {
        const id = `term-${Date.now()}`;
        console.log('[ExtServer] OpenTerminal:', id);

        const proc = spawn('/bin/bash', ['-l'], {
            cwd: process.env.HOME,
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('exit', (code) => {
            const t = terminals.get(id);
            if (t) t.exitCode = code;
        });

        terminals.set(id, { proc, output: '', cwd: process.env.HOME, exitCode: null });
        proc.stdout.on('data', (d) => {
            const t = terminals.get(id);
            if (t) t.output += d.toString();
        });
        proc.stderr.on('data', (d) => {
            const t = terminals.get(id);
            if (t) t.output += d.toString();
        });

        // Return terminalId as proto field 1 (string)
        return encodeStringField(1, id);
    },

    ShowTerminal(bodyBuf, res) { return EMPTY_PROTO; },

    SendTerminalInput(bodyBuf, res) {
        // TODO: 解析 proto
        console.log('[ExtServer] SendTerminalInput (raw, proto)');
        return EMPTY_PROTO;
    },

    ReadTerminal(bodyBuf, res) {
        console.log('[ExtServer] ReadTerminal');
        return EMPTY_PROTO;
    },

    TerminateCommand(bodyBuf, res) {
        console.log('[ExtServer] TerminateCommand');
        return EMPTY_PROTO;
    },

    ExecuteCommand(bodyBuf, res) {
        console.log('[ExtServer] ExecuteCommand (proto)');
        return EMPTY_PROTO;
    },

    // --- 状态同步 ---
    SubscribeToUnifiedStateSyncTopic(bodyBuf, res) {
        // 这是一个流式订阅，保持连接打开
        console.log('[ExtServer] SubscribeToUnifiedStateSyncTopic (stream, keeping open)');
        return '__stream__';
    },

    PushUnifiedStateSyncUpdate(bodyBuf, res) {
        return EMPTY_PROTO;
    },

    // --- 对话管理 ---
    UpdateCascadeTrajectorySummaries(bodyBuf, res) {
        return EMPTY_PROTO;
    },

    BroadcastConversationDeletion(bodyBuf, res) { return EMPTY_PROTO; },
    GetBrowserOnboardingPort(bodyBuf, res) { return EMPTY_PROTO; },
    TerminalResearchResult(bodyBuf, res) { return EMPTY_PROTO; },
    UpdateDetailedViewWithCascadeInput(bodyBuf, res) { return EMPTY_PROTO; },
    GetChromeDevtoolsMcpUrl(bodyBuf, res) { return EMPTY_PROTO; },
    HandleAsyncPostMessage(bodyBuf, res) { return EMPTY_PROTO; },
    HandleProposeCodeExtensionVerification(bodyBuf, res) { return EMPTY_PROTO; },
    RestartUserStatusUpdater(bodyBuf, res) { return EMPTY_PROTO; },
    FetchMCPAuthToken(bodyBuf, res) { return EMPTY_PROTO; },
    RunExtensionCode(bodyBuf, res) { return EMPTY_PROTO; },
    LaunchBrowser(bodyBuf, res) { return EMPTY_PROTO; },
};

// ========== HTTP 服务 ==========

const SERVICE_PREFIX = '/exa.extension_server_pb.ExtensionServerService/';

const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Extension Server (Proto) OK');
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    const url = req.url || '';
    if (!url.startsWith(SERVICE_PREFIX)) {
        res.writeHead(404);
        res.end();
        return;
    }

    const method = url.slice(SERVICE_PREFIX.length);

    // 收集二进制 body
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);

        const handler = handlers[method];
        if (handler) {
            try {
                const result = handler(bodyBuf, res);

                if (result === '__stream__') {
                    // 流式响应: 写 header 但不关闭连接
                    res.writeHead(200, {
                        'Content-Type': 'application/connect+proto',
                        'Connect-Protocol-Version': '1',
                    });
                    // 不调用 res.end()，保持连接打开
                    return;
                }

                // 普通 Unary 响应
                res.writeHead(200, {
                    'Content-Type': 'application/proto',
                    'Connect-Protocol-Version': '1',
                });
                res.end(result);
            } catch (e) {
                console.error(`[ExtServer] ERROR ${method}:`, e.message);
                res.writeHead(500, { 'Content-Type': 'application/proto' });
                res.end(EMPTY_PROTO);
            }
        } else {
            console.log(`[ExtServer] UNIMPLEMENTED: ${method} (body ${bodyBuf.length}B)`);
            res.writeHead(200, {
                'Content-Type': 'application/proto',
                'Connect-Protocol-Version': '1',
            });
            res.end(EMPTY_PROTO);
        }
    });
});

server.keepAliveTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[ExtServer] Proto Extension Server listening on 127.0.0.1:${PORT}`);
    console.log(`[ExtServer] Handlers: ${Object.keys(handlers).length} methods`);
    console.log('');
});
