#!/usr/bin/env node
/**
 * explore-api.js — 探索 Antigravity IDE 的内部 API
 *
 * 通过 CDP 在 IDE 窗口和 Agent Manager 窗口中执行 JS，
 * 发现可用的 conversation/history 相关 API。
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
function cdpSend(ws, m, p = {}, t = 10000) {
    return new Promise((r, j) => {
        const id = mid++;
        const to = setTimeout(() => { ws.off('message', h); j(new Error('Timeout')); }, t);
        const h = raw => {
            const msg = JSON.parse(raw.toString());
            if (msg.id === id) {
                clearTimeout(to);
                ws.off('message', h);
                msg.error ? j(new Error(msg.error.message)) : r(msg.result);
            }
        };
        ws.on('message', h);
        ws.send(JSON.stringify({ id, method: m, params: p }));
    });
}

async function cdpEval(ws, expr) {
    const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) {
        console.log('  Eval error:', r.exceptionDetails.text);
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

async function exploreTarget(label, ws) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔍 探索: ${label}`);
    console.log('─'.repeat(70));

    // 1) 检查全局 API 对象
    console.log('\n📌 全局 API 对象:');
    const globalApis = await cdpEval(ws, `JSON.stringify(
        Object.keys(window).filter(k => {
            const lower = k.toLowerCase();
            return lower.includes('api') || lower.includes('conversation') || 
                   lower.includes('chat') || lower.includes('history') ||
                   lower.includes('agent') || lower.includes('jetski') ||
                   lower.includes('antigravity') || lower.includes('vscode') ||
                   lower.includes('store') || lower.includes('state');
        }).slice(0, 50)
    )`);
    console.log('  ', globalApis);

    // 2) 检查 vscode 相关 API
    console.log('\n📌 vscode / acquireVsCodeApi:');
    const vsApi = await cdpEval(ws, `JSON.stringify({
        hasVsCodeApi: typeof acquireVsCodeApi !== 'undefined',
        hasVscode: typeof vscode !== 'undefined',
    })`);
    console.log('  ', vsApi);

    // 3) 搜索 __NEXT_DATA__, __APP_DATA__ 等
    console.log('\n📌 框架数据对象:');
    const frameworkData = await cdpEval(ws, `JSON.stringify(
        Object.keys(window).filter(k => k.startsWith('__')).slice(0, 30)
    )`);
    console.log('  ', frameworkData);

    // 4) 查找 React fiber / 状态
    console.log('\n📌 React 状态探测:');
    const reactRoot = await cdpEval(ws, `(() => {
        // 查找 React root
        const roots = [];
        document.querySelectorAll('*').forEach(el => {
            const keys = Object.keys(el);
            const fiberKey = keys.find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (fiberKey) roots.push(el.tagName + '.' + (el.className || '').substring(0, 30));
        });
        return JSON.stringify({ reactElements: roots.length, sample: roots.slice(0, 5) });
    })()`);
    console.log('  ', reactRoot);

    // 5) 查找 localStorage/sessionStorage 中的对话数据
    console.log('\n📌 Storage 中的对话/历史数据:');
    const storageKeys = await cdpEval(ws, `(() => {
        const result = { localStorage: [], sessionStorage: [] };
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const lower = key.toLowerCase();
            if (lower.includes('convers') || lower.includes('chat') || lower.includes('history') || lower.includes('thread') || lower.includes('session')) {
                const val = localStorage.getItem(key);
                result.localStorage.push({ key, valueLength: val?.length || 0, preview: (val || '').substring(0, 200) });
            }
        }
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const lower = key.toLowerCase();
            if (lower.includes('convers') || lower.includes('chat') || lower.includes('history') || lower.includes('thread') || lower.includes('session')) {
                const val = sessionStorage.getItem(key);
                result.sessionStorage.push({ key, valueLength: val?.length || 0, preview: (val || '').substring(0, 200) });
            }
        }
        return JSON.stringify(result);
    })()`);
    console.log('  ', storageKeys);

    // 6) 查找所有 localStorage key
    console.log('\n📌 所有 localStorage keys:');
    const allKeys = await cdpEval(ws, `JSON.stringify(
        Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort()
    )`);
    console.log('  ', allKeys);

    // 7) 检查 IndexedDB 数据库
    console.log('\n📌 IndexedDB 数据库:');
    const idbDatabases = await cdpEval(ws, `(async () => {
        try {
            const dbs = await indexedDB.databases();
            return JSON.stringify(dbs.map(d => ({ name: d.name, version: d.version })));
        } catch { return '[]'; }
    })()`);
    console.log('  ', idbDatabases);

    // 8) 检查 Service Worker / 网络拦截相关
    console.log('\n📌 页面 URL 和其他信息:');
    const pageInfo = await cdpEval(ws, `JSON.stringify({
        url: location.href,
        origin: location.origin,
        title: document.title,
    })`);
    console.log('  ', pageInfo);

    // 9) 查找 postMessage 等消息通道
    console.log('\n📌 窗口消息 / IPC:');
    const ipcProbe = await cdpEval(ws, `JSON.stringify({
        hasPostMessage: typeof window.postMessage === 'function',
        hasElectron: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
    })`);
    console.log('  ', ipcProbe);

    // 10) 尝试 acquireVsCodeApi
    console.log('\n📌 尝试 acquireVsCodeApi:');
    const vscodeApiResult = await cdpEval(ws, `(() => {
        try {
            if (typeof acquireVsCodeApi === 'function') {
                const api = acquireVsCodeApi();
                return JSON.stringify({
                    success: true,
                    methods: Object.keys(api || {}),
                    getState: api?.getState ? JSON.stringify(api.getState()).substring(0, 500) : 'N/A',
                });
            }
            return JSON.stringify({ success: false, reason: 'acquireVsCodeApi not found' });
        } catch (e) {
            return JSON.stringify({ success: false, reason: e.message });
        }
    })()`);
    console.log('  ', vscodeApiResult);
}

async function exploreManagerDeep(ws) {
    console.log('\n📌 Manager 页面深度探测:');

    // 获取所有按钮文本
    const buttons = await cdpEval(ws, `JSON.stringify(
        Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.innerText.trim().substring(0, 60),
            class: (b.className || '').substring(0, 60),
        })).filter(b => b.text)
    )`);
    console.log('  Buttons:', buttons);

    // 获取页面完整文本结构
    const bodyText = await cdpEval(ws, `(document.body?.innerText || '').substring(0, 2000)`);
    console.log('\n  Body text (前2000字):');
    console.log('  ', bodyText?.replace(/\n/g, '\n  '));

    // 查找列表类 DOM
    const lists = await cdpEval(ws, `JSON.stringify(
        Array.from(document.querySelectorAll('[role="listbox"], [role="list"], ul, ol, .list, [class*="list"]')).map(el => ({
            tag: el.tagName,
            class: (el.className || '').substring(0, 60),
            children: el.children.length,
            text: (el.innerText || '').substring(0, 200),
        })).slice(0, 10)
    )`);
    console.log('\n  List elements:', lists);

    // 查找 links / anchors
    const links = await cdpEval(ws, `JSON.stringify(
        Array.from(document.querySelectorAll('a[href]')).map(a => ({
            href: a.href,
            text: a.innerText.trim().substring(0, 60),
        })).slice(0, 20)
    )`);
    console.log('\n  Links:', links);
}

async function main() {
    console.log(`\n🔬 Antigravity API Explorer — http://${host}:${port}\n`);

    const targets = await httpGet(`http://${host}:${port}/json`);

    // 找到 IDE 工作区和 Agent Manager
    const ideTarget = targets.find(t => t.type === 'page' && t.title.includes('Antigravity'));
    const agentTargets = targets.filter(t => t.type === 'page' && (t.url || '').includes('jetski'));

    if (ideTarget) {
        console.log(`\n📋 IDE 窗口: ${ideTarget.title}`);
        let ws;
        try {
            ws = await connectTarget(ideTarget);
            await exploreTarget(`IDE — ${ideTarget.title}`, ws);
        } catch (err) {
            console.log(`  ❌ 连接失败: ${err.message}`);
        } finally {
            if (ws?.readyState === WebSocket.OPEN) ws.close();
        }
    } else {
        console.log('⚠️ 未找到 IDE 窗口');
    }

    for (const agentTarget of agentTargets) {
        console.log(`\n📋 Agent: ${agentTarget.title} — ${agentTarget.url}`);
        let ws;
        try {
            ws = await connectTarget(agentTarget);
            await exploreTarget(`Agent — ${agentTarget.title}`, ws);
            await exploreManagerDeep(ws);
        } catch (err) {
            console.log(`  ❌ 连接失败: ${err.message}`);
        } finally {
            if (ws?.readyState === WebSocket.OPEN) ws.close();
        }
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log('🏁 探索完成\n');
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
