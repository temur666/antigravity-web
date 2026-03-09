/**
 * probe-revert.js — Revert 链路完整 E2E 测试
 *
 * 测试目标:
 *   1. RevertToCascadeStep 的正确调用方式 (需要 override_config.requested_model)
 *   2. GetRevertPreview 预览回退会影响哪些文件
 *   3. 回退后 trajectory 的 step 数量是否缩减
 *   4. 回退是否强制撤销文件 (还是可选?)
 *
 * 流程:
 *   StartCascade → SendMessage (创建文件) → 等待完成
 *   → 记录 steps/文件状态
 *   → GetRevertPreview
 *   → RevertToCascadeStep
 *   → 再次获取 trajectory 对比
 *   → 检查文件是否被删除
 *
 * 输出: docs/findings/260309-probe-revert.md
 */

const { grpcCall, discoverLSAsync } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');
const path = require('path');

const TIMEOUT = 30000;
const POLL_INTERVAL = 2000;
const MAX_POLLS = 30;

// 回退测试使用的临时文件路径
const TEST_FILE = '/home/tiemuer/antigravity-web/revert-test-probe.txt';

let PORT, CSRF;
const log = [];

function L(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log(line);
    log.push(line);
}

async function call(method, body) {
    try {
        const r = await grpcCall(PORT, CSRF, method, body, TIMEOUT);
        return r;
    } catch (err) {
        return { status: 'ERROR', data: { error: err.message } };
    }
}

/**
 * 等待对话变 IDLE，自动处理 WAITING steps
 */
async function waitForIdle(cascadeId) {
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const r = await call('GetCascadeTrajectory', { cascadeId });
        if (r.status !== 200) continue;

        const status = r.data?.status || '';
        const steps = r.data?.trajectory?.steps || [];

        // 自动 approve WAITING steps
        for (let j = 0; j < steps.length; j++) {
            if (steps[j].status === 'CORTEX_STEP_STATUS_WAITING') {
                L(`  Auto-approving waiting step[${j}]: ${steps[j].type}`);
                await call('HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction: { trajectoryId: cascadeId, stepIndex: j, runCommand: { confirm: true } }
                });
            }
        }

        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            L(`  IDLE reached after ${i + 1} polls, ${steps.length} steps`);
            return { steps, status, raw: r.data };
        }

        L(`  Poll ${i + 1}: status=${status}, steps=${steps.length}`);
    }
    L('  WARNING: Max polls reached, not IDLE');
    return { steps: [], status: 'TIMEOUT', raw: null };
}

/**
 * 获取 trajectory 的 step 摘要 (类型 + 状态)
 */
function summarizeSteps(steps) {
    return steps.map((s, i) => ({
        index: i,
        type: (s.type || '').replace('CORTEX_STEP_TYPE_', ''),
        status: (s.status || '').replace('CORTEX_STEP_STATUS_', ''),
    }));
}

/**
 * 找出所有 USER_INPUT 类型 step 的 index
 */
function findUserInputIndices(steps) {
    return steps
        .map((s, i) => ({ index: i, type: s.type }))
        .filter(s => s.type === 'CORTEX_STEP_TYPE_USER_INPUT')
        .map(s => s.index);
}

// ========== 主测试 ==========

