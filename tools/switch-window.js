#!/usr/bin/env node
/**
 * switch-window.js — 管理 Antigravity IDE 窗口（切换/关闭）
 *
 * 用法:
 *   node switch-window.js                        # 列出所有窗口，交互选择
 *   node switch-window.js 0                      # 切换到第 0 个窗口
 *   node switch-window.js antigravity-web         # 按项目名模糊匹配切换
 *   node switch-window.js metallic                # 模糊匹配 metallic-meteor
 *   node switch-window.js --close phantom         # 关闭 phantom-void 窗口
 *   node switch-window.js --close 3               # 关闭第 3 个窗口
 */

const http = require('http');
const WebSocket = require('ws');
const readline = require('readline');

const host = process.env.CDP_HOST || '127.0.0.1';
const port = Number(process.env.CDP_PORT || '9000');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
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

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function getBrowserWs() {
    const versionInfo = await httpGet(`http://${host}:${port}/json/version`);
    if (!versionInfo.webSocketDebuggerUrl) throw new Error('无法获取 browser WebSocket URL');
    const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 3000);
        ws.on('open', () => { clearTimeout(timer); resolve(); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    return ws;
}

async function connectPage(target) {
    if (!target.webSocketDebuggerUrl) throw new Error('无 WS URL');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 3000);
        ws.on('open', () => { clearTimeout(timer); resolve(); });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    await cdpSend(ws, 'Runtime.enable');
    return ws;
}

async function getWindowList() {
    const targets = await httpGet(`http://${host}:${port}/json`);
    return targets.filter(t => t.type === 'page').map((t, i) => {
        const title = t.title || '(无标题)';
        const project = title.split(' - ')[0].trim();
        const isIDE = title.includes('Antigravity');
        const isAgent = (t.url || '').includes('jetski');
        let label = project;
        if (isAgent) label += ' [Agent]';
        else if (!isIDE) label += ' [其他]';
        return { index: i, target: t, project, label, title, isIDE, isAgent };
    });
}

function findMatch(windowList, query) {
    const idx = parseInt(query);
    if (!isNaN(idx) && idx >= 0 && idx < windowList.length) {
        return windowList[idx];
    }
    const lower = query.toLowerCase();
    return windowList.find(w =>
        w.project.toLowerCase().includes(lower) ||
        w.title.toLowerCase().includes(lower)
    );
}

function printWindowList(windowList) {
    console.log(`\n📋 可用窗口 (共 ${windowList.length} 个):\n`);
    windowList.forEach(w => {
        const tag = w.isAgent ? '🤖' : w.isIDE ? '🖥️' : '❓';
        console.log(`  ${tag} [${w.index}] ${w.label}`);
        console.log(`        ${w.title}`);
    });
    console.log('');
}

// ========== 切换窗口 ==========
async function activateWindow(target) {
    console.log(`\n🔄 正在切换到: ${target.title}`);

    // Target.activateTarget
    try {
        const browserWs = await getBrowserWs();
        await cdpSend(browserWs, 'Target.activateTarget', { targetId: target.id });
        console.log('   ✅ Target.activateTarget');
        browserWs.close();
    } catch (err) {
        console.log(`   ⚠️ Target.activateTarget: ${err.message}`);
    }

    // Page.bringToFront
    let ws;
    try {
        ws = await connectPage(target);
        await cdpSend(ws, 'Page.bringToFront');
        console.log('   ✅ Page.bringToFront');
    } catch (err) {
        console.log(`   ⚠️ Page.bringToFront: ${err.message}`);
    }

    // window.focus()
    if (ws) {
        try {
            await cdpEval(ws, 'window.focus()');
            console.log('   ✅ window.focus()');
        } catch { }

        const hasFocus = await cdpEval(ws, 'document.hasFocus()');
        console.log(`\n   📊 结果: hasFocus=${hasFocus}`);
        ws.close();
    }
}

