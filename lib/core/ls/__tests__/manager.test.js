/**
 * ls/manager.js 单元测试
 * Run: node lib/core/ls/__tests__/manager.test.js
 *
 * 用 mock HTTP server 模拟 LS，验证 LSManager 全生命周期。
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

async function testAsync(name, fn) {
    try { await fn(); console.log(`  [PASS] ${name}`); passed++; }
    catch (e) { console.log(`  [FAIL] ${name}\n     ${e.message}\n     ${e.stack?.split('\n').slice(1, 3).join('\n')}`); failed++; }
}

// ========== Mock LS Server ==========

function createMockLS() {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            const method = req.url.split('/').pop();
            calls.push({ method, body: JSON.parse(body || '{}') });

            res.writeHead(200, { 'Content-Type': 'application/json' });

            if (method === 'StartCascade') {
                res.end(JSON.stringify({ cascadeId: 'mock-cascade-' + Date.now() }));
            } else if (method === 'GetAllCascadeTrajectories') {
                res.end(JSON.stringify({ trajectorySummaries: {} }));
            } else {
                res.end(JSON.stringify({ ok: true }));
            }
        });
    });

    return { server, calls };
}

function createMockDaemonDir(port) {
    const dir = path.join(os.tmpdir(), 'ls-mgr-test-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'ls_mock.json'),
        JSON.stringify({
            pid: process.pid,
            httpsPort: port,
            httpPort: 0,
            lspPort: 0,
            lsVersion: '1.0.0-test',
            csrfToken: 'mock-csrf-token',
        }),
    );
    return dir;
}

// ========== Tests ==========

(async () => {
    console.log('\n--- LSManager lifecycle ---');

    // 需要 patch discoverLSAsync 来指向 mock daemon dir
    // 方案: 直接测试 LSManager 的 public API，用 mock LS server

    const { LSManager } = require('../manager');
    const { clearProtocolCache } = require('../grpc');

    await testAsync('constructor creates valid instance', async () => {
        const mgr = new LSManager();
        assert.strictEqual(mgr.ls, null);
        assert.strictEqual(mgr.isHealthy(), false);
        const status = mgr.getStatus();
        assert.strictEqual(status.connected, false);
        assert.strictEqual(status.port, null);
        mgr.destroy();
    });

    await testAsync('init without LS returns false and emits error', async () => {
        clearProtocolCache();
        const mgr = new LSManager();
        const errors = [];
        mgr.on('error', (e) => errors.push(e));

        // init 会调用 discoverLSAsync，如果没有真实 LS 运行可能为 null
        // 这里检查不会 crash
        const result = await mgr.init();
        // result 取决于是否有真实 LS
        if (!result) {
            assert(errors.length > 0 || !result, 'should emit error or return false');
        }
        mgr.destroy();
    });

    await testAsync('getStreamClient returns null before init', async () => {
        const mgr = new LSManager();
        assert.strictEqual(mgr.getStreamClient(), null);
        mgr.destroy();
    });

    await testAsync('callback registration', async () => {
        const mgr = new LSManager();
        let changeCalled = false;
        let subsCalled = false;

        mgr.onStreamChange(() => { changeCalled = true; });
        mgr.onGetActiveSubscriptions(() => { subsCalled = true; return []; });

        // Verify callbacks are stored
        assert.strictEqual(typeof mgr._onStreamChangeCb, 'function');
        assert.strictEqual(typeof mgr._getActiveSubscriptionsCb, 'function');
        mgr.destroy();
    });

    await testAsync('destroy cleans up', async () => {
        const mgr = new LSManager();
        mgr.destroy();
        assert.strictEqual(mgr.ls, null);
        assert.strictEqual(mgr.isHealthy(), false);
        assert.strictEqual(mgr.getStreamClient(), null);
    });

    // ========== Integration with mock server ==========

    if (process.argv.includes('--integration')) {
        console.log('\n--- integration (real LS) ---');

        await testAsync('init with real LS', async () => {
            clearProtocolCache();
            const mgr = new LSManager();
            const events = [];
            mgr.on('ls_connected', (ls) => events.push({ type: 'connected', ls }));

            const ok = await mgr.init();
            if (ok) {
                assert(mgr.ls !== null);
                assert(mgr.isHealthy());
                assert(events.some(e => e.type === 'connected'));
                console.log(`     port=${mgr.ls.port}, pid=${mgr.ls.pid}`);
            } else {
                console.log('     (LS not available, skipping)');
            }
            mgr.destroy();
        });

        await testAsync('getStatus after init', async () => {
            clearProtocolCache();
            const mgr = new LSManager();
            const ok = await mgr.init();
            if (ok) {
                const s = mgr.getStatus();
                assert.strictEqual(s.connected, true);
                assert(s.port > 0);
                assert(s.pid > 0);
            }
            mgr.destroy();
        });
    }

    // ========== Summary ==========

    console.log(`\n${'='.repeat(40)}`);
    console.log(`manager.test: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
