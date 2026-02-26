#!/usr/bin/env node
/**
 * cdp-inspect.js — CDP 窗口全景探测工具
 *
 * 合并自探索阶段的多个脚本，保留成功验证的功能：
 *   1. 列出所有 CDP 目标（page / worker）
 *   2. 自动分类每个窗口角色（IDE 工作区 / Agent Manager / Worker）
 *   3. 检测 IDE 窗口的可见性/焦点状态
 *   4. 检测共享同一 Electron BrowserWindow 的窗口组
 *   5. 探测 Agent Manager 的内容（工作区列表、对话数等）
 *
 * 用法:
 *   node tools/cdp-inspect.js                    # 完整报告
 *   node tools/cdp-inspect.js --quick            # 仅列出 + 分类，不连接探测
 *   node tools/cdp-inspect.js 192.168.1.100 9222 # 自定义 host + port
 *
 * 发现记录 (2026-02-25):
 *   - Antigravity IDE 的每个工作区是一个独立的 CDP page target
 *   - 工作区窗口可能共享同一个 Electron BrowserWindow（通过标签切换）
 *   - Manager / Launchpad 是 AI Agent (Jetski) 管理窗口
 *   - 每个工作区关联 0~2 个 worker（Extension Host 等）
 *   - 关闭一个工作区 page 会连带清理其 worker
 */

const http = require('http');
const WebSocket = require('ws');

// ========== 配置 ==========

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const quickMode = flags.includes('--quick');

const host = args[0] || process.env.CDP_HOST || '127.0.0.1';
const port = Number(args[1] || process.env.CDP_PORT || '9000');

