/**
 * tests/ws-protocol.test.js — ws-protocol.js 单元测试
 * Run: node tests/ws-protocol.test.js
 */
const assert = require('assert');

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

const proto = require('../lib/core/ws-protocol');

// ========== Tests: 消息类型常量 ==========

console.log('\n📋 消息类型常量');

test('REQ 类型完整', () => {
    const expected = [
        'req_status', 'req_conversations', 'req_trajectory',
        'req_new_chat', 'req_send_message', 'req_subscribe',
        'req_unsubscribe', 'req_set_config', 'req_get_config',
    ];
    for (const t of expected) {
        assert(proto.REQ_TYPES.includes(t), `should include ${t}`);
    }
});

test('RES 类型完整', () => {
    const expected = [
        'res_status', 'res_conversations', 'res_trajectory',
        'res_new_chat', 'res_send_message', 'res_subscribe',
        'res_config', 'res_error',
    ];
    for (const t of expected) {
        assert(proto.RES_TYPES.includes(t), `should include ${t}`);
    }
});

test('EVENT 类型完整', () => {
    const expected = [
        'event_step_added', 'event_step_updated',
        'event_status_changed', 'event_ls_status',
    ];
    for (const t of expected) {
        assert(proto.EVENT_TYPES.includes(t), `should include ${t}`);
    }
});

// ========== Tests: parseMessage ==========

console.log('\n📨 parseMessage');

test('解析有效的 req_status', () => {
    const msg = proto.parseMessage('{"type":"req_status","reqId":"abc"}');
    assert.strictEqual(msg.type, 'req_status');
    assert.strictEqual(msg.reqId, 'abc');
});

test('解析带 payload 的消息', () => {
    const msg = proto.parseMessage('{"type":"req_send_message","cascadeId":"id1","text":"hello"}');
    assert.strictEqual(msg.type, 'req_send_message');
    assert.strictEqual(msg.cascadeId, 'id1');
    assert.strictEqual(msg.text, 'hello');
});

test('无效 JSON 返回 error', () => {
    const msg = proto.parseMessage('not json');
    assert.strictEqual(msg.type, 'error');
    assert(msg.message.includes('JSON'), 'should mention JSON');
});

test('缺少 type 返回 error', () => {
    const msg = proto.parseMessage('{"data":"no type"}');
    assert.strictEqual(msg.type, 'error');
    assert(msg.message.includes('type'), 'should mention type');
});

test('未知 type 返回原样 (不拦截)', () => {
    const msg = proto.parseMessage('{"type":"unknown_type"}');
    assert.strictEqual(msg.type, 'unknown_type');
});

// ========== Tests: makeResponse ==========

console.log('\n📤 makeResponse');

test('res_status 构造', () => {
    const json = proto.makeResponse('res_status', { ls: { connected: true } }, 'req-1');
    const msg = JSON.parse(json);
    assert.strictEqual(msg.type, 'res_status');
    assert.strictEqual(msg.reqId, 'req-1');
    assert.strictEqual(msg.ls.connected, true);
});

test('res_error 构造', () => {
    const json = proto.makeError('NOT_FOUND', 'Conversation not found', 'req-2');
    const msg = JSON.parse(json);
    assert.strictEqual(msg.type, 'res_error');
    assert.strictEqual(msg.code, 'NOT_FOUND');
    assert.strictEqual(msg.message, 'Conversation not found');
    assert.strictEqual(msg.reqId, 'req-2');
});

test('res_error 无 reqId', () => {
    const json = proto.makeError('INTERNAL', 'oops');
    const msg = JSON.parse(json);
    assert.strictEqual(msg.type, 'res_error');
    assert.strictEqual(msg.reqId, undefined);
});

// ========== Tests: makeEvent ==========

console.log('\n📢 makeEvent');

test('event_step_added 构造', () => {
    const json = proto.makeEvent('event_step_added', {
        cascadeId: 'c1',
        stepIndex: 5,
        step: { type: 'PLANNER_RESPONSE' },
    });
    const msg = JSON.parse(json);
    assert.strictEqual(msg.type, 'event_step_added');
    assert.strictEqual(msg.cascadeId, 'c1');
    assert.strictEqual(msg.stepIndex, 5);
});

test('event_status_changed 构造', () => {
    const json = proto.makeEvent('event_status_changed', {
        cascadeId: 'c2',
        from: 'RUNNING',
        to: 'IDLE',
    });
    const msg = JSON.parse(json);
    assert.strictEqual(msg.from, 'RUNNING');
    assert.strictEqual(msg.to, 'IDLE');
});

// ========== Tests: DEFAULT_CONFIG ==========

console.log('\n⚙️ DEFAULT_CONFIG');

test('默认配置完整', () => {
    const cfg = proto.DEFAULT_CONFIG;
    assert.strictEqual(cfg.model, 'MODEL_PLACEHOLDER_M37');
    assert.strictEqual(cfg.agenticMode, true);
    assert(cfg.autoExecutionPolicy, 'should have autoExecutionPolicy');
    assert(cfg.artifactReviewMode, 'should have artifactReviewMode');
    assert.strictEqual(cfg.knowledgeEnabled, true);
    assert.strictEqual(cfg.ephemeralEnabled, true);
    assert.strictEqual(cfg.conversationHistoryEnabled, true);
});

test('buildSendBody 构造完整请求体', () => {
    const body = proto.buildSendBody('cascade-1', 'hello world');
    assert.strictEqual(body.cascadeId, 'cascade-1');
    assert.strictEqual(body.items[0].text, 'hello world');
    assert.strictEqual(body.cascadeConfig.plannerConfig.conversational.agenticMode, true);
    assert.strictEqual(body.cascadeConfig.plannerConfig.requestedModel.model, 'MODEL_PLACEHOLDER_M37');
});

test('buildSendBody 自定义 config', () => {
    const cfg = { ...proto.DEFAULT_CONFIG, model: 'MODEL_PLACEHOLDER_M26', agenticMode: false };
    const body = proto.buildSendBody('c2', 'test', cfg);
    assert.strictEqual(body.cascadeConfig.plannerConfig.conversational.agenticMode, false);
    assert.strictEqual(body.cascadeConfig.plannerConfig.requestedModel.model, 'MODEL_PLACEHOLDER_M26');
});

test('buildSendBody 支持 mentions (文件引用)', () => {
    const mentions = [
        { file: { absoluteUri: 'file:///home/user/project/app.tsx' } },
    ];
    const body = proto.buildSendBody('c3', 'fix this file', proto.DEFAULT_CONFIG, { mentions });
    // items 应包含 text + mentions
    assert.strictEqual(body.items[0].text, 'fix this file');
    assert.strictEqual(body.items.length, 3); // text + mention + trailing space
    assert.deepStrictEqual(body.items[1], { item: mentions[0] });
    assert.strictEqual(body.items[2].text, ' ');
});

test('buildSendBody 支持 media (图片)', () => {
    const media = [
        { mimeType: 'image/png', uri: '/path/to/image.png', thumbnail: 'base64data' },
    ];
    const body = proto.buildSendBody('c4', 'describe this', proto.DEFAULT_CONFIG, { media });
    assert.deepStrictEqual(body.media, media);
    assert.strictEqual(body.items[0].text, 'describe this');
});

test('buildSendBody 无 mentions/media 时不添加额外字段', () => {
    const body = proto.buildSendBody('c5', 'plain text');
    assert.strictEqual(body.items.length, 1);
    assert.strictEqual(body.media, undefined);
});

// ========== Summary ==========

console.log(`\n${'═'.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
