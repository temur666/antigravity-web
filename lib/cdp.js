/**
 * lib/cdp.js — CDP (Chrome DevTools Protocol) 通信层 + 连接管理
 *
 * 提供与 Antigravity IDE 的 CDP 连接、消息发送和 JS 求值能力。
 * 所有需要通过 CDP 控制浏览器的模块都应使用此文件。
 */

const http = require('http');
const WebSocket = require('ws');

// ========== 工具函数 ==========

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse failed`)); }
            });
        }).on('error', reject);
    });
}

// ========== CDP 通信 ==========

let msgId = 1;

function cdpSend(ws, method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error(`WebSocket not open`));
            return;
        }
        const id = msgId++;
        const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
        const handler = (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id === id) {
                cleanup();
                if (msg.error) reject(new Error(`CDP: ${msg.error.message}`));
                else resolve(msg.result);
            }
        };
        const closeHandler = () => { cleanup(); reject(new Error(`WebSocket closed`)); };
        function cleanup() { clearTimeout(timeout); ws.off('message', handler); ws.off('close', closeHandler); }
        ws.on('message', handler);
        ws.on('close', closeHandler);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function cdpEval(ws, expression) {
    const result = await cdpSend(ws, 'Runtime.evaluate', { expression, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Eval error');
    return result?.result?.value;
}

// ========== CDP 连接管理 ==========

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT || '9000');

const RECONNECT_DELAYS = [3000, 5000, 10000, 20000];
const MAX_RECONNECT_ATTEMPTS = 50;

const state = {
    cdpWs: null,
    cdpConnected: false,
};

let reconnectAttempts = 0;
let reconnectTimer = null;
let onStatusChange = null; // 外部回调

async function connectCDP() {
    try {
        if (state.cdpWs) {
            try { state.cdpWs.removeAllListeners(); state.cdpWs.terminate(); } catch { }
        }
        const targets = await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`);
        const mainTarget = targets.find(t => t.type === 'page' && t.title.includes('Antigravity'));
        if (!mainTarget) throw new Error('未找到 Antigravity 主窗口');

        const ws = new WebSocket(mainTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

        // 心跳
        let pongReceived = true;
        const pingTimer = setInterval(() => {
            if (!pongReceived) { clearInterval(pingTimer); ws.terminate(); return; }
            pongReceived = false;
            try { ws.ping(); } catch { clearInterval(pingTimer); }
        }, 20000);
        ws.on('pong', () => { pongReceived = true; });
        ws.on('close', () => { clearInterval(pingTimer); state.cdpConnected = false; console.log('⚠️  CDP 断开'); scheduleReconnect(); });
        ws.on('error', (err) => { console.error('❌ CDP error:', err.message); clearInterval(pingTimer); });

        await cdpSend(ws, 'Runtime.enable');
        await cdpSend(ws, 'Page.enable');

        state.cdpWs = ws;
        state.cdpConnected = true;
        reconnectAttempts = 0;
        console.log(`✅ CDP 已连接 → ${mainTarget.title}`);

        if (onStatusChange) onStatusChange(true);
        return true;
    } catch (err) {
        state.cdpConnected = false;
        console.error('❌ CDP 连接失败:', err.message);
        return false;
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    const delayIdx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
    const delay = RECONNECT_DELAYS[delayIdx];
    reconnectAttempts++;
    console.log(`🔄 ${delay / 1000}s 后重连 (第 ${reconnectAttempts} 次)...`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        const ok = await connectCDP();
        if (!ok) scheduleReconnect();
    }, delay);
}

function forceReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    return connectCDP();
}

module.exports = {
    sleep,
    httpGet,
    cdpSend,
    cdpEval,
    state,
    connectCDP,
    forceReconnect,
    CDP_HOST,
    CDP_PORT,
    set onStatusChange(fn) { onStatusChange = fn; },
};
