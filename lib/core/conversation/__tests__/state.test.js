/**
 * conversation/state.js 单元测试
 * Run: node lib/core/conversation/__tests__/state.test.js
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

const { ConversationStore, createConversationState, POLL_MIN_INTERVAL, EVENT_BUFFER_MAX } = require('../state');

// ========== createConversationState ==========

console.log('\n--- createConversationState ---');

test('default fields', () => {
    const s = createConversationState('abc-123');
    assert.strictEqual(s.cascadeId, 'abc-123');
    assert.strictEqual(s.status, 'UNKNOWN');
    assert.deepStrictEqual(s.steps, []);
    assert.strictEqual(s.totalSteps, 0);
    assert.strictEqual(s.lastPollAt, null);
    assert.strictEqual(s.pollInterval, POLL_MIN_INTERVAL);
    assert(s.subscribers instanceof Set);
    assert.strictEqual(s.subscribers.size, 0);
    assert.strictEqual(s.source, 'external');
    assert.strictEqual(s.nextSeq, 1);
    assert.deepStrictEqual(s.eventBuffer, []);
});

test('custom source', () => {
    const s = createConversationState('x', 'controller');
    assert.strictEqual(s.source, 'controller');
});

// ========== ConversationStore ==========

console.log('\n--- ConversationStore ---');

// Mock LSManager
function createMockLSManager(connected = false) {
    return {
        ls: connected ? { port: 12345, csrf: 'test-csrf' } : null,
        on: () => { },
        emit: () => { },
    };
}

test('constructor initializes', () => {
    const store = new ConversationStore(createMockLSManager());
    assert(store.conversations instanceof Map);
    assert.strictEqual(store.conversations.size, 0);
    assert(store.config);
    assert(store.config.model);
});

test('setConfig updates valid keys only', () => {
    const store = new ConversationStore(createMockLSManager());
    const originalModel = store.config.model;

    store.setConfig({ model: 'NEW_MODEL', invalidKey: 'should_ignore' });
    assert.strictEqual(store.config.model, 'NEW_MODEL');
    assert.strictEqual(store.config.invalidKey, undefined);
});

test('getConfig returns copy', () => {
    const store = new ConversationStore(createMockLSManager());
    const cfg1 = store.getConfig();
    const cfg2 = store.getConfig();
    assert.notStrictEqual(cfg1, cfg2, 'should be different objects');
    assert.deepStrictEqual(cfg1, cfg2, 'should have same content');
});

test('getOrCreate creates new state', () => {
    const store = new ConversationStore(createMockLSManager());
    const conv = store.getOrCreate('new-id');
    assert.strictEqual(conv.cascadeId, 'new-id');
    assert.strictEqual(store.conversations.size, 1);
});

test('getOrCreate returns existing', () => {
    const store = new ConversationStore(createMockLSManager());
    const conv1 = store.getOrCreate('same-id');
    conv1.status = 'RUNNING';
    const conv2 = store.getOrCreate('same-id');
    assert.strictEqual(conv1, conv2, 'should be same reference');
    assert.strictEqual(conv2.status, 'RUNNING');
});

test('newChat throws when LS not connected', async () => {
    const store = new ConversationStore(createMockLSManager(false));
    try {
        await store.newChat();
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('not connected'));
    }
});

test('sendMessage throws when LS not connected', async () => {
    const store = new ConversationStore(createMockLSManager(false));
    try {
        await store.sendMessage('id', 'hello');
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('not connected'));
    }
});

test('cancelCascade throws when LS not connected', async () => {
    const store = new ConversationStore(createMockLSManager(false));
    try {
        await store.cancelCascade('id');
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('not connected'));
    }
});

test('getTrajectory throws when LS not connected', async () => {
    const store = new ConversationStore(createMockLSManager(false));
    try {
        await store.getTrajectory('id');
        assert.fail('should throw');
    } catch (e) {
        assert(e.message.includes('not connected'));
    }
});

test('destroy clears conversations', () => {
    const store = new ConversationStore(createMockLSManager());
    store.getOrCreate('a');
    store.getOrCreate('b');
    assert.strictEqual(store.conversations.size, 2);
    store.destroy();
    assert.strictEqual(store.conversations.size, 0);
});

// ========== Constants ==========

console.log('\n--- constants ---');

test('POLL_MIN_INTERVAL is reasonable', () => {
    assert(POLL_MIN_INTERVAL >= 500 && POLL_MIN_INTERVAL <= 5000);
});

test('EVENT_BUFFER_MAX is reasonable', () => {
    assert(EVENT_BUFFER_MAX >= 50 && EVENT_BUFFER_MAX <= 1000);
});

// ========== Summary ==========

console.log(`\n${'='.repeat(40)}`);
console.log(`state.test: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