// ========== 关闭窗口（闭环验证） ==========
async function closeWindow(target) {
    const targetId = target.id;
    const targetTitle = target.title;

    // Step 1: 观察 — 关闭前快照
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 Step 1: 观察当前窗口状态`);
    const beforeTargets = await httpGet(`http://${host}:${port}/json`);
    const beforePages = beforeTargets.filter(t => t.type === 'page');
    const beforeAll = beforeTargets.length;
    console.log(`   总目标: ${beforeAll}  |  页面窗口: ${beforePages.length}`);
    console.log(`   待关闭: "${targetTitle}" (ID: ${targetId.substring(0, 12)}...)`);

    // 确认目标存在
    const exists = beforeTargets.some(t => t.id === targetId);
    if (!exists) {
        console.log(`\n   ❌ 目标 ID 不在当前列表中，可能已被关闭`);
        return false;
    }
    console.log(`   ✅ 目标确认存在`);

    // Step 2: 关闭
    console.log(`\n🗑️  Step 2: 发送关闭指令`);
    let closeSuccess = false;
    try {
        const browserWs = await getBrowserWs();
        const result = await cdpSend(browserWs, 'Target.closeTarget', { targetId });
        browserWs.close();
        closeSuccess = !!result?.success;
        console.log(`   Target.closeTarget 返回: ${JSON.stringify(result)}`);
    } catch (err) {
        console.log(`   ❌ 关闭指令失败: ${err.message}`);
        return false;
    }

    if (!closeSuccess) {
        console.log(`   ❌ CDP 返回 success=false，关闭未成功`);
        return false;
    }
    console.log(`   ✅ CDP 确认关闭指令已接受`);

    // Step 3: 等待并重试验证（最多 3 次，每次间隔递增）
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [800, 1500, 3000];
    let afterTargets, afterPages, afterAll;
    let stillExists = true;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const waitMs = RETRY_DELAYS[attempt - 1];
        console.log(`\n⏳ Step 3.${attempt}: 等待 ${waitMs}ms 后验证 (第 ${attempt}/${MAX_RETRIES} 次)...`);
        await new Promise(r => setTimeout(r, waitMs));

        // Step 4: 重新观察
        console.log(`🔍 Step 4.${attempt}: 重新查询窗口列表`);
        afterTargets = await httpGet(`http://${host}:${port}/json`);
        afterPages = afterTargets.filter(t => t.type === 'page');
        afterAll = afterTargets.length;

        stillExists = afterTargets.some(t => t.id === targetId);

        if (!stillExists) {
            console.log(`   ✅ 目标 ID 已消失 (第 ${attempt} 次检查)`);
            break;
        } else {
            console.log(`   ⚠️ 目标 ID 仍然存在 (第 ${attempt} 次检查)`);
        }
    }

    // Step 5: 综合验证
    console.log(`\n📊 Step 5: 验证报告`);
    console.log(`   ${''.padEnd(20)} 关闭前    关闭后    变化`);
    console.log(`   ${'─'.repeat(50)}`);
    console.log(`   总目标数:         ${String(beforeAll).padEnd(10)}${String(afterAll).padEnd(10)}${afterAll - beforeAll}`);
    console.log(`   页面窗口数:       ${String(beforePages.length).padEnd(10)}${String(afterPages.length).padEnd(10)}${afterPages.length - beforePages.length}`);

    // 多维度判断
    const checks = [];
    checks.push({ name: '目标 ID 已消失', pass: !stillExists });
    checks.push({ name: '页面数有减少', pass: afterPages.length < beforePages.length });
    checks.push({ name: '总数有减少', pass: afterAll < beforeAll });

    console.log(`\n   验证项:`)
    checks.forEach(c => {
        console.log(`      ${c.pass ? '✅' : '❌'} ${c.name}`);
    });

    const allPassed = checks.every(c => c.pass);
    const criticalPassed = checks[0].pass; // ID 消失是核心判据

    if (!criticalPassed) {
        console.log(`\n   ❌ 验证失败！目标 "${targetTitle}" 仍然存在于窗口列表中！`);
        console.log(`   😱 经过 ${MAX_RETRIES} 次重试后窗口仍未关闭，请手动检查`);
        return false;
    }

    if (!allPassed) {
        console.log(`\n   ⚠️ 部分验证未通过（但核心验证通过）：目标已消失，窗口数变化异常`);
        console.log(`      可能原因: 关闭同时有新窗口打开，或 worker 未及时清理`);
    }

    console.log(`\n   🎉 最终结论: ${criticalPassed ? 'PASS — 窗口已成功关闭' : 'FAIL — 关闭失败'}`);

    // 显示剩余的 IDE 窗口
    const remainingIDE = afterPages.filter(t => (t.title || '').includes('Antigravity'));
    if (remainingIDE.length > 0) {
        console.log(`\n   📋 剩余 IDE 工作区窗口 (${remainingIDE.length}):`);
        remainingIDE.forEach(t => {
            const proj = t.title.split(' - ')[0].trim();
            console.log(`      🖥️  ${proj}`);
        });
    }

    return criticalPassed;
}

// ========== 主入口 ==========
async function main() {
    const args = process.argv.slice(2);

    // 解析 --close 标志
    const closeMode = args.includes('--close') || args.includes('-c');
    const query = args.filter(a => a !== '--close' && a !== '-c').join(' ');

    const windowList = await getWindowList();

    // 直接带参数执行
    if (query) {
        const match = findMatch(windowList, query);
        if (!match) {
            console.log(`❌ 未找到匹配 "${query}" 的窗口`);
            printWindowList(windowList);
            process.exit(1);
        }

        if (closeMode) {
            await closeWindow(match.target);
        } else {
            await activateWindow(match.target);
        }
        return;
    }

    // 交互模式
    printWindowList(windowList);

    const action = closeMode ? 'close' : await ask('操作 [s=切换, c=关闭] (默认切换): ');
    const isClose = action === 'c' || action === 'close';

    const answer = await ask(`输入窗口编号或名称 (q 退出): `);
    if (answer === 'q' || answer === '') { console.log('已取消'); return; }

    const match = findMatch(windowList, answer);
    if (!match) { console.log(`❌ 未找到 "${answer}"`); return; }

    if (isClose) {
        const confirm = await ask(`确定关闭 "${match.title}"? (y/n): `);
        if (confirm !== 'y') { console.log('已取消'); return; }
        await closeWindow(match.target);
    } else {
        await activateWindow(match.target);
    }
}

main().catch(err => {
    console.error(`\n❌ 错误: ${err.message}`);
    process.exit(1);
});