// ========== CDP 基础工具 ==========

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse failed: ${data.substring(0, 200)}`)); }
            });
        }).on('error', reject);
    });
}

let msgId = 1;

function cdpSend(ws, method, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('WS not open')); return; }
        const id = msgId++;
        const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
        const handler = (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id === id) { cleanup(); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
        };
        function cleanup() { clearTimeout(timeout); ws.off('message', handler); }
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function cdpEval(ws, expression) {
    const result = await cdpSend(ws, 'Runtime.evaluate', { expression, returnByValue: true });
    if (result?.exceptionDetails) return null;
    return result?.result?.value;
}

async function connectTarget(target) {
    if (!target.webSocketDebuggerUrl) return null;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('connect timeout')); }, 3000);
        ws.on('open', () => { clearTimeout(timer); resolve(); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    await cdpSend(ws, 'Runtime.enable');
    return ws;
}

// ========== 窗口分类逻辑 ==========

function classifyTarget(target) {
    const title = (target.title || '').toLowerCase();
    const url = (target.url || '').toLowerCase();

    if (target.type === 'worker') return { role: 'worker', icon: '⚙️', desc: 'Worker 进程' };

    if (url.includes('jetski') || url.includes('workbench-jetski-agent')) {
        return { role: 'agent', icon: '🤖', desc: `Agent Manager — ${target.title}` };
    }
    if (title.includes('antigravity')) {
        const project = target.title.split(' - ')[0].trim();
        return { role: 'ide', icon: '🖥️', desc: `IDE 工作区 — ${project}` };
    }
    return { role: 'other', icon: '❓', desc: `其他 — ${target.title || '(无标题)'}` };
}

// ========== 深度探测 ==========

async function inspectIDEWindow(target) {
    let ws;
    try {
        ws = await connectTarget(target);
        const raw = await cdpEval(ws, `
            JSON.stringify({
                hidden: document.hidden,
                vis: document.visibilityState,
                focus: document.hasFocus(),
                x: window.screenX, y: window.screenY,
                w: window.outerWidth, h: window.outerHeight,
                hasEditor: !!document.querySelector('.monaco-editor'),
                hasChat: !!document.querySelector('[class*="chat"], [class*="cascade"], [class*="aichat"]'),
                hasSidebar: !!document.querySelector('.sidebar, .activitybar'),
                hasTerminal: !!document.querySelector('.terminal, .xterm'),
            })
        `);
        return JSON.parse(raw);
    } catch (err) {
        return { error: err.message };
    } finally {
        if (ws?.readyState === WebSocket.OPEN) ws.close();
    }
}

async function inspectAgentManager(target) {
    let ws;
    try {
        ws = await connectTarget(target);
        const text = await cdpEval(ws, `document.body?.innerText || ''`);
        const buttonsJson = await cdpEval(ws, `
            JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean))
        `);
        const inputsJson = await cdpEval(ws, `
            JSON.stringify(Array.from(document.querySelectorAll('input, textarea')).map(i => ({
                type: i.type, placeholder: i.placeholder || ''
            })))
        `);
        return {
            text: text || '',
            buttons: JSON.parse(buttonsJson || '[]'),
            inputs: JSON.parse(inputsJson || '[]'),
        };
    } catch (err) {
        return { error: err.message };
    } finally {
        if (ws?.readyState === WebSocket.OPEN) ws.close();
    }
}

// ========== 主流程 ==========

async function main() {
    console.log(`\n🔍 CDP 窗口全景探测 — http://${host}:${port}`);
    console.log(`   模式: ${quickMode ? '快速 (仅列表)' : '完整 (含深度探测)'}\n`);

    // 1) 获取所有目标
    let targets;
    try {
        targets = await httpGet(`http://${host}:${port}/json`);
    } catch (err) {
        console.error(`❌ 连接失败: ${err.message}`);
        process.exit(1);
    }

    // 2) 分类
    const classified = targets.map((t, i) => ({
        index: i, ...t, ...classifyTarget(t),
    }));

    const byRole = { ide: [], agent: [], worker: [], other: [] };
    classified.forEach(t => byRole[t.role].push(t));

    // 3) 统计总览
    console.log('═'.repeat(70));
    console.log(`📊 目标总数: ${targets.length}  |  IDE: ${byRole.ide.length}  |  Agent: ${byRole.agent.length}  |  Worker: ${byRole.worker.length}  |  其他: ${byRole.other.length}`);
    console.log('═'.repeat(70));

    // 4) IDE 工作区
    if (byRole.ide.length > 0) {
        console.log(`\n🖥️  IDE 工作区 (${byRole.ide.length}):`);
        console.log('─'.repeat(70));

        for (const t of byRole.ide) {
            const project = t.title.split(' - ')[0].trim();
            let statusStr = '';

            if (!quickMode) {
                const info = await inspectIDEWindow(t);
                if (info.error) {
                    statusStr = `  ❌ ${info.error}`;
                } else {
                    const status = info.hidden ? '👻隐藏' : (info.focus ? '🟢前台' : '🟡可见');
                    const features = [
                        info.hasChat ? 'Chat✅' : 'Chat❌',
                        info.hasEditor ? '编辑器✅' : '',
                        info.hasTerminal ? '终端✅' : '',
                    ].filter(Boolean).join(' ');
                    statusStr = `  ${status}  (${info.x},${info.y}) ${info.w}×${info.h}  ${features}`;
                }
            }

            console.log(`  [${t.index}] ${project}${statusStr}`);
            console.log(`       ID: ${t.id}`);
        }
    }

    // 5) Agent Manager
    if (byRole.agent.length > 0) {
        console.log(`\n🤖 Agent Manager (${byRole.agent.length}):`);
        console.log('─'.repeat(70));

        for (const t of byRole.agent) {
            console.log(`  [${t.index}] ${t.title}`);
            console.log(`       ID: ${t.id}`);
            console.log(`       URL: ${t.url}`);

            if (!quickMode) {
                const info = await inspectAgentManager(t);
                if (info.error) {
                    console.log(`       ❌ ${info.error}`);
                } else {
                    // 提取工作区列表和对话数
                    const seeAllMatch = info.text.match(/See all \((\d+)\)/);
                    if (seeAllMatch) {
                        console.log(`       📝 对话总数: ${seeAllMatch[1]}`);
                    }
                    if (info.buttons.length > 0) {
                        console.log(`       🖱️ 按钮: ${info.buttons.slice(0, 10).join(' | ')}`);
                    }
                    if (info.inputs.length > 0) {
                        console.log(`       📝 输入框: ${info.inputs.map(i => `[${i.type}] "${i.placeholder}"`).join(', ')}`);
                    }
                }
            }
        }
    }

    // 6) Worker
    if (byRole.worker.length > 0) {
        console.log(`\n⚙️  Worker 进程 (${byRole.worker.length}):`);
        console.log('─'.repeat(70));
        byRole.worker.forEach(t => {
            console.log(`  [${t.index}] ID: ${t.id}`);
        });
    }

    // 7) 窗口分组分析（仅完整模式）
    if (!quickMode && byRole.ide.length > 1) {
        console.log(`\n📐 窗口分组分析:`);
        console.log('─'.repeat(70));

        const posGroups = {};
        for (const t of byRole.ide) {
            const info = await inspectIDEWindow(t);
            if (!info.error) {
                const key = `${info.x},${info.y},${info.w},${info.h}`;
                if (!posGroups[key]) posGroups[key] = [];
                posGroups[key].push(t.title.split(' - ')[0].trim());
            }
        }

        Object.entries(posGroups).forEach(([pos, projects]) => {
            if (projects.length > 1) {
                console.log(`  📌 共享 BrowserWindow (${pos}): ${projects.join(', ')}`);
                console.log(`     ↳ 这些工作区通过标签页切换，不是独立窗口`);
            } else {
                console.log(`  🪟 独立窗口 (${pos}): ${projects[0]}`);
            }
        });
    }

    console.log('\n' + '═'.repeat(70));
    console.log('探测完成\n');
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
