/**
 * lib/yolo/__tests__/yolo.test.js — YOLO 模块单元测试
 *
 * Run: node lib/yolo/__tests__/yolo.test.js [--integration]
 *
 * 测试覆盖:
 *   - config: parseArgs, DEFAULTS, AUTO_REPLY_TEMPLATE
 *   - marker: check, clean, write, read
 *   - logger: Logger 类
 *   - engine: YoloEngine API, safeCall, sleep
 *   - notify: sendTelegram (--integration)
 *   - [--integration] gRPC 真实调用 + E2E
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  [PASS] ${name}`); passed++; }
    catch (e) { console.log(`  [FAIL] ${name}\n     ${e.message}`); failed++; }
}

async function testAsync(name, fn) {
    try { await fn(); console.log(`  [PASS] ${name}`); passed++; }
    catch (e) { console.log(`  [FAIL] ${name}\n     ${e.message}`); failed++; }
}

const { parseArgs, AUTO_REPLY_TEMPLATE, DEFAULTS } = require('../config');
const marker = require('../marker');
const { Logger } = require('../logger');
const { YoloEngine, safeCall, sleep } = require('../engine');

// ========== config ==========

console.log('\n--- config: parseArgs ---');

test('纯文档路径', () => {
    const c = parseArgs(['my-task.md']);
    assert.strictEqual(c.docPath, 'my-task.md');
    assert.strictEqual(c.agentic, false);
    assert.strictEqual(c.timeout, 7200);
    assert.strictEqual(c.port, null);
    assert.strictEqual(c.csrf, null);
});

test('全参数解析', () => {
    const c = parseArgs([
        'task.md', '--timeout', '3600', '--port', '42200',
        '--csrf', 'my-token', '--cascade', 'abc-123',
        '--cooldown', '10', '--poll-interval', '5', '--agentic',
    ]);
    assert.strictEqual(c.docPath, 'task.md');
    assert.strictEqual(c.timeout, 3600);
    assert.strictEqual(c.port, 42200);
    assert.strictEqual(c.csrf, 'my-token');
    assert.strictEqual(c.cascadeId, 'abc-123');
    assert.strictEqual(c.cooldown, 10);
    assert.strictEqual(c.pollInterval, 5);
    assert.strictEqual(c.agentic, true);
});

test('参数顺序无关', () => {
    const c = parseArgs(['--agentic', '--timeout', '1800', 'task2.md']);
    assert.strictEqual(c.docPath, 'task2.md');
    assert.strictEqual(c.agentic, true);
    assert.strictEqual(c.timeout, 1800);
});

test('--task 参数', () => {
    const c = parseArgs(['--task', '写一个 Hello World']);
    assert.strictEqual(c.task, '写一个 Hello World');
    assert.strictEqual(c.docPath, null);
});

test('未知参数忽略', () => {
    const c = parseArgs(['task.md', '--unknown', 'value']);
    assert.strictEqual(c.docPath, 'task.md');
});

test('无参数默认值', () => {
    const c = parseArgs([]);
    assert.strictEqual(c.docPath, null);
    assert.strictEqual(c.task, null);
    assert.strictEqual(c.timeout, DEFAULTS.timeout);
    assert.strictEqual(c.cooldown, DEFAULTS.cooldown);
    assert.strictEqual(c.pollInterval, DEFAULTS.pollInterval);
});

console.log('\n--- config: constants ---');

test('AUTO_REPLY_TEMPLATE 非空', () => {
    assert(AUTO_REPLY_TEMPLATE.length > 50);
    assert(AUTO_REPLY_TEMPLATE.includes('继续'));
});

test('DEFAULTS 结构完整', () => {
    assert.strictEqual(typeof DEFAULTS.timeout, 'number');
    assert.strictEqual(typeof DEFAULTS.cooldown, 'number');
    assert.strictEqual(typeof DEFAULTS.pollInterval, 'number');
    assert.strictEqual(typeof DEFAULTS.agentic, 'boolean');
    assert.strictEqual(typeof DEFAULTS.maxConsecutiveErrors, 'number');
    assert.strictEqual(typeof DEFAULTS.maxPollCount, 'number');
});

// ========== marker ==========

console.log('\n--- marker ---');

test('初始状态: clean + check', () => {
    marker.clean();
    assert.strictEqual(marker.check(), false);
});

test('write + check + read', () => {
    marker.clean();
    const m = marker.write('测试熔断');
    assert.strictEqual(marker.check(), true);
    assert.strictEqual(m.summary, '测试熔断');
    assert(typeof m.completedAt === 'string');

    const r = marker.read();
    assert.strictEqual(r.summary, '测试熔断');
    marker.clean();
});

test('write 默认摘要', () => {
    marker.clean();
    const m = marker.write();
    assert.strictEqual(m.summary, '(无摘要)');
    marker.clean();
});

test('clean 重复调用不报错', () => {
    marker.clean();
    marker.clean();
    marker.clean();
    assert.strictEqual(marker.check(), false);
});

test('read 不存在返回 null', () => {
    marker.clean();
    assert.strictEqual(marker.read(), null);
});

test('MARKER_FILE 路径正确', () => {
    assert(marker.MARKER_FILE.endsWith('.yolo-done'));
});

// ========== logger ==========

console.log('\n--- logger ---');

test('Logger 创建日志文件', () => {
    const tmpDir = path.join('/tmp', 'yolo-test-logs-' + Date.now());
    const logger = new Logger(tmpDir);
    assert(fs.existsSync(logger.logPath));
    logger.info('test message');
    logger.logRound(1, 'AI said hello');
    assert.strictEqual(logger.roundCount, 1);
    logger.close();
    // 验证日志内容
    const content = fs.readFileSync(logger.logPath, 'utf-8');
    assert(content.includes('test message'));
    assert(content.includes('第 1 轮完成'));
    // 清理
    fs.unlinkSync(logger.logPath);
    fs.rmdirSync(tmpDir);
});

// ========== engine ==========

console.log('\n--- engine: API ---');

test('YoloEngine exports', () => {
    assert.strictEqual(typeof YoloEngine, 'function');
    assert.strictEqual(typeof safeCall, 'function');
    assert.strictEqual(typeof sleep, 'function');
});

test('YoloEngine 实例 API', () => {
    const engine = new YoloEngine();
    assert.strictEqual(typeof engine.start, 'function');
    assert.strictEqual(typeof engine.stop, 'function');
    assert.strictEqual(typeof engine.getStatus, 'function');
    assert.strictEqual(typeof engine.on, 'function');
    assert.strictEqual(typeof engine.emit, 'function');
});

test('getStatus 默认值', () => {
    const engine = new YoloEngine();
    const s = engine.getStatus();
    assert.strictEqual(s.running, false);
    assert.strictEqual(s.cascadeId, null);
    assert.strictEqual(s.round, 0);
    assert.strictEqual(s.elapsed, 0);
});

test('stop 设置 abort', () => {
    const engine = new YoloEngine();
    engine.stop();
    assert.strictEqual(engine._aborted, true);
});

// ========== CLI behavior ==========

console.log('\n--- CLI behavior ---');

const ROOT = path.join(__dirname, '..', '..', '..');
const YOLO_SCRIPT = path.join(ROOT, 'scripts', 'yolo.js');

function runYolo(args, opts = {}) {
    try {
        const stdout = execSync(`node "${YOLO_SCRIPT}" ${args}`, {
            cwd: ROOT,
            timeout: opts.timeout || 5000,
        }).toString();
        return { exitCode: 0, stdout, stderr: '' };
    } catch (err) {
        return {
            exitCode: err.status,
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || '',
        };
    }
}

test('CLI 无参数退出', () => {
    const r = runYolo('');
    assert.notStrictEqual(r.exitCode, 0);
    assert(r.stderr.includes('用法:') || r.stdout.includes('用法:'));
});

test('CLI 文档不存在退出', () => {
    const r = runYolo('/tmp/nonexistent-12345.md');
    assert.notStrictEqual(r.exitCode, 0);
    assert(r.stderr.includes('不存在') || r.stdout.includes('不存在'));
});

// ========== Async tests + Integration ==========

(async () => {
    console.log('\n--- engine: async ---');

    await testAsync('start 重复调用抛错', async () => {
        const engine = new YoloEngine();
        engine._running = true;
        let threw = false;
        try { await engine.start({}); } catch (e) {
            threw = true;
            assert(e.message.includes('已在运行中'));
        }
        assert.strictEqual(threw, true);
        engine._running = false;
    });

    await testAsync('start 无 task 无 docPath 抛错', async () => {
        const engine = new YoloEngine();
        let threw = false;
        try { await engine.start({ csrf: 'fake', port: 99999 }); } catch (e) {
            threw = true;
            assert(e.message.includes('task') || e.message.includes('docPath'));
        }
        assert.strictEqual(threw, true);
    });

    await testAsync('safeCall 返回错误而非抛异常', async () => {
        const r = await safeCall(99999, 'fake', 'Heartbeat', {}, 2000);
        assert.strictEqual(r.status, 'ERROR');
        assert(r.data.error);
    });

    await testAsync('sleep 等待正确时长', async () => {
        const start = Date.now();
        await sleep(100);
        const elapsed = Date.now() - start;
        assert(elapsed >= 90, `elapsed=${elapsed}ms should be >= 90ms`);
        assert(elapsed < 500, `elapsed=${elapsed}ms should be < 500ms`);
    });

    // ========== Integration (real LS) ==========

    if (process.argv.includes('--integration')) {
        console.log('\n--- integration (real LS) ---');

        const { grpcCall: realGrpc } = require('../../core/ls-discovery');
        const { buildSendBody, DEFAULT_CONFIG } = require('../../core/ws-protocol');

        // 从 LS 进程提取 CSRF
        let PORT = 42100;
        let CSRF = 'daemon-with-ext-server';
        try {
            const ps = execSync("ps aux | grep language_server_linux | grep -v grep | grep 'server_port=42100'").toString();
            const m = ps.match(/csrf_token=([^\s\\]+)/);
            if (m) CSRF = m[1];
        } catch { /* use fallback */ }

        await testAsync('Heartbeat', async () => {
            const r = await realGrpc(PORT, CSRF, 'Heartbeat', {});
            assert.strictEqual(r.status, 200);
        });

        await testAsync('StartCascade + Send + Trajectory', async () => {
            const r = await realGrpc(PORT, CSRF, 'StartCascade', {});
            assert.strictEqual(r.status, 200);
            const cid = r.data?.cascadeId;
            assert(cid);

            const body = buildSendBody(cid, 'YOLO test - reply OK', { ...DEFAULT_CONFIG, agenticMode: false });
            const sr = await realGrpc(PORT, CSRF, 'SendUserCascadeMessage', body, 15000);
            assert.strictEqual(sr.status, 200);

            await sleep(3000);

            const tr = await realGrpc(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid });
            assert.strictEqual(tr.status, 200);
            assert(tr.data?.status);
            console.log(`     cascadeId=${cid}, status=${tr.data.status}`);
        });

        // yolo-done.js script test
        const YOLO_DONE = path.join(ROOT, 'scripts', 'yolo-done.js');
        await testAsync('yolo-done.js 写标记 + 通知', async () => {
            marker.clean();
            try {
                execSync(`node "${YOLO_DONE}" "集成测试完成"`, { cwd: ROOT, timeout: 15000 });
            } catch { /* may fail on telegram timeout */ }
            assert(marker.check(), '标记文件应存在');
            const m = marker.read();
            assert.strictEqual(m.summary, '集成测试完成');
            marker.clean();
        });

        // Telegram API 可达性
        await testAsync('Telegram API 可达', async () => {
            const https = require('https');
            const { BOT_TOKEN } = require('../../telegram/config');
            const result = await new Promise((resolve) => {
                const req = https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { timeout: 10000 }, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch { resolve({ ok: false }); }
                    });
                });
                req.on('error', () => resolve({ ok: false }));
            });
            assert.strictEqual(result.ok, true);
        });
    }

    // ========== Summary ==========

    console.log(`\n${'='.repeat(40)}`);
    console.log(`yolo.test: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
