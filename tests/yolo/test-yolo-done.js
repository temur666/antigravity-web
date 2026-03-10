/**
 * tests/yolo/test-yolo-done.js — yolo-done.js 单元测试
 *
 * 测试项:
 *   1. 标记文件写入
 *   2. 标记文件内容格式
 *   3. Telegram 通知发送
 *   4. 无摘要参数时的默认值
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MARKER_FILE = path.join(ROOT, '.yolo-done');
const YOLO_DONE_SCRIPT = path.join(ROOT, 'scripts', 'yolo-done.js');

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

function cleanup() {
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }
}

async function runTests() {
    console.log('=== yolo-done.js 测试 ===\n');

    // ========== 测试 1: 标记文件写入（带摘要） ==========
    console.log('--- 测试 1: 标记文件写入（带摘要）---');
    cleanup();

    try {
        execSync(`node "${YOLO_DONE_SCRIPT}" "测试摘要 - 单元测试"`, {
            cwd: ROOT,
            timeout: 15000,
        });
    } catch (err) {
        console.log(`  执行输出: ${err.stdout?.toString() || ''}`);
        console.log(`  执行错误: ${err.stderr?.toString() || ''}`);
    }

    assert(fs.existsSync(MARKER_FILE), '标记文件存在');

    if (fs.existsSync(MARKER_FILE)) {
        const content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
        assert(content.summary === '测试摘要 - 单元测试', '摘要内容正确');
        assert(typeof content.completedAt === 'string', 'completedAt 是字符串');
        assert(content.completedAt.includes('T'), 'completedAt 是 ISO 格式');
        const ts = new Date(content.completedAt);
        assert(!isNaN(ts.getTime()), 'completedAt 可解析为有效日期');
        const drift = Math.abs(Date.now() - ts.getTime());
        assert(drift < 10000, `时间戳偏差合理 (${drift}ms < 10s)`);
    }

    // ========== 测试 2: 无摘要参数 ==========
    console.log('\n--- 测试 2: 无摘要参数 ---');
    cleanup();

    try {
        execSync(`node "${YOLO_DONE_SCRIPT}"`, {
            cwd: ROOT,
            timeout: 15000,
        });
    } catch { /* ignore */ }

    if (fs.existsSync(MARKER_FILE)) {
        const content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
        assert(content.summary === '(无摘要)', '默认摘要为 "(无摘要)"');
    } else {
        assert(false, '标记文件应存在（无摘要模式）');
    }

    // ========== 测试 3: 标记文件覆盖写入 ==========
    console.log('\n--- 测试 3: 标记文件覆盖写入 ---');
    // 不清理，直接再次写入
    try {
        execSync(`node "${YOLO_DONE_SCRIPT}" "第二次写入"`, {
            cwd: ROOT,
            timeout: 15000,
        });
    } catch { /* ignore */ }

    if (fs.existsSync(MARKER_FILE)) {
        const content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
        assert(content.summary === '第二次写入', '覆盖写入后摘要更新');
    }

    // ========== 测试 4: 含特殊字符的摘要 ==========
    console.log('\n--- 测试 4: 含特殊字符的摘要 ---');
    cleanup();

    try {
        execSync(`node "${YOLO_DONE_SCRIPT}" "包含 <b>HTML</b> & 特殊字符 \\"引号\\""`, {
            cwd: ROOT,
            timeout: 15000,
        });
    } catch { /* ignore */ }

    if (fs.existsSync(MARKER_FILE)) {
        const content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
        assert(content.summary.includes('HTML'), '特殊字符摘要包含 HTML');
        assert(content.summary.includes('&'), '特殊字符摘要包含 &');
    }

    // ========== 测试 5: Telegram API 可达性 ==========
    console.log('\n--- 测试 5: Telegram API 可达性 ---');
    const https = require('https');
    const { BOT_TOKEN } = require(path.join(ROOT, 'lib/telegram/config'));

    const telegramReachable = await new Promise((resolve) => {
        const req = https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { timeout: 10000 }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve({ ok: data.ok, botName: data.result?.username });
                } catch {
                    resolve({ ok: false });
                }
            });
        });
        req.on('error', () => resolve({ ok: false }));
    });

    assert(telegramReachable.ok === true, `Telegram Bot API 可达 (bot: @${telegramReachable.botName || 'unknown'})`);

    // ========== 清理 ==========
    cleanup();

    // ========== 总结 ==========
    console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