async function runTests() {
    // --- 发现 LS ---
    L('=== Discovering LS ===');
    const ls = await discoverLSAsync();
    if (!ls) throw new Error('LS not found');
    PORT = ls.port;
    CSRF = ls.csrf;
    L(`LS found: port=${PORT}, pid=${ls.pid}`);

    // --- 1. 创建对话 ---
    L('\n=== Step 1: StartCascade ===');
    const rStart = await call('StartCascade', {});
    const cid = rStart.data?.cascadeId;
    if (!cid) throw new Error('StartCascade failed: ' + JSON.stringify(rStart.data));
    L(`cascadeId = ${cid}`);

    // --- 2. 发送消息: 让 AI 创建一个文件 ---
    L('\n=== Step 2: Send message (create file) ===');
    const config = { ...DEFAULT_CONFIG, agenticMode: true };
    const body = buildSendBody(
        cid,
        `Create a file at ${TEST_FILE} with the content "Hello from revert test - ${Date.now()}". Just create the file and nothing else.`,
        config
    );
    const rSend = await call('SendUserCascadeMessage', body);
    L(`SendUserCascadeMessage: status=${rSend.status}, queued=${rSend.data?.queued}`);

    // --- 3. 等待完成 ---
    L('\n=== Step 3: Wait for IDLE ===');
    const result1 = await waitForIdle(cid);
    const stepsBeforeRevert = result1.steps;
    const stepSummaryBefore = summarizeSteps(stepsBeforeRevert);
    const userInputIndices = findUserInputIndices(stepsBeforeRevert);
    L(`Steps before revert: ${stepsBeforeRevert.length}`);
    L(`USER_INPUT indices: [${userInputIndices.join(', ')}]`);
    L(`Step summary: ${JSON.stringify(stepSummaryBefore, null, 2)}`);

    // 检查测试文件是否存在
    const fileExistsBefore = fs.existsSync(TEST_FILE);
    L(`File exists before revert: ${fileExistsBefore}`);

    if (stepsBeforeRevert.length < 2) {
        L('ERROR: Not enough steps for revert test');
        await call('DeleteCascadeTrajectory', { cascadeId: cid });
        return;
    }

    // --- 4. GetRevertPreview ---
    L('\n=== Step 4: GetRevertPreview ===');
    // 回退到 step 0 (第一个 USER_INPUT), 即撤销所有 AI 操作
    const revertTargetIndex = 0;
    L(`Revert target: step[${revertTargetIndex}]`);

    const rPreview = await call('GetRevertPreview', {
        cascadeId: cid,
        stepIndex: revertTargetIndex,
        metadata: {
            ideName: 'antigravity',
            apiKey: '',
            locale: 'zh',
        },
        overrideConfig: {
            plannerConfig: {
                requestedModel: { model: config.model },
            },
        },
    });
    L(`GetRevertPreview: status=${rPreview.status}`);
    L(`GetRevertPreview response: ${JSON.stringify(rPreview.data, null, 2)}`);

    // --- 5. RevertToCascadeStep (主测试) ---
    L('\n=== Step 5: RevertToCascadeStep ===');

    // 测试 5a: 不带 model (复现之前的错误)
    L('\n--- 5a: Without model (expect failure) ---');
    const r5a = await call('RevertToCascadeStep', {
        cascadeId: cid,
        stepIndex: revertTargetIndex,
    });
    L(`5a status=${r5a.status}, data=${JSON.stringify(r5a.data)}`);

    // 测试 5b: 带 override_config.requested_model
    L('\n--- 5b: With override_config.requested_model ---');
    const r5b = await call('RevertToCascadeStep', {
        cascadeId: cid,
        stepIndex: revertTargetIndex,
        metadata: {
            ideName: 'antigravity',
            apiKey: '',
            locale: 'zh',
        },
        experimentConfig: {},
        overrideConfig: {
            plannerConfig: {
                requestedModel: { model: config.model },
            },
        },
    });
    L(`5b status=${r5b.status}`);
    L(`5b response: ${JSON.stringify(r5b.data, null, 2)}`);

    // --- 6. 等待回退完成并检查 ---
    L('\n=== Step 6: Post-revert check ===');
    await new Promise(r => setTimeout(r, 3000));

    const rAfter = await call('GetCascadeTrajectory', { cascadeId: cid });
    const stepsAfterRevert = rAfter.data?.trajectory?.steps || [];
    const stepSummaryAfter = summarizeSteps(stepsAfterRevert);
    L(`Steps after revert: ${stepsAfterRevert.length} (was ${stepsBeforeRevert.length})`);
    L(`Step summary after: ${JSON.stringify(stepSummaryAfter, null, 2)}`);

    // 检查文件是否被撤销
    const fileExistsAfter = fs.existsSync(TEST_FILE);
    L(`File exists after revert: ${fileExistsAfter}`);
    L(`File was reverted: ${fileExistsBefore && !fileExistsAfter ? 'YES (deleted)' : 'NO (still exists)'}`);

    // --- 7. 额外测试: 发送第二条消息后, 回退到第一条消息 ---
    L('\n=== Step 7: Two-message revert test ===');

    // 先发第一条
    const body2a = buildSendBody(
        cid,
        `Create a file at ${TEST_FILE} with content "Message 1 - ${Date.now()}"`,
        config
    );
    await call('SendUserCascadeMessage', body2a);
    const r7a = await waitForIdle(cid);
    L(`After msg 1: ${r7a.steps.length} steps`);
    const userInputs7a = findUserInputIndices(r7a.steps);
    L(`USER_INPUT indices after msg 1: [${userInputs7a.join(', ')}]`);

    // 再发第二条
    const body2b = buildSendBody(
        cid,
        `Now append " + Message 2" to the file ${TEST_FILE}`,
        config
    );
    await call('SendUserCascadeMessage', body2b);
    const r7b = await waitForIdle(cid);
    L(`After msg 2: ${r7b.steps.length} steps`);
    const userInputs7b = findUserInputIndices(r7b.steps);
    L(`USER_INPUT indices after msg 2: [${userInputs7b.join(', ')}]`);

    const fileContentBefore7 = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(not found)';
    L(`File content before step-7 revert: ${fileContentBefore7}`);

    // 回退到第二个 USER_INPUT (即撤销第二条消息的效果)
    if (userInputs7b.length >= 2) {
        const revertTarget7 = userInputs7b[userInputs7b.length - 1]; // 最后一个 USER_INPUT
        L(`Revert target: step[${revertTarget7}] (last USER_INPUT = msg 2)`);

        const rPreview7 = await call('GetRevertPreview', {
            cascadeId: cid,
            stepIndex: revertTarget7,
            metadata: { ideName: 'antigravity', apiKey: '', locale: 'zh' },
            overrideConfig: {
                plannerConfig: { requestedModel: { model: config.model } },
            },
        });
        L(`GetRevertPreview for step[${revertTarget7}]: status=${rPreview7.status}`);
        L(`Preview: ${JSON.stringify(rPreview7.data, null, 2)}`);

        const rRevert7 = await call('RevertToCascadeStep', {
            cascadeId: cid,
            stepIndex: revertTarget7,
            metadata: { ideName: 'antigravity', apiKey: '', locale: 'zh' },
            overrideConfig: {
                plannerConfig: { requestedModel: { model: config.model } },
            },
        });
        L(`RevertToCascadeStep for step[${revertTarget7}]: status=${rRevert7.status}`);
        L(`Response: ${JSON.stringify(rRevert7.data, null, 2)}`);

        await new Promise(r => setTimeout(r, 3000));

        const rAfter7 = await call('GetCascadeTrajectory', { cascadeId: cid });
        const stepsAfter7 = rAfter7.data?.trajectory?.steps || [];
        L(`Steps after step-7 revert: ${stepsAfter7.length} (was ${r7b.steps.length})`);

        const fileContentAfter7 = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(not found)';
        L(`File content after step-7 revert: ${fileContentAfter7}`);
        L(`Content changed: ${fileContentBefore7 !== fileContentAfter7 ? 'YES' : 'NO'}`);
    } else {
        L('Not enough USER_INPUT steps for two-message revert test');
    }

    // --- Cleanup ---
    L('\n=== Cleanup ===');
    await call('DeleteCascadeTrajectory', { cascadeId: cid });
    if (fs.existsSync(TEST_FILE)) {
        fs.unlinkSync(TEST_FILE);
        L('Cleaned up test file');
    }
    L('Deleted trajectory');
}

