/**
 * scripts/yolo.js — YOLO 自动驾驶模式 (CLI 入口)
 *
 * 通过 lib/yolo 引擎与 LS 对话，自动回复模板消息，实现无人值守的长时间运行。
 *
 * 用法:
 *   node scripts/yolo.js <参考文档.md> [选项]
 *   node scripts/yolo.js --task "任务指令" [选项]
 *
 * 选项:
 *   --task <文本>         直接传任务指令（与文件二选一）
 *   --timeout <秒>       最大运行时长（默认 7200 = 2小时）
 *   --port <端口>        LS 端口（自动发现）
 *   --csrf <token>       CSRF token（自动发现）
 *   --cascade <id>       复用已有对话
 *   --cooldown <秒>      自动回复前的冷却时间（默认 5 秒）
 *   --poll-interval <秒> 轮询间隔（默认 3 秒）
 *   --agentic            启用 agentic 模式
 */

const path = require('path');
const { YoloEngine, parseArgs, notifyDone } = require('../lib/yolo');

async function main() {
    const config = parseArgs();

    // 参数校验
    if (!config.docPath && !config.task) {
        console.error('用法:');
        console.error('  node scripts/yolo.js <参考文档.md> [选项]');
        console.error('  node scripts/yolo.js --task "你的任务指令" [选项]');
        console.error('');
        console.error('选项:');
        console.error('  --task <文本>         直接传任务指令（与文件二选一）');
        console.error('  --timeout <秒>       最大运行时长（默认 7200）');
        console.error('  --port <端口>        LS 端口（自动发现）');
        console.error('  --csrf <token>       CSRF token（自动发现）');
        console.error('  --cascade <id>       复用已有对话');
        console.error('  --cooldown <秒>      自动回复冷却时间（默认 5）');
        console.error('  --poll-interval <秒> 轮询间隔（默认 3）');
        console.error('  --agentic            启用 agentic 模式');
        process.exit(1);
    }

    if (config.docPath) {
        const fs = require('fs');
        const docFullPath = path.resolve(config.docPath);
        if (!fs.existsSync(docFullPath)) {
            console.error(`参考文档不存在: ${docFullPath}`);
            process.exit(1);
        }
    }

    const engine = new YoloEngine();

    // 监听事件 — 超时/错误时发 Telegram 通知
    engine.on('done', async ({ reason, summary, round }) => {
        if (reason === 'timeout' || reason === 'max_errors') {
            try {
                await notifyDone(`YOLO ${reason === 'timeout' ? '超时停止' : '因错误停止'} (${round} 轮): ${summary}`);
            } catch { /* ignore */ }
        }
    });

    await engine.start(config);
}

main().catch((err) => {
    console.error('[YOLO] 致命错误:', err);
    process.exit(1);
});
