#!/usr/bin/env node
/**
 * explore-ipc.js — 通过 vscode.ipcRenderer 和文件系统探索对话数据
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const host = process.env.CDP_HOST || '127.0.0.1';
const port = Number(process.env.CDP_PORT || '9000');

function httpGet(u) {
    return new Promise((r, j) => {
        http.get(u, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)) } catch (e) { j(e) } });
        }).on('error', j);
    });
}

let mid = 1;
function cdpSend(ws, m, p = {}, t = 15000) {
    return new Promise((r, j) => {
        const id = mid++;
        const to = setTimeout(() => { ws.off('message', h); j(new Error('Timeout')); }, t);
        const h = raw => {
            const msg = JSON.parse(raw.toString());
            if (msg.id === id) { clearTimeout(to); ws.off('message', h); msg.error ? j(new Error(msg.error.message)) : r(msg.result); }
        };
        ws.on('message', h);
        ws.send(JSON.stringify({ id, method: m, params: p }));
    });
}

async function cdpEval(ws, expr) {
    const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) {
        console.log('  Eval error:', r.exceptionDetails.text || JSON.stringify(r.exceptionDetails));
        return null;
    }
    return r?.result?.value;
}

async function connectTarget(target) {
    if (!target.webSocketDebuggerUrl) return null;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 3000);
        ws.on('open', () => { clearTimeout(timer); resolve(); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    await cdpSend(ws, 'Runtime.enable');
    return ws;
}

async function main() {
    console.log(`\n🔬 IPC & FS Explorer — http://${host}:${port}\n`);

    const targets = await httpGet(`http://${host}:${port}/json`);
    const ideTarget = targets.find(t => t.type === 'page' && t.title.includes('Antigravity'));

    if (!ideTarget) {
        console.log('⚠️ 未找到 IDE 窗口');
        return;
    }

    console.log(`📋 连接到: ${ideTarget.title}\n`);
    const ws = await connectTarget(ideTarget);

    // 1) ipcRenderer 详细探索
    console.log('═'.repeat(70));
    console.log('1. vscode.ipcRenderer 方法');
    console.log('─'.repeat(70));
    const ipcMethods = await cdpEval(ws, `(() => {
        const ipc = vscode.ipcRenderer;
        if (!ipc) return 'no ipcRenderer';
        const keys = [];
        let obj = ipc;
        while (obj && obj !== Object.prototype) {
            keys.push(...Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
        }
        return JSON.stringify([...new Set(keys)]);
    })()`);
    console.log(ipcMethods);

    // 2) 查找 .antigravity 目录（通过本地文件系统）
    console.log('\n' + '═'.repeat(70));
    console.log('2. .antigravity 目录扫描 (本地 fs)');
    console.log('─'.repeat(70));
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    const antigravityDir = path.join(homeDir, '.antigravity');

    if (fs.existsSync(antigravityDir)) {
        function scanDir(dir, depth = 0, maxDepth = 3) {
            if (depth > maxDepth) return;
            const indent = '  '.repeat(depth + 1);
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        const childCount = fs.readdirSync(fullPath).length;
                        console.log(`${indent}📁 ${entry.name}/ (${childCount} items)`);
                        scanDir(fullPath, depth + 1, maxDepth);
                    } else {
                        const stat = fs.statSync(fullPath);
                        const sizeStr = stat.size > 1024 * 1024 ? `${(stat.size / 1024 / 1024).toFixed(1)}MB` :
                            stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
                        console.log(`${indent}📄 ${entry.name} (${sizeStr})`);
                    }
                }
            } catch (err) {
                console.log(`${indent}❌ ${err.message}`);
            }
        }
        scanDir(antigravityDir);
    } else {
        console.log('  .antigravity 目录不存在');
    }

    // 3) 搜索 AppData 中的 Antigravity 数据
    console.log('\n' + '═'.repeat(70));
    console.log('3. AppData 中搜索 Antigravity / Jetski 数据');
    console.log('─'.repeat(70));
    const appDataPaths = [
        path.join(homeDir, 'AppData', 'Roaming', 'antigravity'),
        path.join(homeDir, 'AppData', 'Local', 'antigravity'),
        path.join(homeDir, 'AppData', 'Roaming', 'Antigravity'),
        path.join(homeDir, 'AppData', 'Local', 'Antigravity'),
    ];

    for (const dir of appDataPaths) {
        if (fs.existsSync(dir)) {
            console.log(`\n  📁 ${dir}`);
            const entries = fs.readdirSync(dir);
            entries.forEach(e => console.log(`    - ${e}`));
        }
    }

    // 4) 搜索 vscode 相关的 AppData
    console.log('\n' + '═'.repeat(70));
    console.log('4. 搜索 VSCode/Antigravity 用户数据');
    console.log('─'.repeat(70));

    // Antigravity 作为 VS Code 分支，用户数据可能在 AppData 中
    const possibleUserDataDirs = [
        path.join(homeDir, 'AppData', 'Roaming', 'Antigravity'),
        path.join(homeDir, 'AppData', 'Roaming', 'antigravity'),
        path.join(homeDir, 'AppData', 'Roaming', 'Code'),
    ];

    for (const dir of possibleUserDataDirs) {
        if (fs.existsSync(dir)) {
            console.log(`\n  📁 找到: ${dir}`);
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                entries.forEach(e => {
                    if (e.isDirectory()) {
                        // 查找 conversation/chat 相关子目录
                        const lower = e.name.toLowerCase();
                        const interesting = lower.includes('chat') || lower.includes('convers') ||
                            lower.includes('jetski') || lower.includes('agent') ||
                            lower.includes('history') || lower.includes('state') ||
                            lower.includes('storage') || lower.includes('db') ||
                            lower.includes('data');
                        console.log(`    ${interesting ? '⭐' : '📁'} ${e.name}/`);
                    } else {
                        const lower = e.name.toLowerCase();
                        const interesting = lower.includes('chat') || lower.includes('convers') ||
                            lower.includes('jetski') || lower.includes('state') ||
                            lower.includes('storage') || lower.includes('.db') ||
                            lower.includes('.json');
                        if (interesting) {
                            const stat = fs.statSync(path.join(dir, e.name));
                            console.log(`    ⭐ ${e.name} (${stat.size}B)`);
                        }
                    }
                });
            } catch { }
        }
    }

    // 5) 通过 IPC 发送消息探测可用的 channels
    console.log('\n' + '═'.repeat(70));
    console.log('5. 通过 IPC 探测 conversation API');
    console.log('─'.repeat(70));

    // 尝试调用一些已知的 IPC channel 名称
    const ipcChannels = await cdpEval(ws, `(() => {
        const ipc = vscode.ipcRenderer;
        if (!ipc) return 'no ipcRenderer';
        
        // 查看 ipcRenderer 的内在结构
        const result = {
            type: typeof ipc,
            constructor: ipc.constructor?.name,
            keys: Object.keys(ipc),
            ownPropertyNames: Object.getOwnPropertyNames(ipc),
        };
        
        // 尝试查看 __proto__ 上的方法
        const proto = Object.getPrototypeOf(ipc);
        if (proto) {
            result.protoMethods = Object.getOwnPropertyNames(proto).filter(k => typeof proto[k] === 'function');
        }
        
        return JSON.stringify(result);
    })()`);
    console.log('  ipcRenderer structure:', ipcChannels);

    // 6) 尝试 invoke 一些 channel
    console.log('\n' + '═'.repeat(70));
    console.log('6. 尝试 ipcRenderer.invoke / send');
    console.log('─'.repeat(70));

    // 尝试 invoke 各种 channel 名
    const channelTests = [
        'vscode:getConversations',
        'vscode:getChatHistory',
        'jetski:getConversations',
        'jetski:listThreads',
        'antigravity:getConversations',
    ];

    for (const channel of channelTests) {
        const result = await cdpEval(ws, `(async () => {
            try {
                const result = await vscode.ipcRenderer.invoke('${channel}');
                return JSON.stringify({ channel: '${channel}', success: true, result: JSON.stringify(result).substring(0, 500) });
            } catch (e) {
                return JSON.stringify({ channel: '${channel}', success: false, error: e.message });
            }
        })()`);
        console.log(`  ${channel}:`, result);
    }

    // 7) 探索 vscode.context
    console.log('\n' + '═'.repeat(70));
    console.log('7. vscode.context 对象');
    console.log('─'.repeat(70));
    const contextInfo = await cdpEval(ws, `(() => {
        const ctx = vscode.context;
        if (!ctx) return 'no context';
        const keys = Object.keys(ctx);
        const methods = keys.filter(k => typeof ctx[k] === 'function');
        const objects = keys.filter(k => typeof ctx[k] === 'object' && ctx[k] !== null);
        const values = {};
        keys.forEach(k => {
            const val = ctx[k];
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                values[k] = val;
            } else if (typeof val === 'object' && val !== null) {
                values[k] = '{' + Object.keys(val).slice(0, 5).join(', ') + '...}';
            }
        });
        return JSON.stringify({ total: keys.length, methods, objects, values, allKeys: keys });
    })()`);
    console.log(contextInfo);

    // 8) 探索 vscode.webFrame
    console.log('\n' + '═'.repeat(70));
    console.log('8. vscode.webFrame');
    console.log('─'.repeat(70));
    const webFrameInfo = await cdpEval(ws, `(() => {
        const wf = vscode.webFrame;
        if (!wf) return 'no webFrame';
        const keys = [];
        let obj = wf;
        while (obj && obj !== Object.prototype) {
            keys.push(...Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
        }
        return JSON.stringify([...new Set(keys)].slice(0, 50));
    })()`);
    console.log(webFrameInfo);

    ws.close();
    console.log('\n' + '═'.repeat(70));
    console.log('🏁 探索完成\n');
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