// ========== Findings 生成 ==========

function generateFindings() {
    const lines = [];
    lines.push('---');
    lines.push('title: Revert 链路 E2E 测试');
    lines.push('date: ' + new Date().toISOString().slice(0, 10));
    lines.push('target: daemon LS (auto-discovered)');
    lines.push('---');
    lines.push('');
    lines.push('# Revert 链路 E2E 测试结果');
    lines.push('');
    lines.push('## 测试目标');
    lines.push('');
    lines.push('1. `RevertToCascadeStep` 正确调用方式');
    lines.push('2. `GetRevertPreview` 预览回退影响');
    lines.push('3. 回退后 trajectory step 变化');
    lines.push('4. 回退是否强制撤销文件改动');
    lines.push('');
    lines.push('## 完整日志');
    lines.push('');
    lines.push('```');
    lines.push(log.join('\n'));
    lines.push('```');
    return lines.join('\n');
}

// ========== Entry ==========

(async () => {
    console.log('=== Revert E2E Test ===\n');
    try {
        await runTests();
    } catch (e) {
        L(`FATAL: ${e.message}`);
        console.error(e);
    }

    const findings = generateFindings();
    const findingsPath = path.join(__dirname, '..', 'docs', 'findings', '260309-probe-revert.md');
    fs.writeFileSync(findingsPath, findings, 'utf-8');
    console.log(`\nFindings saved: ${findingsPath}`);
    console.log('=== Done ===');
})();
