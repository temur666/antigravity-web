/**
 * monitor-targets.js — 轮询监控 CDP 目标变化
 * 
 * 每隔 N 秒查询 CDP /json，检测新增/移除的窗口并打印
 * Usage: node tools/monitor-targets.js [间隔秒数=3]
 */
const http = require('http');

const CDP_PORT = process.env.CDP_PORT || 9000;
const INTERVAL = (Number(process.argv[2]) || 3) * 1000;

let previous = new Map(); // id → { type, title, url }
let firstRun = true;

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch { reject(new Error('JSON parse error')); }
            });
        }).on('error', reject);
    });
}

function shortUrl(url) {
    if (!url) return '';
    if (url.includes('workbench.html')) return '[workbench]';
    if (url.length > 60) return url.substring(0, 57) + '...';
    return url;
}

function icon(type, title) {
    if (type === 'worker') return '⚙️';
    if (title.includes('SSH')) return '🌐';
    if (title === 'Manager') return '🏠';
    if (title === 'Launchpad') return '🚀';
    return '📂';
}

function ts() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

async function poll() {
    let targets;
    try {
        targets = await httpGet(`http://127.0.0.1:${CDP_PORT}/json`);
    } catch (e) {
        if (previous.size > 0) {
            console.log(`\n[${ts()}] ❌ CDP 连接断开: ${e.message}`);
            previous.clear();
        }
        return;
    }

    const current = new Map();
    for (const t of targets) {
        current.set(t.id, {
            type: t.type,
            title: t.title || '(untitled)',
            url: t.url || '',
        });
    }

    if (firstRun) {
        console.log(`[${ts()}] 🔍 初始状态 — ${current.size} 个目标:`);
        for (const [id, t] of current) {
            console.log(`  ${icon(t.type, t.title)} ${t.type.padEnd(8)} "${t.title}"  ${shortUrl(t.url)}`);
        }
        console.log(`\n[${ts()}] 👀 开始监控... (每 ${INTERVAL / 1000}s 轮询)\n`);
        firstRun = false;
        previous = current;
        return;
    }

    // 检测新增
    for (const [id, t] of current) {
        if (!previous.has(id)) {
            console.log(`[${ts()}] ➕ 新增  ${icon(t.type, t.title)} ${t.type} "${t.title}"  ${shortUrl(t.url)}`);
        }
    }

    // 检测移除
    for (const [id, t] of previous) {
        if (!current.has(id)) {
            console.log(`[${ts()}] ➖ 移除  ${icon(t.type, t.title)} ${t.type} "${t.title}"  ${shortUrl(t.url)}`);
        }
    }

    // 检测标题变化（窗口还在但标题改了，比如切换了对话）
    for (const [id, t] of current) {
        const old = previous.get(id);
        if (old && old.title !== t.title) {
            console.log(`[${ts()}] 🔄 变更  ${icon(t.type, t.title)} "${old.title}" → "${t.title}"`);
        }
    }

    previous = current;
}

// 启动
console.log('═'.repeat(60));
console.log('CDP 目标监控器');
console.log(`端口: ${CDP_PORT}  间隔: ${INTERVAL / 1000}s`);
console.log('═'.repeat(60));
console.log('');

poll();
setInterval(poll, INTERVAL);
