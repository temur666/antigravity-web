/**
 * tests/ls-discovery.test.js — ls-discovery.js 单元测试
 * Run: node tests/ls-discovery.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== Test Helpers ==========

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
        failed++;
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${e.message}`);
        failed++;
    }
}

// ========== Mock Setup ==========

const MOCK_DIR = path.join(os.tmpdir(), 'ls-discovery-test-' + Date.now());
const MOCK_DISCOVERY = {
    pid: process.pid, // 用当前进程 PID，确保 "存活" 检查通过
    httpsPort: 36117,
    httpPort: 37449,
    lspPort: 46617,
    lsVersion: '1.19.4',
    csrfToken: '95179dd3-0936-4cdf-9218-f858dd948db1',
};

function setupMockDir() {
    fs.mkdirSync(MOCK_DIR, { recursive: true });
    fs.writeFileSync(
        path.join(MOCK_DIR, 'ls_e06d6f19a2de70eb.json'),
        JSON.stringify(MOCK_DISCOVERY),
    );
}

function cleanupMockDir() {
    try { fs.rmSync(MOCK_DIR, { recursive: true }); } catch { }
}

// ========== Tests: parseDiscoveryFile ==========

console.log('\n📁 parseDiscoveryFile');

const { parseDiscoveryFile, discoverLS, grpcCall } = require('../lib/ls-discovery');

test('解析有效的 discovery JSON', () => {
    const result = parseDiscoveryFile(JSON.stringify(MOCK_DISCOVERY));
    assert.strictEqual(result.port, 36117);
    assert.strictEqual(result.csrf, '95179dd3-0936-4cdf-9218-f858dd948db1');
    assert.strictEqual(result.pid, process.pid);
    assert.strictEqual(result.version, '1.19.4');
});

test('解析无效 JSON 返回 null', () => {
    const result = parseDiscoveryFile('not json');
    assert.strictEqual(result, null);
});

test('缺少必要字段返回 null', () => {
    const result = parseDiscoveryFile(JSON.stringify({ pid: 1 }));
    assert.strictEqual(result, null);
});

test('所有字段都存在', () => {
    const result = parseDiscoveryFile(JSON.stringify(MOCK_DISCOVERY));
    assert(result.port, 'should have port');
    assert(result.csrf, 'should have csrf');
    assert(result.pid, 'should have pid');
    assert(result.version, 'should have version');
    assert(result.httpPort, 'should have httpPort');
    assert(result.lspPort, 'should have lspPort');
});

// ========== Tests: discoverLS ==========

console.log('\n🔍 discoverLS');

test('从 mock 目录发现 LS', () => {
    setupMockDir();
    try {
        const result = discoverLS(MOCK_DIR);
        assert(result !== null, 'should find LS');
        assert.strictEqual(result.port, 36117);
        assert.strictEqual(result.csrf, '95179dd3-0936-4cdf-9218-f858dd948db1');
        assert.strictEqual(result.pid, process.pid);
    } finally {
        cleanupMockDir();
    }
});

test('目录不存在时 fallback 到进程发现', () => {
    const result = discoverLS('/nonexistent/path/abc123');
    // 如果有真实 LS 进程在跑，fallback 会找到它
    // 如果没有，返回 null
    if (result) {
        assert.strictEqual(result.source, 'process', 'should come from process fallback');
    }
    // 无论如何不应该 throw
});

test('空目录时 fallback 到进程发现', () => {
    const emptyDir = path.join(os.tmpdir(), 'ls-empty-' + Date.now());
    fs.mkdirSync(emptyDir, { recursive: true });
    try {
        const result = discoverLS(emptyDir);
        if (result) {
            assert.strictEqual(result.source, 'process', 'should come from process fallback');
        }
    } finally {
        fs.rmSync(emptyDir, { recursive: true });
    }
});

test('PID 不存在的 discovery file 时 fallback 到进程发现', () => {
    const dir = path.join(os.tmpdir(), 'ls-dead-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'ls_deadbeef.json'),
        JSON.stringify({ ...MOCK_DISCOVERY, pid: 99999999 }),
    );
    try {
        const result = discoverLS(dir);
        if (result) {
            assert.strictEqual(result.source, 'process', 'should come from process fallback');
        }
    } finally {
        fs.rmSync(dir, { recursive: true });
    }
});

// ========== Tests: grpcCall ==========

console.log('\n📡 grpcCall');

test('grpcCall 是函数', () => {
    assert.strictEqual(typeof grpcCall, 'function');
});

test('grpcCall 参数校验 — 缺 port', async () => {
    try {
        await grpcCall(null, 'test', 'Method', {});
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('port'), `error should mention port: ${e.message}`);
    }
});

test('grpcCall 参数校验 — 缺 csrf', async () => {
    try {
        await grpcCall(12345, null, 'Method', {});
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('csrf'), `error should mention csrf: ${e.message}`);
    }
});

// ========== Integration test (real LS) ==========

console.log('\n🔌 集成测试 (需要真实 LS)');

const isIntegration = process.argv.includes('--integration');

if (isIntegration) {
    (async () => {
        await testAsync('从真实 daemon 目录发现 LS', async () => {
            const result = discoverLS();
            assert(result !== null, 'should discover LS from default path');
            console.log(`     PID=${result.pid}, Port=${result.port}, Version=${result.version}`);
        });

        await testAsync('grpcCall Heartbeat', async () => {
            const ls = discoverLS();
            assert(ls, 'LS not found');
            const result = await grpcCall(ls.port, ls.csrf, 'Heartbeat', { metadata: {} });
            assert(result, 'should get heartbeat response');
            assert.strictEqual(result.status, 200, `status should be 200, got ${result.status}`);
        });

        await testAsync('grpcCall GetCascadeTrajectory', async () => {
            const ls = discoverLS();
            assert(ls, 'LS not found');
            const result = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
            assert(result.data.cascadeId, 'should get cascadeId');
            console.log(`     cascadeId=${result.data.cascadeId}`);
        });

        // Print summary
        console.log(`\n${'═'.repeat(40)}`);
        console.log(`结果: ${passed} passed, ${failed} failed`);
        console.log(`${'═'.repeat(40)}\n`);
        process.exit(failed > 0 ? 1 : 0);
    })();
} else {
    console.log('  ⏭️  跳过 (用 --integration 启用)');
    console.log(`\n${'═'.repeat(40)}`);
    console.log(`结果: ${passed} passed, ${failed} failed`);
    console.log(`${'═'.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
}
