#!/usr/bin/env node
/**
 * custom-mcp-server.js — 自定义 MCP Server (stdio 模式)
 *
 * 提供两个自定义工具:
 *   1. get_server_status - 获取服务器状态信息
 *   2. write_note - 在指定目录写一条笔记
 *
 * 协议: MCP (JSON-RPC over stdio)
 */

const fs = require('fs');
const path = require('path');

const NOTES_DIR = '/home/tiemuer/antigravity-web/tmp/notes';

// 确保笔记目录存在
if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// ========== 工具定义 ==========

const TOOLS = [
    {
        name: 'get_server_status',
        description: '获取当前服务器的运行状态，包括主机名、运行时间、内存使用情况、磁盘空间等。当用户询问服务器状态时使用此工具。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'write_note',
        description: '在服务器上创建一条笔记文件。笔记会保存在固定目录下，文件名基于时间戳自动生成。',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: '笔记标题',
                },
                content: {
                    type: 'string',
                    description: '笔记正文内容',
                },
            },
            required: ['title', 'content'],
        },
    },
];

// ========== 工具执行 ==========

function executeGetServerStatus() {
    const os = require('os');
    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mem = os.totalmem();
    const freeMem = os.freemem();

    let diskInfo = 'N/A';
    try {
        const { execSync } = require('child_process');
        diskInfo = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", { encoding: 'utf-8' }).trim();
    } catch { /* ignore */ }

    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        uptime: `${hours}h ${mins}m`,
        memory: {
            total: `${(mem / 1024 / 1024 / 1024).toFixed(1)} GB`,
            free: `${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
            used_percent: `${((1 - freeMem / mem) * 100).toFixed(1)}%`,
        },
        disk: diskInfo,
        cpus: os.cpus().length,
        load_avg: os.loadavg().map(l => l.toFixed(2)).join(', '),
        node_version: process.version,
        timestamp: new Date().toISOString(),
    };
}

function executeWriteNote(args) {
    const { title, content } = args;
    if (!title || !content) {
        throw new Error('title 和 content 都是必填参数');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}-${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 50)}.md`;
    const filepath = path.join(NOTES_DIR, filename);

    const noteContent = `# ${title}\n\n> 创建时间: ${new Date().toISOString()}\n\n${content}\n`;
    fs.writeFileSync(filepath, noteContent, 'utf-8');

    return {
        success: true,
        filepath,
        filename,
        message: `笔记已保存到 ${filepath}`,
    };
}

// ========== MCP JSON-RPC 处理 ==========

function handleRequest(request) {
    const { method, params, id } = request;

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {},
                    },
                    serverInfo: {
                        name: 'antigravity-custom-tools',
                        version: '1.0.0',
                    },
                },
            };

        case 'notifications/initialized':
            // 通知，不需要响应
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                id,
                result: { tools: TOOLS },
            };

        case 'tools/call': {
            const toolName = params?.name;
            const args = params?.arguments || {};

            try {
                let result;
                switch (toolName) {
                    case 'get_server_status':
                        result = executeGetServerStatus();
                        break;
                    case 'write_note':
                        result = executeWriteNote(args);
                        break;
                    default:
                        return {
                            jsonrpc: '2.0',
                            id,
                            error: { code: -32601, message: `Unknown tool: ${toolName}` },
                        };
                }
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                };
            } catch (e) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: `Error: ${e.message}` }],
                        isError: true,
                    },
                };
            }
        }

        default:
            if (method?.startsWith('notifications/')) {
                return null; // 通知不需要响应
            }
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` },
            };
    }
}

// ========== stdio 传输 ==========

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    processBuffer();
});

function processBuffer() {
    while (true) {
        // 查找 header 结束标记
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const header = buffer.slice(0, headerEnd);
        const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
            // 无效 header，跳过
            buffer = buffer.slice(headerEnd + 4);
            continue;
        }

        const contentLength = parseInt(lengthMatch[1]);
        const bodyStart = headerEnd + 4;

        if (buffer.length < bodyStart + contentLength) return; // 等待更多数据

        const body = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);

        try {
            const request = JSON.parse(body);
            const response = handleRequest(request);
            if (response) {
                sendResponse(response);
            }
        } catch (e) {
            process.stderr.write(`[MCP] Parse error: ${e.message}\n`);
        }
    }
}

function sendResponse(response) {
    const body = JSON.stringify(response);
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    process.stdout.write(msg);
}
