#!/usr/bin/env node
/**
 * test-newchat2.js — 再次测试，输出分段避免截断
 */
const http = require('http');
const WebSocket = require('ws');

function httpGet(u) { return new Promise((r, j) => { http.get(u, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { r(JSON.parse(d)) } catch (e) { j(e) } }); }).on('error', j) }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let mid = 1;
function cdpSend(ws, m, p = {}, t = 10000) {
    return new Promise((r, j) => {
        const id = mid++;
        const to = setTimeout(() => { ws.off('message', h); j(new Error('Timeout')); }, t);
        const h = raw => { const msg = JSON.parse(raw.toString()); if (msg.id === id) { clearTimeout(to); ws.off('message', h); msg.error ? j(new Error(msg.error.message)) : r(msg.result); } };
        ws.on('message', h);
        ws.send(JSON.stringify({ id, method: m, params: p }));
    });
}
async function cdpEval(ws, expr) {
    const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) return null;
    return r?.result?.value;
}
async function clickAt(ws, x, y) {
    await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(50);
    await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function main() {
    const targets = await httpGet('http://127.0.0.1:9000/json');
    const t = targets.find(x => x.type === 'page' && x.title && x.title.includes('Antigravity'));
    if (!t) { console.log('未找到窗口'); return; }
    console.log('连接到:', t.title);

    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    await cdpSend(ws, 'Runtime.enable');

    // 面板的 tooltip 按钮
    console.log('\n--- Chat 面板 tooltip 按钮 ---');
    const buttonsRaw = await cdpEval(ws, `JSON.stringify(
        Array.from(document.querySelector('.antigravity-agent-side-panel')?.querySelectorAll('[data-tooltip-id]') || []).map(b => ({
            tooltip: b.getAttribute('data-tooltip-id'),
            rect: (() => { const r = b.getBoundingClientRect(); return r.x + ',' + r.y + ' ' + r.width + 'x' + r.height; })(),
        }))
    )`);
    const buttons = JSON.parse(buttonsRaw);
    buttons.forEach(b => console.log('  ' + b.tooltip + '  @' + b.rect));

    // 当前对话消息数
    const msgCount = await cdpEval(ws, `document.querySelector('#conversation')?.querySelectorAll('.leading-relaxed.select-text').length || 0`);
    console.log('\n消息数(点击前):', msgCount);

    // 查找按钮
    console.log('\n--- 查找 new-chat 按钮 ---');
    // 注意: tooltip 名字叫 "new-conversation-tooltip" 而不是 "new-chat-tooltip" !
    const btnRaw = await cdpEval(ws, `(() => {
        let btn = document.querySelector('[data-tooltip-id="new-chat-tooltip"]');
        let m = 'new-chat-tooltip';
        if (!btn) {
            btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            m = 'new-conversation-tooltip';
        }
        if (!btn) {
            const histBtn = document.querySelector('[data-tooltip-id="history-tooltip"]');
            if (histBtn) { btn = histBtn.previousElementSibling; m = 'history-sibling'; }
        }
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return JSON.stringify({ method: m, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
    })()`);

    if (!btnRaw) { console.log('❌ 未找到按钮'); ws.close(); return; }
    const btn = JSON.parse(btnRaw);
    console.log('定位方式:', btn.method);
    console.log('坐标:', btn.x, btn.y);

    // 点击
    console.log('\n--- 执行点击 ---');
    await clickAt(ws, btn.x, btn.y);
    console.log('已点击');
    await sleep(1500);

    // 点击后
    const msgCountAfter = await cdpEval(ws, `document.querySelector('#conversation')?.querySelectorAll('.leading-relaxed.select-text').length || 0`);
    const hasInput = await cdpEval(ws, `!!document.querySelector('.antigravity-agent-side-panel div[role="textbox"][contenteditable="true"]')`);
    const placeholder = await cdpEval(ws, `document.querySelector('.antigravity-agent-side-panel div[role="textbox"]')?.getAttribute('data-placeholder') || ''`);

    console.log('\n--- 点击后状态 ---');
    console.log('消息数(点击后):', msgCountAfter);
    console.log('输入框存在:', hasInput);
    console.log('Placeholder:', placeholder);

    // 面板可见文本(前300字)
    const panelText = await cdpEval(ws, `(document.querySelector('.antigravity-agent-side-panel')?.innerText || '').substring(0, 300)`);
    console.log('\n--- 面板可见文本(前300字) ---');
    console.log(panelText);

    ws.close();
    console.log('\n✅ 完成');
}
main().catch(e => console.error('错误:', e.message));
