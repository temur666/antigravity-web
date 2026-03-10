/**
 * tests/yolo/test-yolo-e2e.js — YOLO E2E 集成测试
 *
 * 端到端测试完整 YOLO 流程:
 *   1. 启动 yolo.js（短超时，agentic 模式）
 *   2. yolo.js 发送测试任务文档
 *   3. AI 读取后执行 yolo-done.js
 *   4. yolo.js 检测到标记文件并停止
 *   5. 验证标记文件内容和日志文件
 *
 * 超时: 3 分钟（AI 处理 + 执行 hook）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MARKER_FILE = path.join(ROOT, '.yolo-done');
const LOG_DIR = path.join(ROOT, 'logs');
const TASK_DOC = path.join(ROOT, 'docs/tasks/yolo-test.md');
const YOLO_SCRIPT = path.join(ROOT, 'scripts', 'yolo.js');

// 清理
try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }

console.log('=== YOLO E2E 测试 ===');
console.log(`  任务文档: ${TASK_DOC}`);
console.log(`  CSRF: (自动发现)`);
console.log(`  超时: 180s\n`);

const startTime = Date.now();
let output = '';

// 不传 --csrf，验证 yolo.js 的 discoverLS() 自动发现
const child = spawn('node', [
    YOLO_SCRIPT,
    TASK_DOC,
    '--timeout', '180',
    '--cooldown', '3',
    '--poll-interval', '2',
    '--agentic',
], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stdout.write(text);
});

child.stderr.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stderr.write(text);
});

// 超时保护: 3 分钟
const timeout = setTimeout(() => {
    console.log('\n[E2E] 3 分钟超时，强制终止');
    child.kill('SIGTERM');
}, 180000);

child.on('close', (code) => {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n=== E2E 结果 ===`);
    console.log(`  耗时: ${elapsed}s`);
    console.log(`  退出码: ${code}`);

    let passed = 0;
    let failed = 0;

    function assert(condition, label) {
        if (condition) {
            console.log(`  [PASS] ${label}`);
            passed++;
        } else {
            console.log(`  [FAIL] ${label}`);
            failed++;
        }
    }

    // 验证 1: 正常退出
    assert(code === 0 || code === null, `退出码为 0 (实际: ${code})`);

    // 验证 2: 标记文件存在
    const markerExists = fs.existsSync(MARKER_FILE);
    assert(markerExists, '熔断标记文件存在');

    if (markerExists) {
        const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
        assert(marker.summary && marker.summary.length > 0, `标记摘要非空: ${marker.summary}`);
        assert(typeof marker.completedAt === 'string', '标记时间戳存在');
    }

    // 验证 3: 输出包含关键日志
    assert(output.includes('YOLO 模式启动'), '日志包含启动');
    assert(output.includes('首条消息已发送'), '日志包含消息发送');
    assert(output.includes('完成标记') || output.includes('YOLO 模式结束'), '日志包含结束信号');

    // 验证 4: 日志文件生成
    const logFiles = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter(f => f.startsWith('yolo-')) : [];
    assert(logFiles.length > 0, `日志文件存在 (${logFiles.length} 个)`);

    if (logFiles.length > 0) {
        const latestLog = logFiles.sort().pop();
        const logContent = fs.readFileSync(path.join(LOG_DIR, latestLog), 'utf-8');
        assert(logContent.includes('YOLO 模式启动'), '日志文件包含启动记录');
        assert(logContent.length > 100, `日志文件非空 (${logContent.length} 字符)`);
    }

    // 清理
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }

    console.log(`\n=== E2E 总结: ${passed} 通过, ${failed} 失败 (耗时 ${elapsed}s) ===`);
    process.exit(failed > 0 ? 1 : 0);
});
