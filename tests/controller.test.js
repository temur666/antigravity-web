/**
 * tests/controller.test.js — controller.js 单元测试
 * Run: node tests/controller.test.js
 *      node tests/controller.test.js --integration
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

const { Controller } = require('../lib/controller');

// ========== Tests: 构造 ==========

console.log('\n🏗️ Controller 构造');

test('可以创建实例', () => {
    const ctrl = new Controller();
    assert(ctrl instanceof Controller);
});

test('初始状态正确', () => {
    const ctrl = new Controller();
    assert.strictEqual(ctrl.ls, null);
    assert.strictEqual(ctrl.conversations.size, 0);
    assert.strictEqual(ctrl.isPolling, false);
});

test('默认配置正确', () => {
    const ctrl = new Controller();
    assert.strictEqual(ctrl.config.model, 'MODEL_PLACEHOLDER_M37');
    assert.strictEqual(ctrl.config.agenticMode, true);
});

// ========== Tests: Config ==========

console.log('\n⚙️ 配置管理');

test('setConfig 部分更新', () => {
    const ctrl = new Controller();
    ctrl.setConfig({ model: 'MODEL_PLACEHOLDER_M26' });
    assert.strictEqual(ctrl.config.model, 'MODEL_PLACEHOLDER_M26');
    assert.strictEqual(ctrl.config.agenticMode, true, 'other fields unchanged');
});

test('setConfig 不接受未知字段', () => {
    const ctrl = new Controller();
    ctrl.setConfig({ unknownField: 'value' });
    assert.strictEqual(ctrl.config.unknownField, undefined);
});

test('getConfig 返回副本', () => {
    const ctrl = new Controller();
    const cfg = ctrl.getConfig();
    cfg.model = 'CHANGED';
    assert.strictEqual(ctrl.config.model, 'MODEL_PLACEHOLDER_M37', 'should not mutate');
});

// ========== Tests: Diff 引擎 ==========

console.log('\n🔄 Diff 引擎');

test('空 → 有 steps = 全部 added', () => {
    const ctrl = new Controller();
    const oldSteps = [];
    const newSteps = [
        { type: 'USER_INPUT', status: 'DONE' },
        { type: 'PLANNER_RESPONSE', status: 'DONE' },
    ];
    const diff = ctrl.diffSteps(oldSteps, newSteps);
    assert.strictEqual(diff.added.length, 2);
    assert.strictEqual(diff.updated.length, 0);
    assert.strictEqual(diff.added[0].index, 0);
    assert.strictEqual(diff.added[1].index, 1);
});

test('相同 steps = 无变化', () => {
    const ctrl = new Controller();
    const steps = [
        { type: 'USER_INPUT', status: 'DONE' },
    ];
    const diff = ctrl.diffSteps(steps, steps);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.updated.length, 0);
});

test('step 状态变化 = updated', () => {
    const ctrl = new Controller();
    const oldSteps = [
        { type: 'PLANNER_RESPONSE', status: 'RUNNING' },
    ];
    const newSteps = [
        { type: 'PLANNER_RESPONSE', status: 'DONE' },
    ];
    const diff = ctrl.diffSteps(oldSteps, newSteps);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.updated.length, 1);
    assert.strictEqual(diff.updated[0].index, 0);
    assert.strictEqual(diff.updated[0].step.status, 'DONE');
});

test('新增 + 更新 mixed', () => {
    const ctrl = new Controller();
    const oldSteps = [
        { type: 'USER_INPUT', status: 'DONE' },
        { type: 'PLANNER_RESPONSE', status: 'GENERATING' },
    ];
    const newSteps = [
        { type: 'USER_INPUT', status: 'DONE' },
        { type: 'PLANNER_RESPONSE', status: 'DONE' },
        { type: 'VIEW_FILE', status: 'DONE' },
    ];
    const diff = ctrl.diffSteps(oldSteps, newSteps);
    assert.strictEqual(diff.added.length, 1, 'should have 1 added');
    assert.strictEqual(diff.updated.length, 1, 'should have 1 updated');
    assert.strictEqual(diff.added[0].index, 2);
    assert.strictEqual(diff.updated[0].index, 1);
});

// ========== Tests: Subscribe/Unsubscribe ==========

console.log('\n📡 订阅管理');

test('subscribe 创建 ConversationState', () => {
    const ctrl = new Controller();
    const mockWs = { readyState: 1 };
    ctrl.subscribe('cascade-1', mockWs);
    const conv = ctrl.conversations.get('cascade-1');
    assert(conv, 'should create conversation state');
    assert(conv.subscribers.has(mockWs), 'should add subscriber');
});

test('subscribe 多个客户端', () => {
    const ctrl = new Controller();
    const ws1 = { readyState: 1 };
    const ws2 = { readyState: 1 };
    ctrl.subscribe('c1', ws1);
    ctrl.subscribe('c1', ws2);
    assert.strictEqual(ctrl.conversations.get('c1').subscribers.size, 2);
});

test('unsubscribe 移除客户端', () => {
    const ctrl = new Controller();
    const ws1 = { readyState: 1 };
    ctrl.subscribe('c1', ws1);
    ctrl.unsubscribe('c1', ws1);
    assert.strictEqual(ctrl.conversations.get('c1').subscribers.size, 0);
});

test('unsubscribe 不存在的对话不报错', () => {
    const ctrl = new Controller();
    const ws1 = { readyState: 1 };
    ctrl.unsubscribe('nonexistent', ws1);
    // 不应 throw
});

test('unsubscribeAll 清除所有订阅', () => {
    const ctrl = new Controller();
    const ws1 = { readyState: 1 };
    ctrl.subscribe('c1', ws1);
    ctrl.subscribe('c2', ws1);
    ctrl.unsubscribeAll(ws1);
    assert.strictEqual(ctrl.conversations.get('c1').subscribers.size, 0);
    assert.strictEqual(ctrl.conversations.get('c2').subscribers.size, 0);
});

// ========== Tests: formatStatus ==========

console.log('\n📊 状态格式化');

test('getStatus 格式正确', () => {
    const ctrl = new Controller();
    const status = ctrl.getStatus();
    assert('ls' in status, 'should have ls');
    assert('config' in status, 'should have config');
    assert('conversations' in status, 'should have conversations');
    assert.strictEqual(status.ls.connected, false);
});

// ========== Integration Tests ==========

console.log('\n🔌 集成测试 (需要真实 LS)');

const isIntegration = process.argv.includes('--integration');

if (isIntegration) {
    (async () => {
        await testAsync('init 连接 LS', async () => {
            const ctrl = new Controller();
            const ok = await ctrl.init();
            assert(ok, 'should init successfully');
            assert(ctrl.ls, 'should have ls info');
            assert(ctrl.ls.port, 'should have port');
            console.log(`     LS: PID=${ctrl.ls.pid}, Port=${ctrl.ls.port}`);
        });

        await testAsync('listConversations 从 LS', async () => {
            const ctrl = new Controller();
            await ctrl.init();
            const list = await ctrl.listConversations();
            assert(Array.isArray(list), 'should return array');
            console.log(`     ${list.length} conversations found`);
        });

        await testAsync('newChat + sendMessage 流程', async () => {
            const ctrl = new Controller();
            await ctrl.init();

            const cascadeId = await ctrl.newChat();
            assert(cascadeId, 'should get cascadeId');
            console.log(`     cascadeId=${cascadeId}`);

            await ctrl.sendMessage(cascadeId, '回复 OK 即可，不要做任何其他事');
            console.log(`     message sent`);

            // 等待一下让 LS 处理
            await new Promise(r => setTimeout(r, 3000));

            const traj = await ctrl.getTrajectory(cascadeId);
            assert(traj, 'should get trajectory');
            assert(traj.status, 'should have status');
            console.log(`     status=${traj.status}, steps=${traj.numTotalSteps}`);
        });

        await testAsync('pollOnce 基本功能', async () => {
            const ctrl = new Controller();
            await ctrl.init();
            // pollOnce 不抛错即可
            await ctrl.pollOnce();
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
