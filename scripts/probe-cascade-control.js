/**
 * probe-cascade-control.js — Cascade 对话控制 API E2E 验证
 *
 * 目标 LS: daemon (port=42100, csrf="daemon-with-ext-server")
 * 测试域: 对话控制 (约 11 个 API)
 *
 * 输出: docs/findings/260309-probe-cascade-control.md
 */

const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');
const path = require('path');

const PORT = 42100;
const CSRF = 'daemon-with-ext-server';
const TIMEOUT = 15000;

const results = [];

function record(apiName, variant, request, response, notes = '') {
    const entry = {
        api: apiName,
        variant,
        request,
        response: { status: response.status, data: response.data },
        success: response.status === 200,
        notes,
        timestamp: new Date().toISOString(),
    };
    results.push(entry);

    const icon = entry.success ? '[OK]' : '[FAIL]';
    const dataPreview = JSON.stringify(response.data || {}).slice(0, 200);
    console.log(`  ${icon} ${apiName} (${variant}): ${response.status} → ${dataPreview}`);

    return entry;
}

async function safeCall(method, body, timeout = TIMEOUT) {
    try {
        return await grpcCall(PORT, CSRF, method, body, timeout);
    } catch (err) {
        return { status: 'ERROR', data: { error: err.message } };
    }
}

async function waitForIdle(cascadeId, maxPoll = 20) {
    for (let i = 0; i < maxPoll; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const r = await safeCall('GetCascadeTrajectory', { cascadeId });
        if (r.status !== 200) continue;
        const status = r.data?.status || '';
        const steps = r.data?.trajectory?.steps || [];

        // Auto approve WAITING steps
        for (let j = 0; j < steps.length; j++) {
            if (steps[j].status === 'CORTEX_STEP_STATUS_WAITING') {
                await safeCall('HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction: { trajectoryId: cascadeId, stepIndex: j, runCommand: { confirm: true } }
                });
            }
        }

        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            return steps;
        }
    }
    return [];
}

