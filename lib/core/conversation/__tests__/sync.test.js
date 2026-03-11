/**
 * conversation/sync.js 单元测试
 * Run: node lib/core/conversation/__tests__/sync.test.js
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

const { ConversationSync } = require('../sync');
const { ConversationStore } = require('../state');

// ========== Mock Helpers ==========

function createMockLSManager() {
    let streamChangeCb = null;
    let streamUpdateCb = null;
    let getSubsCb = null;
    return {
        ls: null,
        onStreamChange(cb) { streamChangeCb = cb; },
        onStreamUpdate(cb) { streamUpdateCb = cb; },
        onGetActiveSubscriptions(cb) { getSubsCb = cb; },
        getStreamClient() { return null; },
        refreshLS: async () => false,
        _streamChangeCb: () => streamChangeCb,
        _streamUpdateCb: () => streamUpdateCb,
        _getSubsCb: () => getSubsCb,
    };
}

function createMockWS(readyState = 1) {
    const sent = [];
    return {
        readyState,
        send(data) { sent.push(JSON.parse(data)); },
        _sent: sent,
    };
}

// ========== diffSteps ==========

console.log('\n--- diffSteps ---');

test('empty -> empty = no diff', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps([], []);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.updated.length, 0);
    sync.destroy();
});

test('empty -> [A] = 1 added', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps([], [{ status: 'DONE' }]);
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0].index, 0);
    assert.strictEqual(diff.updated.length, 0);
    sync.destroy();
});

test('status change = updated', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps(
        [{ status: 'GENERATING', plannerResponse: { response: 'hi' } }],
        [{ status: 'DONE', plannerResponse: { response: 'hi' } }],
    );
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.updated.length, 1);
    assert.strictEqual(diff.updated[0].index, 0);
    sync.destroy();
});

test('text change with same status = updated', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps(
        [{ status: 'GENERATING', plannerResponse: { response: 'hello' } }],
        [{ status: 'GENERATING', plannerResponse: { response: 'hello world' } }],
    );
    assert.strictEqual(diff.updated.length, 1, 'text grew -> should be updated');
    sync.destroy();
});

test('thinking change = updated', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps(
        [{ status: 'GENERATING', plannerResponse: { thinking: 'hmm' } }],
        [{ status: 'GENERATING', plannerResponse: { thinking: 'hmm, let me think' } }],
    );
    assert.strictEqual(diff.updated.length, 1);
    sync.destroy();
});

test('no change = no diff', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const step = { status: 'DONE', plannerResponse: { response: 'hello', thinking: '' } };
    const diff = sync.diffSteps([step], [step]);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.updated.length, 0);
    sync.destroy();
});

test('mixed: 1 same + 1 updated + 1 added', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const diff = sync.diffSteps(
        [
            { status: 'DONE', plannerResponse: { response: 'a' } },
            { status: 'GENERATING', plannerResponse: { response: 'b' } },
        ],
        [
            { status: 'DONE', plannerResponse: { response: 'a' } },       // same
            { status: 'DONE', plannerResponse: { response: 'b final' } }, // updated (status + text)
            { status: 'NEW', plannerResponse: { response: 'c' } },        // added
        ],
    );
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0].index, 2);
    assert.strictEqual(diff.updated.length, 1);
    assert.strictEqual(diff.updated[0].index, 1);
    sync.destroy();
});

// ========== subscribe / unsubscribe ==========

console.log('\n--- subscribe / unsubscribe ---');

test('subscribe adds ws to subscribers', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);

    const conv = store.conversations.get('conv-1');
    assert(conv, 'should create conversation state');
    assert.strictEqual(conv.subscribers.size, 1);
    assert(conv.subscribers.has(ws));
    sync.destroy();
});

test('unsubscribe removes ws', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);
    sync.unsubscribe('conv-1', ws);

    const conv = store.conversations.get('conv-1');
    assert.strictEqual(conv.subscribers.size, 0);
    sync.destroy();
});

test('unsubscribeAll removes from all conversations', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);
    sync.subscribe('conv-2', ws);

    assert.strictEqual(store.conversations.get('conv-1').subscribers.size, 1);
    assert.strictEqual(store.conversations.get('conv-2').subscribers.size, 1);

    sync.unsubscribeAll(ws);

    assert.strictEqual(store.conversations.get('conv-1').subscribers.size, 0);
    assert.strictEqual(store.conversations.get('conv-2').subscribers.size, 0);
    sync.destroy();
});

test('getCurrentSeq starts at 0', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    assert.strictEqual(sync.getCurrentSeq('nonexistent'), 0);
    sync.destroy();
});

// ========== _broadcastWithSeq (via subscribe + manual trigger) ==========

console.log('\n--- broadcast ---');

test('broadcast assigns sequential seq', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);

    const conv = store.conversations.get('conv-1');
    // Manually call _broadcastWithSeq
    sync._broadcastWithSeq(conv, { type: 'event_step_added', cascadeId: 'conv-1', step: {} });
    sync._broadcastWithSeq(conv, { type: 'event_step_updated', cascadeId: 'conv-1', step: {} });

    assert.strictEqual(ws._sent.length, 2);
    assert.strictEqual(ws._sent[0].seq, 1);
    assert.strictEqual(ws._sent[1].seq, 2);
    assert.strictEqual(sync.getCurrentSeq('conv-1'), 2);
    sync.destroy();
});

test('broadcast buffers events', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);

    const conv = store.conversations.get('conv-1');
    sync._broadcastWithSeq(conv, { type: 'test', cascadeId: 'conv-1' });
    sync._broadcastWithSeq(conv, { type: 'test', cascadeId: 'conv-1' });

    assert.strictEqual(conv.eventBuffer.length, 2);
    assert.strictEqual(conv.eventBuffer[0].seq, 1);
    assert.strictEqual(conv.eventBuffer[1].seq, 2);
    sync.destroy();
});

test('broadcast removes dead ws', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const deadWs = createMockWS(3); // readyState=3 = CLOSED
    sync.subscribe('conv-1', deadWs);

    const conv = store.conversations.get('conv-1');
    sync._broadcastWithSeq(conv, { type: 'test', cascadeId: 'conv-1' });

    assert.strictEqual(conv.subscribers.size, 0, 'dead ws should be removed');
    sync.destroy();
});

// ========== subscribe with lastSeq recovery ==========

console.log('\n--- incremental recovery ---');

test('subscribe with lastSeq sends missed events', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    // First: create some buffered events
    const ws1 = createMockWS();
    sync.subscribe('conv-1', ws1);

    const conv = store.conversations.get('conv-1');
    sync._broadcastWithSeq(conv, { type: 'e1', cascadeId: 'conv-1' });
    sync._broadcastWithSeq(conv, { type: 'e2', cascadeId: 'conv-1' });
    sync._broadcastWithSeq(conv, { type: 'e3', cascadeId: 'conv-1' });

    // Second: new ws subscribes with lastSeq=1 (missed seq 2 and 3)
    const ws2 = createMockWS();
    sync.subscribe('conv-1', ws2, 1);

    assert.strictEqual(ws2._sent.length, 1, 'should receive events_batch');
    assert.strictEqual(ws2._sent[0].type, 'events_batch');
    assert.strictEqual(ws2._sent[0].events.length, 2, 'should have 2 missed events');
    assert.strictEqual(ws2._sent[0].events[0].seq, 2);
    assert.strictEqual(ws2._sent[0].events[1].seq, 3);
    sync.destroy();
});

// ========== polling ==========

console.log('\n--- polling ---');

test('startPolling / stopPolling', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    assert.strictEqual(sync.isPolling, false);
    sync.startPolling();
    assert.strictEqual(sync.isPolling, true);
    sync.stopPolling();
    assert.strictEqual(sync.isPolling, false);
    sync.destroy();
});

// ========== destroy ==========

console.log('\n--- destroy ---');

test('destroy cleans up', () => {
    const mgr = createMockLSManager();
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    sync.startPolling();
    sync.destroy();
    assert.strictEqual(sync.isPolling, false);
});

// ========== grpc mock paths ==========

console.log('\n--- grpc mock paths ---');

testAsync('_fetchAndDiff success via grpc', async () => {
    const grpc = require('../../ls/grpc');
    const oldCall = grpc.grpcCall;
    const mgr = createMockLSManager();
    mgr.ls = { port: 12345, csrf: 'test' }; // Enable connected LS
    const store = new ConversationStore(mgr);
    const sync = new ConversationSync(mgr, store);

    const ws = createMockWS();
    sync.subscribe('conv-1', ws);

    try {
        grpc.grpcCall = async () => ({
            data: {
                trajectory: { steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT', status: 'CORTEX_STEP_STATUS_DONE' }] },
                status: 'CASCADE_RUN_STATUS_RUNNING',
                numTotalSteps: 1
            }
        });
        await sync._fetchAndDiff('conv-1');

        const conv = store.conversations.get('conv-1');
        assert.strictEqual(conv.steps.length, 1);
        assert.strictEqual(conv.status, 'RUNNING');

        const addedEvents = ws._sent.filter(e => e.type === 'event_step_added');
        assert.strictEqual(addedEvents.length, 1);
    } finally {
        grpc.grpcCall = oldCall;
        sync.destroy();
    }
});

// ========== Summary ==========

console.log(`\n${'='.repeat(40)}`);
console.log(`sync.test: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
