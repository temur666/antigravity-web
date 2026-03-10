/**
 * controller.js 链路集成测试
 * Run: node lib/core/__tests__/controller.integration.test.js [--integration]
 *
 * 不 mock 内部模块，验证 LSManager + ConversationStore + ConversationSync 的组合。
 * --integration 时连真实 LS 跑端到端。
 */
const assert = require('assert');

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

const { Controller, createConversationState } = require('../controller');

// ========== API completeness ==========

console.log('\n--- API completeness ---');

test('Controller exports', () => {
    assert.strictEqual(typeof Controller, 'function');
    assert.strictEqual(typeof createConversationState, 'function');
});

test('all 19 public methods exist', () => {
    const c = new Controller();
    const methods = [
        'init', 'refreshLS', 'setConfig', 'getConfig', 'getStatus',
        'listConversations', 'newChat', 'sendMessage', 'cancelCascade', 'getTrajectory',
        'subscribe', 'unsubscribe', 'unsubscribeAll', 'getCurrentSeq',
        'diffSteps', 'startPolling', 'stopPolling', 'pollOnce', 'destroy',
    ];
    const missing = methods.filter(m => typeof c[m] !== 'function');
    assert.strictEqual(missing.length, 0, `missing: ${missing.join(', ')}`);
    c.destroy();
});

// ========== Proxy properties ==========

console.log('\n--- proxy properties ---');

test('ls getter returns null before init', () => {
    const c = new Controller();
    assert.strictEqual(c.ls, null);
    c.destroy();
});

test('conversations getter returns Map', () => {
    const c = new Controller();
    assert(c.conversations instanceof Map);
    assert.strictEqual(c.conversations.size, 0);
    c.destroy();
});

// ========== Config ==========

console.log('\n--- config ---');

test('setConfig + getConfig roundtrip', () => {
    const c = new Controller();
    c.setConfig({ agenticMode: true });
    assert.strictEqual(c.getConfig().agenticMode, true);
    c.destroy();
});

test('setConfig ignores invalid keys', () => {
    const c = new Controller();
    c.setConfig({ notAKey: 'value' });
    assert.strictEqual(c.getConfig().notAKey, undefined);
    c.destroy();
});

// ========== getStatus ==========

console.log('\n--- getStatus ---');

test('getStatus structure', () => {
    const c = new Controller();
    const s = c.getStatus();

    // ls
    assert.strictEqual(typeof s.ls, 'object');
    assert.strictEqual(s.ls.connected, false);
    assert.strictEqual(s.ls.port, null);

    // config
    assert(s.config);
    assert(s.config.model);

    // conversations
    assert.strictEqual(s.conversations.total, 0);
    assert.strictEqual(s.conversations.running, 0);
    assert.strictEqual(s.conversations.subscribed, 0);

    // polling
    assert.strictEqual(s.polling, false);

    c.destroy();
});

// ========== diffSteps passthrough ==========

console.log('\n--- diffSteps ---');

test('diffSteps works through Controller', () => {
    const c = new Controller();
    const diff = c.diffSteps(
        [{ status: 'A', plannerResponse: { response: 'x' } }],
        [
            { status: 'A', plannerResponse: { response: 'xy' } }, // updated (text)
            { status: 'B', plannerResponse: { response: 'z' } },  // added
        ],
    );
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.updated.length, 1);
    c.destroy();
});

// ========== subscribe / unsubscribe ==========

console.log('\n--- subscribe chain ---');

test('subscribe creates conversation state', () => {
    const c = new Controller();
    const ws = { readyState: 1, send: () => { } };
    c.subscribe('conv-abc', ws);

    assert(c.conversations.has('conv-abc'));
    assert.strictEqual(c.conversations.get('conv-abc').subscribers.size, 1);
    c.destroy();
});

test('unsubscribe removes ws', () => {
    const c = new Controller();
    const ws = { readyState: 1, send: () => { } };
    c.subscribe('conv-abc', ws);
    c.unsubscribe('conv-abc', ws);

    assert.strictEqual(c.conversations.get('conv-abc').subscribers.size, 0);
    c.destroy();
});

