/**
 * tests/service.test.js — service.js 测试
 * 
 * 测试不需要 IDE 运行的部分（listConversations, findConversation）
 * API 相关的测试需要 IDE 运行，标记为 integration
 * 
 * Run: node tests/service.test.js
 * Integration: node tests/service.test.js --integration
 */
const assert = require('assert');
const service = require('../lib/service');

const isIntegration = process.argv.includes('--integration');
let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(name) {
    console.log(`  ⏭️  ${name} (skipped)`);
    skipped++;
}

// ========== Unit Tests (无需 IDE) ==========

console.log('\n📋 listConversations');

test('返回对话列表', () => {
    const result = service.listConversations();
    assert(Array.isArray(result.conversations), 'should return array');
    assert(typeof result.total === 'number', 'should return total');
});

test('limit 限制数量', () => {
    const all = service.listConversations();
    if (all.total > 1) {
        const limited = service.listConversations({ limit: 1 });
        assert.strictEqual(limited.conversations.length, 1, 'should limit to 1');
        assert.strictEqual(limited.total, all.total, 'total should not change');
    }
});

test('search 搜索功能', () => {
    const all = service.listConversations();
    if (all.conversations.length > 0) {
        const first = all.conversations[0];
        if (first.title) {
            const result = service.listConversations({ search: first.title.substring(0, 5) });
            assert(result.conversations.length > 0, 'should find by title substring');
        }
    }
});

// --- findConversation ---

console.log('\n🔍 findConversation');

test('按索引查找', () => {
    const all = service.listConversations();
    if (all.conversations.length > 0) {
        const result = service.findConversation(0);
        assert(result.conversation, 'should find by index 0');
        assert.strictEqual(result.conversation.id, all.conversations[0].id);
    }
});

test('按索引字符串查找', () => {
    const all = service.listConversations();
    if (all.conversations.length > 0) {
        const result = service.findConversation('0');
        assert(result.conversation, 'should find by string index "0"');
    }
});

test('索引超出范围返回 error', () => {
    const result = service.findConversation(99999);
    assert(result.error, 'should return error for out-of-range index');
    assert(!result.conversation, 'should not return conversation');
});

test('按 ID 查找', () => {
    const all = service.listConversations();
    if (all.conversations.length > 0) {
        const id = all.conversations[0].id;
        const result = service.findConversation(id);
        assert(result.conversation, 'should find by full ID');
        assert.strictEqual(result.conversation.id, id);
    }
});

test('按部分 ID 查找', () => {
    const all = service.listConversations();
    if (all.conversations.length > 0) {
        const id = all.conversations[0].id;
        const partial = id.substring(0, 8);
        const result = service.findConversation(partial);
        assert(result.conversation, `should find by partial ID "${partial}"`);
    }
});

test('按标题查找', () => {
    const all = service.listConversations();
    const withTitle = all.conversations.find(c => c.title);
    if (withTitle) {
        const result = service.findConversation(withTitle.title);
        assert(result.conversation, 'should find by title');
    }
});

test('找不到返回 error', () => {
    const result = service.findConversation('this-does-not-exist-at-all-12345');
    assert(result.error, 'should return error');
    assert(!result.conversation, 'should not return conversation');
});

// --- getStatus ---

console.log('\n📊 getStatus');

test('返回状态', () => {
    const status = service.getStatus();
    assert(typeof status.initialized === 'boolean', 'should have initialized flag');
    assert(status.api, 'should have api status');
});

// ========== Integration Tests (需要 IDE) ==========

if (isIntegration) {
    console.log('\n🔌 Integration Tests (需要 Antigravity IDE 运行)');

    (async () => {
        await testAsync('init 成功', async () => {
            const result = await service.init({ quiet: true });
            assert(result.success, `init should succeed: ${result.error}`);
        });

        await testAsync('getConversation 获取最新对话', async () => {
            const all = service.listConversations({ localOnly: true });
            if (all.conversations.length > 0) {
                const conv = all.conversations[0];
                const result = await service.getConversation(conv.id);
                assert(!result.error, `should not error: ${result.error}`);
                assert(result.data, 'should return data');
                assert(result.data.trajectory, 'should have trajectory');
            }
        });

        await testAsync('exportConversation 返回 markdown + json', async () => {
            const all = service.listConversations({ localOnly: true });
            if (all.conversations.length > 0) {
                const conv = all.conversations[0];
                const result = await service.exportConversation(conv.id, { title: conv.title });
                assert(!result.error, `should not error: ${result.error}`);
                assert(result.markdown.length > 0, 'should have markdown');
                assert(result.json, 'should have json');
                assert(result.metadata, 'should have metadata');
                assert(!result.markdown.includes('thinkingSignature'), 'should NOT include signature');
            }
        });

        await testAsync('exportConversation 无效 ID 返回 error', async () => {
            const result = await service.exportConversation('nonexistent-id', { title: 'X' });
            assert(result.error, 'should return error for bad ID');
        });

        console.log(`\n${'═'.repeat(40)}`);
        console.log(`结果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        console.log(`${'═'.repeat(40)}\n`);
        process.exit(failed > 0 ? 1 : 0);
    })();
} else {
    console.log(`\n${'═'.repeat(40)}`);
    console.log(`结果: ${passed} passed, ${failed} failed`);
    console.log(`(跑 --integration 测试 API 功能)`);
    console.log(`${'═'.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
}
