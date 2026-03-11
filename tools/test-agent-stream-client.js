/**
 * test-agent-stream-client.js — 对比测试 StreamClient vs AgentStreamClient
 *
 * 同时连接两个 stream，发送一条消息，对比各自收到的事件。
 *
 * 用法: node tools/test-agent-stream-client.js
 */

const { discoverLS, grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const { StreamClient } = require('../lib/core/ls/stream-client');
const { AgentStreamClient } = require('../lib/core/ls/agent-stream-client');

function ts() { return new Date().toISOString().slice(11, 23); }

async function main() {
    console.log('========================================');
    console.log('  StreamClient vs AgentStreamClient 对比测试');
    console.log(`  时间: ${new Date().toISOString()}`);
    console.log('========================================\n');

    const ls = discoverLS();
    if (!ls) { console.error('LS 未找到'); process.exit(1); }
    console.log(`LS: port=${ls.port}\n`);

    // 创建对话
    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cascadeId = r1.data.cascadeId;
    console.log(`对话: ${cascadeId}\n`);

    // ========== 旧版 StreamClient ==========
    const oldClient = new StreamClient(ls.port, ls.csrf);
    const oldEvents = [];

    oldClient.on('change', (data) => {
        oldEvents.push({ ts: ts(), type: 'change', ...data });
        console.log(`  [OLD] change  cascadeId=${data.cascadeId.slice(0, 8)} version=${data.version}`);
    });
    oldClient.on('snapshot', (data) => {
        oldEvents.push({ ts: ts(), type: 'snapshot', ...data });
        console.log(`  [OLD] snapshot cascadeId=${data.cascadeId.slice(0, 8)} version=${data.version}`);
    });
    oldClient.on('error', (err) => {
        console.log(`  [OLD] error: ${err.message}`);
    });
    oldClient.on('disconnected', (id) => {
        console.log(`  [OLD] disconnected: ${id.slice(0, 8)}`);
    });

    // ========== 新版 AgentStreamClient ==========
    const newClient = new AgentStreamClient(ls.port, ls.csrf);
    const newEvents = [];

    newClient.on('change', (data) => {
        newEvents.push({ ts: ts(), type: 'change' });
        // 不重复打印, update 事件会覆盖
    });
    newClient.on('update', ({ cascadeId: cid, data }) => {
        newEvents.push({ ts: ts(), type: 'update', ...data });

        const parts = [];
        if (data.status) parts.push(`status: ${data.prevStatus} → ${data.status}`);
        if (data.stepsUpdate) {
            const stepSummary = data.stepsUpdate.steps.map((s, i) => {
                const idx = data.stepsUpdate.indices[i] ?? '?';
                const type = (s.type || '').replace('CORTEX_STEP_TYPE_', '').slice(0, 20);
                const status = (s.status || '').replace('CORTEX_STEP_STATUS_', '');

                // 检查是否有文本内容
                let text = '';
                if (s.userInput?.text) text = ` "${s.userInput.text.slice(0, 30)}"`;
                if (s.plannerResponse?.response) text = ` "${s.plannerResponse.response.slice(0, 50)}"`;

                return `[${idx}]${type}(${status})${text}`;
            }).join(', ');
            parts.push(`steps: ${stepSummary} total=${data.stepsUpdate.totalLength}`);
        }
        if (data.metadataUpdate) {
            const metaSummary = data.metadataUpdate.metadatas.map(m => {
                const model = (m.chatModel?.model || '').replace('MODEL_', '').slice(0, 20);
                const inp = m.chatModel?.usage?.inputTokens || '?';
                const out = m.chatModel?.usage?.outputTokens || '?';
                return `${model}(in=${inp},out=${out})`;
            }).join(', ');
            parts.push(`metadata: ${metaSummary}`);
        }
        if (data.needsTextFetch) parts.push('needsTextFetch!');

        console.log(`  [NEW] update  ${parts.join('  |  ')}`);
    });
    newClient.on('error', (err) => {
        console.log(`  [NEW] error: ${err.message}`);
    });
    newClient.on('disconnected', (id) => {
        console.log(`  [NEW] disconnected: ${id.slice(0, 8)}`);
    });

    // ========== 订阅 ==========
    console.log('── 订阅 ──');
    oldClient.subscribe(cascadeId);
    newClient.subscribe(cascadeId);
    console.log(`  两个 client 已订阅 ${cascadeId.slice(0, 8)}...\n`);

    // 等连接建立
    await new Promise(r => setTimeout(r, 2000));

    // ========== 发送消息 ==========
    console.log('── 发送消息 ──');
    const body = buildSendBody(cascadeId, '回答：1+1等于几？只输出数字。', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
    console.log('  消息已发送，等待 20 秒收集事件...\n');

    // 等待
    await new Promise(r => setTimeout(r, 20000));

    // ========== 汇总 ==========
    console.log('\n========================================');
    console.log('  汇总');
    console.log('========================================\n');

    console.log(`旧版 StreamClient (StreamCascadeReactiveUpdates):`);
    console.log(`  总事件数: ${oldEvents.length}`);
    console.log(`  类型分布: change=${oldEvents.filter(e => e.type === 'change').length}, snapshot=${oldEvents.filter(e => e.type === 'snapshot').length}`);
    console.log(`  信息量: 只有 version 号, 需要每次拉取 GetCascadeTrajectory\n`);

    console.log(`新版 AgentStreamClient (StreamAgentStateUpdates):`);
    console.log(`  总事件数: ${newEvents.length}`);

    const updateEvents = newEvents.filter(e => e.type === 'update');
    const statusChanges = updateEvents.filter(e => e.status);
    const stepUpdates = updateEvents.filter(e => e.stepsUpdate);
    const metaUpdates = updateEvents.filter(e => e.metadataUpdate);
    const textFetches = updateEvents.filter(e => e.needsTextFetch);

    console.log(`  update 事件: ${updateEvents.length}`);
    console.log(`    - 含 status 变化: ${statusChanges.length}`);
    console.log(`    - 含 steps 更新: ${stepUpdates.length}`);
    console.log(`    - 含 metadata 更新: ${metaUpdates.length}`);
    console.log(`    - 需要拉文本 (needsTextFetch): ${textFetches.length}`);
    console.log(`  信息量: 直接可用的 step/status/metadata, 仅 ${textFetches.length} 次需要拉取文本`);

    console.log(`\n  拉取节省: 旧版 ${oldEvents.length} 次拉取 → 新版 ${textFetches.length} 次拉取 (减少 ${Math.round((1 - textFetches.length / Math.max(oldEvents.length, 1)) * 100)}%)`);

    // 清理
    oldClient.destroy();
    newClient.destroy();
    try {
        await grpcCall(ls.port, ls.csrf, 'DeleteCascadeTrajectory', { cascadeId });
        console.log(`\n[清理] 对话已删除`);
    } catch { }

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
