#!/usr/bin/env node
/**
 * explore-vscode-api.js — 深入探索 vscode 全局对象
 */

const http = require('http');
const WebSocket = require('ws');

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
    const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
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
    console.log(`\n🔬 vscode API Deep Explorer — http://${host}:${port}\n`);

    const targets = await httpGet(`http://${host}:${port}/json`);
    const ideTarget = targets.find(t => t.type === 'page' && t.title.includes('Antigravity'));

    if (!ideTarget) {
        console.log('⚠️ 未找到 IDE 窗口');
        return;
    }

    console.log(`📋 连接到: ${ideTarget.title}\n`);
    const ws = await connectTarget(ideTarget);

    // 1) vscode 对象的顶层属性和方法
    console.log('═'.repeat(70));
    console.log('1. vscode 全局对象的顶层属性');
    console.log('─'.repeat(70));
    const vsCodeKeys = await cdpEval(ws, `(() => {
        if (!window.vscode) return 'vscode not found';
        const keys = Object.keys(vscode);
        const methods = keys.filter(k => typeof vscode[k] === 'function');
        const objects = keys.filter(k => typeof vscode[k] === 'object' && vscode[k] !== null);
        const primitives = keys.filter(k => typeof vscode[k] !== 'function' && (typeof vscode[k] !== 'object' || vscode[k] === null));
        return JSON.stringify({ total: keys.length, methods, objects, primitives, allKeys: keys });
    })()`);
    console.log(vsCodeKeys);

    // 2) vscode.commands 相关
    console.log('\n' + '═'.repeat(70));
    console.log('2. vscode.commands');
    console.log('─'.repeat(70));
    const cmds = await cdpEval(ws, `(() => {
        try {
            if (!vscode?.commands) return 'vscode.commands not available';
            const keys = Object.keys(vscode.commands);
            const methods = keys.filter(k => typeof vscode.commands[k] === 'function');
            return JSON.stringify({ keys, methods });
        } catch (e) { return e.message; }
    })()`);
    console.log(cmds);

    // 3) 尝试 executeCommand 获取对话列表
    console.log('\n' + '═'.repeat(70));
    console.log('3. 尝试通过 vscode.commands.executeCommand 获取对话列表');
    console.log('─'.repeat(70));
    const cmdResult = await cdpEval(ws, `(async () => {
        try {
            if (!vscode?.commands?.executeCommand) return 'executeCommand not found';
            // 尝试获取所有命令列表
            const commands = await vscode.commands.getCommands(true);
            const chatRelated = commands.filter(c => {
                const lower = c.toLowerCase();
                return lower.includes('chat') || lower.includes('conversation') || 
                       lower.includes('history') || lower.includes('agent') ||
                       lower.includes('jetski') || lower.includes('cascade') ||
                       lower.includes('antigravity');
            });
            return JSON.stringify({ total: commands.length, chatRelated: chatRelated.slice(0, 50) });
        } catch (e) { return 'Error: ' + e.message; }
    })()`);
    console.log(cmdResult);

    // 4) 查看 Chat 面板的 webview
    console.log('\n' + '═'.repeat(70));
    console.log('4. 探索 antigravity-agent-side-panel 内部');
    console.log('─'.repeat(70));
    const panelProbe = await cdpEval(ws, `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        if (!panel) return 'panel not found';
        
        // 寻找 iframe / webview
        const iframes = panel.querySelectorAll('iframe, webview');
        const webviews = document.querySelectorAll('webview');
        
        // 寻找 data 属性
        const dataEls = panel.querySelectorAll('[data-vscode-context]');
        const dataContexts = Array.from(dataEls).map(el => el.getAttribute('data-vscode-context'));
        
        return JSON.stringify({
            panelTag: panel.tagName,
            panelClasses: panel.className.substring(0, 100),
            iframeCount: iframes.length,
            webviewCountInDoc: webviews.length,
            dataContexts: dataContexts.slice(0, 5),
        });
    })()`);
    console.log(panelProbe);

    // 5) 寻找所有 webview/iframe
    console.log('\n' + '═'.repeat(70));
    console.log('5. 文档中所有 webview/iframe');
    console.log('─'.repeat(70));
    const webviews = await cdpEval(ws, `(() => {
        const all = document.querySelectorAll('iframe, webview');
        return JSON.stringify(Array.from(all).map(el => ({
            tag: el.tagName,
            src: (el.src || el.getAttribute('src') || '').substring(0, 150),
            class: (el.className || '').substring(0, 80),
            id: el.id || '',
            name: el.name || '',
            width: el.offsetWidth,
            height: el.offsetHeight,
        })));
    })()`);
    console.log(webviews);

    // 6) 检查 process.env 和 Electron 相关
    console.log('\n' + '═'.repeat(70));
    console.log('6. process 对象 (如果 Node 集成存在)');
    console.log('─'.repeat(70));
    const processInfo = await cdpEval(ws, `(() => {
        if (typeof process === 'undefined') return 'process not defined';
        return JSON.stringify({
            platform: process.platform,
            arch: process.arch,
            versions: process.versions ? Object.keys(process.versions).slice(0, 10) : [],
            env_keys_sample: process.env ? Object.keys(process.env).filter(k => {
                const lower = k.toLowerCase();
                return lower.includes('antigravity') || lower.includes('jetski') || lower.includes('vscode') || lower.includes('electron');
            }) : [],
        });
    })()`);
    console.log(processInfo);

    // 7) 尝试 require 和 Electron 模块
    console.log('\n' + '═'.repeat(70));
    console.log('7. 尝试 require / Electron 模块');
    console.log('─'.repeat(70));
    const electronProbe = await cdpEval(ws, `(() => {
        try {
            if (typeof require === 'undefined') return 'require not available';
            const result = {};
            // 尝试 electron
            try {
                const electron = require('electron');
                result.electron = Object.keys(electron).slice(0, 20);
            } catch (e) { result.electron = 'Error: ' + e.message; }
            
            // 尝试 fs
            try {
                const fs = require('fs');
                result.fs = 'available';
            } catch (e) { result.fs = 'Error: ' + e.message; }

            // 尝试 path
            try {
                const path = require('path');
                result.path = 'available';
            } catch (e) { result.path = 'Error: ' + e.message; }
            
            return JSON.stringify(result);
        } catch (e) { return 'Error: ' + e.message; }
    })()`);
    console.log(electronProbe);

    // 8) 查看 Antigravity 数据存储目录内容
    console.log('\n' + '═'.repeat(70));
    console.log('8. Antigravity 数据目录探测');
    console.log('─'.repeat(70));
    const dataDir = await cdpEval(ws, `(() => {
        try {
            if (typeof require === 'undefined') return 'require not available';
            const fs = require('fs');
            const path = require('path');
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            
            // 可能的数据目录
            const dirs = [
                path.join(homeDir, '.antigravity'),
                path.join(homeDir, 'AppData', 'Roaming', 'antigravity'),
                path.join(homeDir, 'AppData', 'Local', 'antigravity'),
                path.join(homeDir, 'AppData', 'Roaming', 'Antigravity'),
                path.join(homeDir, 'AppData', 'Local', 'Antigravity'),
            ];
            
            const result = {};
            for (const dir of dirs) {
                try {
                    if (fs.existsSync(dir)) {
                        const files = fs.readdirSync(dir).slice(0, 30);
                        result[dir] = files;
                    }
                } catch {}
            }
            return JSON.stringify(result);
        } catch (e) { return 'Error: ' + e.message; }
    })()`);
    console.log(dataDir);

    // 9) 搜索 Electron userData 路径
    console.log('\n' + '═'.repeat(70));
    console.log('9. Electron app 路径');
    console.log('─'.repeat(70));
    const appPaths = await cdpEval(ws, `(() => {
        try {
            const electron = require('electron');
            // 渲染进程中获取 app 路径
            const remote = electron.remote;
            if (remote) {
                return JSON.stringify({
                    userData: remote.app.getPath('userData'),
                    appData: remote.app.getPath('appData'),
                    data: remote.app.getPath('appData'),
                });
            }
            // ipcRenderer
            if (electron.ipcRenderer) {
                return JSON.stringify({ hasIpc: true, methods: Object.keys(electron.ipcRenderer).slice(0, 20) });
            }
            return JSON.stringify({ electron_keys: Object.keys(electron).slice(0, 20) });
        } catch (e) { return 'Error: ' + e.message; }
    })()`);
    console.log(appPaths);

    // 10) 搜索 .antigravity 目录下的对话数据
    console.log('\n' + '═'.repeat(70));
    console.log('10. .antigravity 目录深度扫描');
    console.log('─'.repeat(70));
    const deepScan = await cdpEval(ws, `(() => {
        try {
            const fs = require('fs');
            const path = require('path');
            const homeDir = process.env.USERPROFILE || '';
            const baseDir = path.join(homeDir, '.antigravity');
            
            if (!fs.existsSync(baseDir)) return baseDir + ' not found';
            
            // 递归扫描 (最多2层)
            function scan(dir, depth) {
                if (depth > 2) return [];
                const items = [];
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        const relPath = path.relative(baseDir, fullPath);
                        if (entry.isDirectory()) {
                            const children = scan(fullPath, depth + 1);
                            items.push({ path: relPath, type: 'dir', children: children.length });
                            items.push(...children);
                        } else {
                            const stat = fs.statSync(fullPath);
                            items.push({ path: relPath, type: 'file', size: stat.size });
                        }
                    }
                } catch {}
                return items;
            }
            
            const items = scan(baseDir, 0);
            return JSON.stringify(items.slice(0, 100));
        } catch (e) { return 'Error: ' + e.message; }
    })()`);
    console.log(deepScan);

    // 11) 检查 conversation/chat 用 ASAR 中的 API
    console.log('\n' + '═'.repeat(70));
    console.log('11. 查看历史弹窗(jetski-fast-pick)的 DOM 里有没有隐藏数据');
    console.log('─'.repeat(70));
    const historyData = await cdpEval(ws, `(() => {
        // 查看 history modal 相关的全局状态
        const modal = document.querySelector('.jetski-fast-pick');
        if (modal) return JSON.stringify({ modal: true, html: modal.innerHTML.substring(0, 1000) });
        
        // 查看 DOM 中是否有 data-conversation-id 或类似属性
        const convEls = document.querySelectorAll('[data-conversation-id], [data-thread-id], [data-chat-id]');
        
        // 查看所有 data 属性
        const allDataEls = document.querySelectorAll('[data-vscode-context]');
        const contexts = Array.from(allDataEls).map(el => {
            const ctx = el.getAttribute('data-vscode-context');
            return ctx ? ctx.substring(0, 200) : '';
        }).filter(Boolean);
        
        return JSON.stringify({
            modal: false,
            convEls: convEls.length,
            dataContexts: contexts.slice(0, 10),
        });
    })()`);
    console.log(historyData);

    ws.close();
    console.log('\n' + '═'.repeat(70));
    console.log('🏁 探索完成\n');
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