async function runTests() {
    console.log('\n--- 准备: 创建会话 ---');
    const rStart = await safeCall('StartCascade', {});
    const cid = rStart.data?.cascadeId;
    if (!cid) throw new Error('StartCascade failed');
    console.log(`  CASCADE_ID = ${cid}`);

    // --- 1. SmartFocusConversation ---
    console.log('\n--- [1] SmartFocusConversation ---');
    const r1 = await safeCall('SmartFocusConversation', { cascadeId: cid });
    record('SmartFocusConversation', 'default', { cascadeId: cid }, r1);

    // --- 2. UpdateConversationAnnotations ---
    console.log('\n--- [2] UpdateConversationAnnotations ---');
    const r2 = await safeCall('UpdateConversationAnnotations', {
        cascadeId: cid,
        annotations: { summary: 'This is a test summary modified by script' },
        mergeAnnotations: true
    });
    record('UpdateConversationAnnotations', 'default', {
        cascadeId: cid, annotations: { summary: '...' }, mergeAnnotations: true
    }, r2);

    // 发送一条消息，以便产生历史用于后续 Revert 和 Acknowledge 测试
    console.log('\n--- 准备: 发送消息并等待完成 ---');
    const body = buildSendBody(cid, 'Please say hello and wait 1 second.');
    await safeCall('SendUserCascadeMessage', body);
    const completedSteps = await waitForIdle(cid);

    // --- 3. HandleCascadeUserInteraction (虽然之前测试过，这里显式测一次) ---
    console.log('\n--- [3] HandleCascadeUserInteraction ---');
    // We can simulate an interaction response even if not strictly needed
    const r3 = await safeCall('HandleCascadeUserInteraction', {
        cascadeId: cid,
        interaction: { trajectoryId: cid, stepIndex: 0, runCommand: { confirm: false } }
    });
    record('HandleCascadeUserInteraction', 'dummy_reject', { ...r3.request }, r3, 'Send dummy interaction');

    // --- 4. AcknowledgeCascadeCodeEdit ---
    console.log('\n--- [4] AcknowledgeCascadeCodeEdit ---');
    const r4 = await safeCall('AcknowledgeCascadeCodeEdit', {
        cascadeId: cid,
        absoluteUri: ['file:///home/tiemuer/antigravity-web/package.json'],
        accept: false
    });
    record('AcknowledgeCascadeCodeEdit', 'dummy_reject', { cascadeId: cid, accept: false }, r4);

    // --- 5. AcknowledgeCodeActionStep ---
    console.log('\n--- [5] AcknowledgeCodeActionStep ---');
    if (completedSteps.length > 0) {
        const r5 = await safeCall('AcknowledgeCodeActionStep', {
            cascadeId: cid,
            accept: true
        });
        record('AcknowledgeCodeActionStep', 'dummy_accept', { cascadeId: cid, accept: true }, r5);
    }

    // --- 6. RevertToCascadeStep ---
    console.log('\n--- [6] RevertToCascadeStep ---');
    // Try to revert to step 0
    const r6 = await safeCall('RevertToCascadeStep', {
        cascadeId: cid,
        stepIndex: 0
    });
    record('RevertToCascadeStep', 'default', { cascadeId: cid, stepIndex: 0 }, r6);

    // Wait slightly for revert to settle
    await new Promise(r => setTimeout(r, 1000));

    // --- 7. ResolveOutstandingSteps ---
    console.log('\n--- [7] ResolveOutstandingSteps ---');
    const r7 = await safeCall('ResolveOutstandingSteps', { cascadeId: cid });
    record('ResolveOutstandingSteps', 'default', { cascadeId: cid }, r7);

    // --- 8. 发送长时间运行的消息以测试 Cancel ---
    console.log('\n--- 准备: 发送长时消息测试 Cancel ---');
    const slowBody = buildSendBody(cid, 'Please write a very long story about exploring mars, take your time.', { ...DEFAULT_CONFIG, agenticMode: true });
    // We don't await the return deeply, just start it
    safeCall('SendUserCascadeMessage', slowBody);

    await new Promise(r => setTimeout(r, 1000)); // wait for it to start running

    // --- 9. CancelCascadeSteps ---
    console.log('\n--- [8] CancelCascadeSteps ---');
    const r8 = await safeCall('CancelCascadeSteps', {
        cascadeId: cid,
        stepIndices: [0] // try to cancel step 0, might not do anything if it's new step
    });
    record('CancelCascadeSteps', 'step_0', { cascadeId: cid, stepIndices: [0] }, r8);

    // --- 10. CancelCascadeInvocation ---
    console.log('\n--- [9] CancelCascadeInvocation ---');
    const r9 = await safeCall('CancelCascadeInvocation', { cascadeId: cid });
    record('CancelCascadeInvocation', 'default', { cascadeId: cid }, r9);

    await waitForIdle(cid, 5); // Should be idle quickly due to cancel

    // --- 11. Queued Messages (SendAll / Delete) ---
    console.log('\n--- [10/11] 队列控制 (SendAllQueuedMessages / DeleteQueuedUserInputStep) ---');
    // To get a queued message, maybe send when not idle or set something.
    // We will just blindly call them and see if they crash or return 200 {}.
    const r10 = await safeCall('SendAllQueuedMessages', { cascadeId: cid });
    record('SendAllQueuedMessages', 'default', { cascadeId: cid }, r10);

    const r11 = await safeCall('DeleteQueuedUserInputStep', { cascadeId: cid, stepIndex: 0 });
    record('DeleteQueuedUserInputStep', 'default', { cascadeId: cid, stepIndex: 0 }, r11);

    // Cleanup
    await safeCall('DeleteCascadeTrajectory', { cascadeId: cid });
}

function generateFindings() {
    const lines = [];
    lines.push('---');
    lines.push('title: Cascade 对话控制 API E2E 验证');
    lines.push('date: ' + new Date().toISOString().slice(0, 10));
    lines.push('target: daemon LS v1.19.6 (port=42100)');
    lines.push('---');
    lines.push('');
    lines.push('# Cascade 对话控制 API E2E 验证结果');
    lines.push('');

    lines.push('## 汇总\n');
    lines.push('| # | API | Variant | Status | Notes |');
    lines.push('|---|-----|---------|--------|-------|');
    results.forEach((r, i) => {
        lines.push(`| ${i + 1} | \`${r.api}\` | ${r.variant} | ${r.success ? 'OK' : 'FAIL'} | ${r.notes} |`);
    });
    lines.push('');

    lines.push('## 详细记录\n');
    let currentApi = '';
    for (const r of results) {
        if (r.api !== currentApi) {
            currentApi = r.api;
            lines.push(`### ${r.api}\n`);
        }
        lines.push(`#### ${r.variant}\n`);
        lines.push('**请求:**\n```json\n' + JSON.stringify(r.request, null, 2) + '\n```\n');
        lines.push('**响应 (status=' + r.response.status + '):**\n```json\n' + JSON.stringify(r.response.data, null, 2) + '\n```\n');
    }

    return lines.join('\n');
}

(async () => {
    console.log('--- Cascade Conversation Control API E2E ---');
    try {
        await runTests();
    } catch (e) {
        console.error('FATAL', e);
    }

    const findingsStr = generateFindings();
    const findingsPath = path.join(__dirname, '..', 'docs', 'findings', '260309-probe-cascade-control.md');
    fs.writeFileSync(findingsPath, findingsStr, 'utf-8');
    console.log(`\nFindings 已保存: ${findingsPath}`);

    console.log('=== Done ===');
})();
