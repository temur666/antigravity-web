/**
 * ls/grpc.js 单元测试
 * Run: node lib/core/ls/__tests__/grpc.test.js [--integration]
 */
const assert = require('assert');
const http = require('http');

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

const { grpcCall, clearProtocolCache, getProtocolForPort, SERVICE_PATH } = require('../grpc');

// ========== 导出验证 ==========

console.log('\n--- exports ---');

test('grpcCall is function', () => assert.strictEqual(typeof grpcCall, 'function'));
test('clearProtocolCache is function', () => assert.strictEqual(typeof clearProtocolCache, 'function'));
test('getProtocolForPort is function', () => assert.strictEqual(typeof getProtocolForPort, 'function'));
test('SERVICE_PATH is correct', () => {
    assert(SERVICE_PATH.includes('LanguageServerService'));
});

// ========== 参数校验 ==========

console.log('\n--- parameter validation ---');

(async () => {
    await testAsync('missing port throws', async () => {
        try { await grpcCall(null, 'csrf', 'Method', {}); assert.fail('should throw'); }
        catch (e) { assert(e.message.includes('port')); }
    });

    await testAsync('missing csrf throws', async () => {
        try { await grpcCall(12345, null, 'Method', {}); assert.fail('should throw'); }
        catch (e) { assert(e.message.includes('csrf')); }
    });

    // ========== Protocol cache ==========

    console.log('\n--- protocol cache ---');

    test('getProtocolForPort returns null for unknown', () => {
        clearProtocolCache();
        assert.strictEqual(getProtocolForPort(99999), null);
    });

    // ========== Mock HTTP server for grpcCall ==========

    console.log('\n--- grpcCall with mock server ---');

    await testAsync('grpcCall sends correct request to HTTP server', async () => {
        clearProtocolCache();

        // 记录收到的合法请求 (HTTPS 首次尝试会产生畸形请求，server 端不做 assert)
        const receivedRequests = [];

        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                // 记录合法的 JSON 请求
                if (req.headers['content-type'] === 'application/json') {
                    try {
                        receivedRequests.push({ url: req.url, body: JSON.parse(body), headers: req.headers });
                    } catch { /* 非 JSON，忽略 */ }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                try {
                    const parsed = JSON.parse(body);
                    res.end(JSON.stringify({ echo: parsed, ok: true }));
                } catch {
                    res.end(JSON.stringify({ ok: false }));
                }
            });
        });

        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        try {
            // First call: HTTPS will fail (not TLS), should fallback to HTTP
            const result = await grpcCall(port, 'test-csrf', 'TestMethod', { hello: 'world' }, 5000);
            assert.strictEqual(result.status, 200);
            assert.strictEqual(result.data.ok, true);
            assert.strictEqual(result.data.echo.hello, 'world');

            // Protocol should be cached as HTTP
            assert.strictEqual(getProtocolForPort(port), 'http');

            // 验证 server 收到了正确的请求
            const validReqs = receivedRequests.filter(r => r.url.includes('TestMethod'));
            assert(validReqs.length >= 1, `should have valid request, got ${validReqs.length}`);
            assert(validReqs[0].url.includes('LanguageServerService/TestMethod'));
            assert.strictEqual(validReqs[0].headers['x-codeium-csrf-token'], 'test-csrf');

            // Second call should reuse cached protocol
            const result2 = await grpcCall(port, 'test-csrf', 'TestMethod', { second: true }, 5000);
            assert.strictEqual(result2.status, 200);
            assert.strictEqual(result2.data.echo.second, true);
        } finally {
            server.close();
            clearProtocolCache();
        }
    });

    await testAsync('grpcCall handles connection refused', async () => {
        clearProtocolCache();
        try {
            await grpcCall(1, 'csrf', 'Method', {}, 2000);
            assert.fail('should throw');
        } catch (e) {
            assert(e.message.includes('ECONNREFUSED') || e.message.includes('timeout') || e.message.includes('EPROTO'),
                `unexpected error: ${e.message}`);
        }
    });

    // ========== Integration ==========

    if (process.argv.includes('--integration')) {
        console.log('\n--- integration (real LS) ---');

        const { discoverLS } = require('../discovery');

        await testAsync('Heartbeat to real LS', async () => {
            const ls = discoverLS();
            assert(ls, 'LS not found');
            const r = await grpcCall(ls.port, ls.csrf, 'Heartbeat', { metadata: {} });
            assert.strictEqual(r.status, 200);
            console.log(`     port=${ls.port}, protocol=${getProtocolForPort(ls.port)}`);
        });
    }

    // ========== Summary ==========

    console.log(`\n${'='.repeat(40)}`);
    console.log(`grpc.test: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
