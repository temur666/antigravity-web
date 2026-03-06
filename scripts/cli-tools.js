#!/usr/bin/env node
/**
 * CLI 版本的自定义工具 -- 通过命令行调用而非 MCP
 * 
 * 用法:
 *   node tools/server-status.js              # 获取服务器状态
 *   node tools/write-note.js "标题" "内容"     # 写笔记
 */
const cmd = process.argv[2];

if (cmd === 'status') {
    const os = require('os');
    const { execSync } = require('child_process');
    const uptime = os.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
    let disk = 'N/A';
    try { disk = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", { encoding: 'utf-8' }).trim(); } catch { }

    console.log(JSON.stringify({
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        uptime: `${h}h ${m}m`,
        memory: { total: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB`, free: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)}GB`, used: `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)}%` },
        disk, cpus: os.cpus().length, load: os.loadavg().map(l => l.toFixed(2)).join(', '),
        timestamp: new Date().toISOString()
    }, null, 2));
} else if (cmd === 'note') {
    const fs = require('fs'), path = require('path');
    const title = process.argv[3] || 'Untitled';
    const content = process.argv[4] || '';
    const dir = '/home/tiemuer/antigravity-web/tmp/notes';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `${ts}-${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 50)}.md`);
    fs.writeFileSync(file, `# ${title}\n\n> ${new Date().toISOString()}\n\n${content}\n`);
    console.log(`笔记已保存: ${file}`);
} else {
    console.log('用法: node cli-tools.js status | note "标题" "内容"');
}