test('unsubscribeAll removes from all', () => {
    const c = new Controller();
    const ws = { readyState: 1, send: () => { } };
    c.subscribe('conv-1', ws);
    c.subscribe('conv-2', ws);
    c.unsubscribeAll(ws);

    assert.strictEqual(c.conversations.get('conv-1').subscribers.size, 0);
    assert.strictEqual(c.conversations.get('conv-2').subscribers.size, 0);
    c.destroy();
});

test('getCurrentSeq is 0 for new conversation', () => {
    const c = new Controller();
    assert.strictEqual(c.getCurrentSeq('nonexistent'), 0);
    c.destroy();
});

// ========== Event forwarding ==========

console.log('\n--- event forwarding ---');

test('error events forwarded from LSManager', () => {
    const c = new Controller();
    const errors = [];
    c.on('error', (e) => errors.push(e));

    // Trigger error through LSManager
    c._lsManager.emit('error', new Error('test-ls-error'));
    assert.strictEqual(errors.length, 1);
    assert(errors[0].message.includes('test-ls-error'));
    c.destroy();
});

test('error events forwarded from ConversationSync', () => {
    const c = new Controller();
    const errors = [];
    c.on('error', (e) => errors.push(e));

    c._sync.emit('error', new Error('test-sync-error'));
    assert.strictEqual(errors.length, 1);
    assert(errors[0].message.includes('test-sync-error'));
    c.destroy();
});

test('ls_connected event forwarded', () => {
    const c = new Controller();
    const events = [];
    c.on('ls_connected', (ls) => events.push(ls));

    c._lsManager.emit('ls_connected', { port: 123 });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].port, 123);
    c.destroy();
});

test('status_changed event forwarded', () => {
    const c = new Controller();
    const events = [];
    c.on('status_changed', (e) => events.push(e));

    c._sync.emit('status_changed', { cascadeId: 'x', from: 'RUNNING', to: 'IDLE' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].from, 'RUNNING');
    c.destroy();
});

// ========== destroy ==========

console.log('\n--- destroy ---');

test('destroy cleans up everything', () => {
    const c = new Controller();
    const ws = { readyState: 1, send: () => { } };
    c.subscribe('conv-1', ws);
    c.destroy();

    assert.strictEqual(c.conversations.size, 0);
    assert.strictEqual(c.ls, null);
});

// ========== Integration (real LS) ==========

(async () => {
    if (process.argv.includes('--integration')) {
        console.log('\n--- integration (real LS) ---');

        await testAsync('full lifecycle: init -> list -> newChat -> destroy', async () => {
            const c = new Controller();
            const events = [];
            c.on('ls_connected', () => events.push('connected'));

            const ok = await c.init();
            if (!ok) {
                console.log('     (LS not available, skipping)');
                c.destroy();
                return;
            }

            assert(c.ls !== null);
            assert(events.includes('connected'));
            console.log(`     port=${c.ls.port}`);

            // list
            const convs = await c.listConversations();
            console.log(`     conversations: ${convs.length}`);

            // status
            const s = c.getStatus();
            assert.strictEqual(s.ls.connected, true);

            // newChat
            const cascadeId = await c.newChat();
            assert(cascadeId, 'should get cascadeId');
            console.log(`     newChat: ${cascadeId}`);

            assert(c.conversations.has(cascadeId));

            c.destroy();
        });

        await testAsync('subscribe and getTrajectory', async () => {
            const c = new Controller();
            const ok = await c.init();
            if (!ok) { c.destroy(); return; }

            const cascadeId = await c.newChat();
            const ws = { readyState: 1, send: () => { } };
            c.subscribe(cascadeId, ws);

            assert.strictEqual(c.conversations.get(cascadeId).subscribers.size, 1);

            const traj = await c.getTrajectory(cascadeId);
            assert(traj !== null);

            c.unsubscribe(cascadeId, ws);
            assert.strictEqual(c.conversations.get(cascadeId).subscribers.size, 0);

            c.destroy();
        });
    }

    // ========== Summary ==========

    console.log(`\n${'='.repeat(40)}`);
    console.log(`controller.integration: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
