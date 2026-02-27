/**
 * explore-manager.js — 连接 Manager 窗口，探测内部 API 和对话数据
 */
const { httpGet, cdpSend, cdpEval, sleep } = require('../lib/cdp');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'manager-explore.txt');

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    const targets = await httpGet('http://127.0.0.1:9000/json');

    // 找 Manager 窗口
    const managers = targets.filter(t =>
        t.type === 'page' && t.url && t.url.includes('workbench-jetski-agent')
    );

    log(`找到 ${managers.length} 个 Manager/Agent 窗口:`);
    managers.forEach((m, i) => log(`  [${i}] ${m.title} — ${m.url.substring(0, 100)}`));
    log('');

    for (const manager of managers) {
        log('═'.repeat(80));
        log(`连接到: ${manager.title}`);
        log('═'.repeat(80));

        let ws;
        try {
            ws = new WebSocket(manager.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('timeout')), 5000);
            });
            await cdpSend(ws, 'Runtime.enable');
            log('✅ 已连接');

            // 1. 探测全局对象和 API
            log('\n━━━ 全局对象探测 ━━━');
            const globals = await cdpEval(ws, `(() => {
                const interesting = [];
                // 检查 window 上的特殊属性
                for (const key of Object.keys(window)) {
                    if (/api|service|store|manager|agent|conversation|trajectory|jetski|brain/i.test(key)) {
                        interesting.push(key + ': ' + typeof window[key]);
                    }
                }
                // 检查 vscode api
                if (typeof acquireVsCodeApi !== 'undefined') interesting.push('acquireVsCodeApi: available');
                if (window._vscodeApi) interesting.push('_vscodeApi: available');
                
                return JSON.stringify(interesting);
            })()`);
            log('全局特殊属性:');
            JSON.parse(globals).forEach(g => log(`  ${g}`));

            // 2. 检查 DOM 结构
            log('\n━━━ DOM 结构 ━━━');
            const dom = await cdpEval(ws, `(() => {
                const body = document.body;
                const result = {
                    bodyClasses: body.className,
                    childCount: body.children.length,
                    innerHTML_preview: body.innerHTML.substring(0, 3000),
                };
                
                // 搜索对话相关的元素
                const selectors = [
                    '.conversation', '#conversation', '[class*="conversation"]',
                    '[class*="trajectory"]', '[class*="agent"]', '[class*="chat"]',
                    '[class*="jetski"]', '[class*="manager"]',
                    'iframe', 'webview',
                    '.monaco-list', '.monaco-list-row',
                ];
                result.found = {};
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) result.found[sel] = els.length;
                }
                
                return JSON.stringify(result);
            })()`);
            const domInfo = JSON.parse(dom);
            log('Body classes:', domInfo.bodyClasses);
            log('Child count:', domInfo.childCount);
            log('找到的元素:');
            for (const [sel, count] of Object.entries(domInfo.found)) {
                log(`  ${sel}: ${count}`);
            }
            log('\nHTML 预览:');
            log(domInfo.innerHTML_preview);

            // 3. 开启 Network 监听并探测 Manager 发出的请求
            log('\n━━━ Network 监听 (等待 3 秒) ━━━');
            const netRequests = [];
            await cdpSend(ws, 'Network.enable');

            const netHandler = (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.method === 'Network.requestWillBeSent') {
                        netRequests.push({
                            url: msg.params.request.url,
                            method: msg.params.request.method,
                        });
                    }
                } catch { }
            };
            ws.on('message', netHandler);
            await sleep(3000);
            ws.off('message', netHandler);
            await cdpSend(ws, 'Network.disable');

            log(`捕获到 ${netRequests.length} 个请求:`);
            netRequests.forEach(r => log(`  ${r.method} ${r.url}`));

            // 4. 尝试通过 postMessage / vscode API 获取数据
            log('\n━━━ vscode API 探测 ━━━');
            const vsapi = await cdpEval(ws, `(() => {
                const results = [];
                
                // 检查 vscode 全局
                if (typeof vscode !== 'undefined') results.push('vscode global exists');
                if (typeof acquireVsCodeApi !== 'undefined') results.push('acquireVsCodeApi exists');
                
                // 检查 webview 通信
                const iframes = document.querySelectorAll('iframe');
                results.push('iframes: ' + iframes.length);
                iframes.forEach((f, i) => {
                    results.push('  iframe[' + i + ']: src=' + (f.src || f.getAttribute('src') || 'none'));
                });
                
                // 检查 React/状态管理
                const reactRoot = document.querySelector('#root') || document.querySelector('[data-reactroot]');
                if (reactRoot) {
                    results.push('React root found');
                    // 尝试获取 React fiber
                    const fiberKey = Object.keys(reactRoot).find(k => k.startsWith('__reactFiber'));
                    if (fiberKey) results.push('React fiber key: ' + fiberKey);
                }
                
                // 扫描所有 script 标签
                const scripts = document.querySelectorAll('script');
                results.push('scripts: ' + scripts.length);
                scripts.forEach((s, i) => {
                    if (s.src) results.push('  script[' + i + ']: ' + s.src.substring(0, 150));
                });
                
                return JSON.stringify(results);
            })()`);
            JSON.parse(vsapi).forEach(r => log(`  ${r}`));

            // 5. 尝试执行 vscode 内部命令
            log('\n━━━ 尝试 vscode 内部 API ━━━');
            const internalApi = await cdpEval(ws, `(() => {
                const results = [];
                
                // 尝试找到 workbench 服务
                try {
                    // Electron 的 require
                    if (typeof require !== 'undefined') {
                        results.push('require available');
                    }
                } catch(e) { results.push('require: ' + e.message); }
                
                // 检查 performance entries (可能泄露 API 端点)
                const entries = performance.getEntriesByType('resource');
                const apiEntries = entries.filter(e => 
                    /googleapis|api|trajectory|conversation|jetski|brain/i.test(e.name)
                );
                results.push('Performance API entries (filtered): ' + apiEntries.length);
                apiEntries.forEach(e => results.push('  ' + e.name.substring(0, 200)));
                
                // 所有 resource entries 的域名
                const domains = {};
                entries.forEach(e => {
                    try {
                        const url = new URL(e.name);
                        domains[url.hostname] = (domains[url.hostname] || 0) + 1;
                    } catch {}
                });
                results.push('Resource domains:');
                for (const [d, c] of Object.entries(domains)) {
                    results.push('  ' + d + ': ' + c);
                }
                
                return JSON.stringify(results);
            })()`);
            JSON.parse(internalApi).forEach(r => log(`  ${r}`));

            ws.close();
        } catch (e) {
            log(`❌ 错误: ${e.message}`);
            if (ws) try { ws.close(); } catch { }
        }
        log('');
    }

    // 也探测 Worker 进程
    log('═'.repeat(80));
    log('Worker 进程探测');
    log('═'.repeat(80));
    const workers = targets.filter(t => t.type === 'other' || (t.type === 'page' && !t.url));
    log(`Worker 数: ${workers.length}`);
    workers.forEach((w, i) => {
        log(`  [${i}] type=${w.type}, title="${w.title}", url=${(w.url || '').substring(0, 100)}`);
    });

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
