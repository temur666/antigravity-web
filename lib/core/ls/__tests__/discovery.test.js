/**
 * ls/discovery.js 单元测试
 * Run: node lib/core/ls/__tests__/discovery.test.js
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
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.log(`  [FAIL] ${name}`);
        console.log(`     ${e.message}`);
        failed++;
    }
}

const { parseDiscoveryFile, isPidAlive, discoverLS } = require('../discovery');

// ========== Mock Data ==========

const MOCK_DISCOVERY = {
    pid: process.pid,
    httpsPort: 36117,
    httpPort: 37449,
    lspPort: 46617,
    lsVersion: '1.19.4',
    csrfToken: '95179dd3-0936-4cdf-9218-f858dd948db1',
};

function withMockDir(fn) {
    const dir = path.join(os.tmpdir(), 'ls-disc-test-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ========== parseDiscoveryFile ==========

console.log('\n--- parseDiscoveryFile ---');

test('valid JSON -> correct fields', () => {
    const r = parseDiscoveryFile(JSON.stringify(MOCK_DISCOVERY));
    assert.strictEqual(r.port, 36117);
    assert.strictEqual(r.csrf, '95179dd3-0936-4cdf-9218-f858dd948db1');
    assert.strictEqual(r.pid, process.pid);
    assert.strictEqual(r.version, '1.19.4');
    assert.strictEqual(r.httpPort, 37449);
    assert.strictEqual(r.lspPort, 46617);
});

test('invalid JSON -> null', () => {
    assert.strictEqual(parseDiscoveryFile('not json'), null);
});

test('missing httpsPort -> null', () => {
    assert.strictEqual(parseDiscoveryFile(JSON.stringify({ pid: 1, csrfToken: 'x' })), null);
});

test('missing csrfToken -> null', () => {
    assert.strictEqual(parseDiscoveryFile(JSON.stringify({ pid: 1, httpsPort: 1234 })), null);
});

test('missing pid -> null', () => {
    assert.strictEqual(parseDiscoveryFile(JSON.stringify({ httpsPort: 1234, csrfToken: 'x' })), null);
});

test('optional fields default', () => {
    const r = parseDiscoveryFile(JSON.stringify({ pid: 1, httpsPort: 1234, csrfToken: 'x' }));
    assert.strictEqual(r.version, 'unknown');
    assert.strictEqual(r.httpPort, 0);
    assert.strictEqual(r.lspPort, 0);
});

// ========== isPidAlive ==========

console.log('\n--- isPidAlive ---');

test('current process is alive', () => {
    assert.strictEqual(isPidAlive(process.pid), true);
});

test('non-existent PID is dead', () => {
    assert.strictEqual(isPidAlive(99999999), false);
});

// ========== discoverLS ==========

console.log('\n--- discoverLS ---');

test('discover from mock directory', () => {
    withMockDir((dir) => {
        fs.writeFileSync(
            path.join(dir, 'ls_test123.json'),
            JSON.stringify(MOCK_DISCOVERY),
        );
        const r = discoverLS(dir);
        assert(r !== null, 'should find LS');
        assert.strictEqual(r.port, 36117);
        assert.strictEqual(r.csrf, MOCK_DISCOVERY.csrfToken);
        assert.strictEqual(r.source, 'ls_test123.json');
        assert.strictEqual(r.protocol, 'https');
    });
});

test('empty directory -> fallback (no throw)', () => {
    withMockDir((dir) => {
        const r = discoverLS(dir);
        // May find real LS or null, but should not throw
        if (r) assert(r.source, 'should have source');
    });
});

test('non-existent directory -> fallback (no throw)', () => {
    const r = discoverLS('/nonexistent/path/abc123xyz');
    if (r) assert(r.source, 'should have source');
});

test('dead PID -> skip file, fallback', () => {
    withMockDir((dir) => {
        fs.writeFileSync(
            path.join(dir, 'ls_dead.json'),
            JSON.stringify({ ...MOCK_DISCOVERY, pid: 99999999 }),
        );
        const r = discoverLS(dir);
        // Should skip dead PID file
        if (r) assert.notStrictEqual(r.source, 'ls_dead.json');
    });
});

test('multiple files -> first alive wins', () => {
    withMockDir((dir) => {
        // Dead PID file
        fs.writeFileSync(
            path.join(dir, 'ls_aaa.json'),
            JSON.stringify({ ...MOCK_DISCOVERY, pid: 99999999 }),
        );
        // Alive PID file
        fs.writeFileSync(
            path.join(dir, 'ls_bbb.json'),
            JSON.stringify(MOCK_DISCOVERY),
        );
        const r = discoverLS(dir);
        assert(r !== null);
        assert.strictEqual(r.source, 'ls_bbb.json');
    });
});

// ========== Summary ==========

console.log(`\n${'='.repeat(40)}`);
console.log(`discovery.test: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
