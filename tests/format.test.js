/**
 * tests/format.test.js — format.js 纯函数测试
 * Run: node tests/format.test.js
 */
const assert = require('assert');
const { toMarkdown, formatConversationList, extractMetadata, PLANNER_SKIP_KEYS } = require('../lib/data/format');

// ========== Test Data ==========

const MOCK_TRAJECTORY = {
    trajectory: {
        cascadeId: 'test-cascade-123',
        metadata: { createdAt: '2026-02-26T03:00:00Z' },
        steps: [
            { type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { items: [{ text: '你好' }] } },
            {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                plannerResponse: {
                    response: '你好！有什么可以帮你的？',
                    modifiedResponse: '你好！有什么可以帮你的？',  // 应被过滤（重复）
                    thinking: '用户发了问候，需要友好回复',
                    thinkingSignature: 'RXY0Q0NrZ0lDeEFDR0FJ...',  // 应被过滤（base64签名）
                    thinkingDuration: '1.5s',
                    messageId: 'bot-msg-001',  // 应被过滤
                    stopReason: 'STOP_REASON_STOP_PATTERN',
                },
            },
            { type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { items: [{ text: '分析代码' }] } },
            {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                plannerResponse: {
                    response: '让我看看这个文件',
                    thinking: '需要先读取文件内容',
                    thinkingDuration: '2.0s',
                    stopReason: 'STOP_REASON_TOOL_USE',
                    toolCalls: [{ name: 'view_file' }],  // 应被过滤（结构化数据）
                },
            },
            {
                type: 'CORTEX_STEP_TYPE_TOOL_CALL',
                toolCall: { name: 'view_file', input: '{"path":"/test.js"}' },
            },
            {
                type: 'CORTEX_STEP_TYPE_TOOL_RESULT',
                toolResult: { output: 'console.log("hello")' },
            },
            {
                type: 'CORTEX_STEP_TYPE_CHECKPOINT',
                checkpoint: { userIntent: 'Code Analysis\nMulti-line intent' },
            },
            {
                type: 'CORTEX_STEP_TYPE_SEARCH_WEB',
                searchWeb: { query: 'node.js best practices', results: [{ title: 'Guide', url: 'https://example.com' }] },
            },
        ],
        generatorMetadata: [
            { chatModel: { usage: { model: 'claude-3.5', inputTokens: 1000, outputTokens: 500, apiProvider: 'google' } } },
        ],
    },
};

const MOCK_CONVERSATIONS = [
    { id: 'conv-1', title: 'API Test', workspace: 'c:/projects/web', stepCount: 50, updatedAt: '2026-02-26T03:00:00.000Z' },
    { id: 'conv-2', title: '代码分析', workspace: 'c:/projects/app', stepCount: 30, updatedAt: '2026-02-25T12:00:00.000Z' },
    { id: 'conv-3', title: '', workspace: '', stepCount: 5, updatedAt: null },
];

// ========== Tests ==========

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

// --- toMarkdown ---

console.log('\n📄 toMarkdown');

test('基本输出包含标题', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test Chat');
    assert(md.startsWith('# Test Chat'), 'should start with title');
});

test('包含 cascade ID', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('test-cascade-123'), 'should include cascade ID');
});

test('包含用户消息', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('你好'), 'should include user message');
    assert(md.includes('分析代码'), 'should include second user message');
});

test('包含 AI 回复', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('你好！有什么可以帮你的？'), 'should include AI response');
});

test('包含 Thinking（折叠）', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('🧠 Thinking'), 'should have thinking header');
    assert(md.includes('用户发了问候'), 'should include thinking content');
    assert(md.includes('<details>'), 'should use details for folding');
    assert(md.includes('1.5s'), 'should include thinking duration');
});

test('不包含 thinkingSignature (base64)', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(!md.includes('RXY0Q0NrZ0lDeEFDR0FJ'), 'should NOT include thinking signature');
});

test('不包含 modifiedResponse（重复内容）', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    // response 出现 1 次是正常的，但 modifiedResponse 不应再输出一次
    const count = md.split('你好！有什么可以帮你的？').length - 1;
    assert.strictEqual(count, 1, `response should appear exactly once, got ${count}`);
});

test('不包含 messageId', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(!md.includes('bot-msg-001'), 'should NOT include messageId');
});

test('包含 Turn 编号', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('## Turn 1'), 'should have Turn 1');
    assert(md.includes('## Turn 2'), 'should have Turn 2');
});

test('包含 Checkpoint', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('📌 **Code Analysis**'), 'should include checkpoint (first line only)');
});

test('包含 Web Search', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('🔍 Web Search'), 'should include search header');
    assert(md.includes('node.js best practices'), 'should include query');
});

test('包含 Tool Call', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('🔧 Tool: view_file'), 'should include tool name');
});

test('包含 Metadata', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('claude-3.5'), 'should include model name');
    assert(md.includes('1000'), 'should include token count');
});

test('stopReason TOOL_USE 应显示', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(md.includes('*TOOL_USE*'), 'should show non-STOP_PATTERN stop reason');
});

test('stopReason STOP_PATTERN 不应显示', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test');
    assert(!md.includes('*STOP_PATTERN*'), 'should NOT show STOP_PATTERN');
});

test('options.includeThinking=false 不包含思考', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test', { includeThinking: false });
    assert(!md.includes('🧠 Thinking'), 'should NOT have thinking with option off');
});

test('options.includeToolCalls=false 不包含工具', () => {
    const md = toMarkdown(MOCK_TRAJECTORY, 'Test', { includeToolCalls: false });
    assert(!md.includes('🔧 Tool'), 'should NOT have tools with option off');
});

test('空 trajectory 不崩溃', () => {
    const md = toMarkdown({ trajectory: null }, 'Empty');
    assert(md.includes('Empty'), 'should handle null trajectory');
});

test('空 steps 不崩溃', () => {
    const md = toMarkdown({ trajectory: { cascadeId: 'x', steps: [] } }, 'NoSteps');
    assert(md.includes('NoSteps'), 'should handle empty steps');
});

// --- PLANNER_SKIP_KEYS ---

console.log('\n🔑 PLANNER_SKIP_KEYS');

test('包含所有需要过滤的字段', () => {
    const required = ['thinkingSignature', 'modifiedResponse', 'messageId', 'toolCalls', 'thinkingDuration'];
    for (const key of required) {
        assert(PLANNER_SKIP_KEYS.has(key), `should include ${key}`);
    }
});

// --- formatConversationList ---

console.log('\n📋 formatConversationList');

test('显示对话数量', () => {
    const out = formatConversationList(MOCK_CONVERSATIONS);
    assert(out.includes('3 个对话'), 'should show total count');
});

test('显示标题和 ID', () => {
    const out = formatConversationList(MOCK_CONVERSATIONS);
    assert(out.includes('API Test'), 'should include title');
    assert(out.includes('conv-1'), 'should include ID');
});

test('无标题显示 (无标题)', () => {
    const out = formatConversationList(MOCK_CONVERSATIONS);
    assert(out.includes('(无标题)'), 'should show placeholder for empty title');
});

test('limit 限制数量', () => {
    const out = formatConversationList(MOCK_CONVERSATIONS, { limit: 1 });
    assert(out.includes('API Test'), 'should include first');
    assert(!out.includes('代码分析'), 'should NOT include second');
    assert(out.includes('显示前 1 个'), 'should mention limit');
});

// --- extractMetadata ---

console.log('\n📊 extractMetadata');

test('正确计算 turns', () => {
    const meta = extractMetadata(MOCK_TRAJECTORY);
    assert.strictEqual(meta.turns, 2, 'should have 2 turns');
});

test('正确计算 totalSteps', () => {
    const meta = extractMetadata(MOCK_TRAJECTORY);
    assert.strictEqual(meta.totalSteps, 8, 'should have 8 steps');
});

test('提取 models', () => {
    const meta = extractMetadata(MOCK_TRAJECTORY);
    assert.deepStrictEqual(meta.models, ['claude-3.5'], 'should extract model');
});

test('空数据不崩溃', () => {
    const meta = extractMetadata({ trajectory: null });
    assert.strictEqual(meta.turns, 0);
    assert.strictEqual(meta.totalSteps, 0);
});

// ========== Summary ==========

console.log(`\n${'═'.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
