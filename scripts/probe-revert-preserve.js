/**
 * probe-revert-preserve.js — 测试 "移走文件 → Revert → 移回" 方案
 *
 * 验证: 回退 trajectory 但保留文件改动的 workaround
 *
 * 流程:
 *   1. StartCascade → 让 AI 创建文件 → 等 IDLE
 *   2. GetRevertPreview → 获取回退影响的文件列表
 *   3. 把文件移走 (rename)
 *   4. RevertToCascadeStep → 执行回退
 *   5. 把文件移回来
 *   6. 验证: trajectory 缩减了, 但文件内容保留
 *
 * 额外测试:
 *   - 已修改的文件 (不是新建的) 也能用这个方案吗?
 *   - 回退后给 LS 发新消息, 文件状态是否会导致冲突?
 *
 * 输出: docs/findings/260309-probe-revert-preserve.md
 */

const { grpcCall, discoverLSAsync } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');
const path = require('path');

const TIMEOUT = 30000;
const POLL_INTERVAL = 2000;
const MAX_POLLS = 30;

const TEST_FILE = '/home/tiemuer/antigravity-web/revert-preserve-test.txt';
const BACKUP_DIR = '/home/tiemuer/antigravity-web/.revert-backup';

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
        return await grpcCall(PORT, CSRF, method, body, TIMEOUT);
    } catch (err) {
        return { status: 'ERROR', data: { error: err.message } };
    }
}

async function waitForIdle(cascadeId) {
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const r = await call('GetCascadeTrajectory', { cascadeId });
        if (r.status !== 200) continue;

        const status = r.data?.status || '';
        const steps = r.data?.trajectory?.steps || [];

        for (let j = 0; j < steps.length; j++) {
            if (steps[j].status === 'CORTEX_STEP_STATUS_WAITING') {
                L(`  Auto-approving step[${j}]`);
                await call('HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction: { trajectoryId: cascadeId, stepIndex: j, runCommand: { confirm: true } }
                });
            }
        }

        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            L(`  IDLE: ${steps.length} steps`);
            return { steps, status };
        }
        L(`  Poll ${i + 1}: ${status}, ${steps.length} steps`);
    }
    L('  TIMEOUT');
    return { steps: [], status: 'TIMEOUT' };
}

function findUserInputIndices(steps) {
    return steps
        .map((s, i) => ({ index: i, type: s.type }))
        .filter(s => s.type === 'CORTEX_STEP_TYPE_USER_INPUT')
        .map(s => s.index);
}

const config = { ...DEFAULT_CONFIG, agenticMode: true };
const overrideConfig = {
    plannerConfig: { requestedModel: { model: config.model } },
};
const metadata = { ideName: 'antigravity', apiKey: '', locale: 'zh' };

/**
 * 把文件移走到备份目录
 */
function moveFilesAway(uris) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const moved = [];
    for (const uri of uris) {
        const filePath = uri.replace('file://', '');
        if (fs.existsSync(filePath)) {
            const backupPath = path.join(BACKUP_DIR, path.basename(filePath));
            fs.renameSync(filePath, backupPath);
            moved.push({ original: filePath, backup: backupPath });
            L(`  Moved: ${filePath} → ${backupPath}`);
        } else {
            L(`  Skip (not found): ${filePath}`);
        }
    }
    return moved;
}

/**
 * 把文件移回来
 */
function moveFilesBack(moved) {
    for (const { original, backup } of moved) {
        if (fs.existsSync(backup)) {
            // 如果 revert 创建了新文件(空的或恢复的), 先删掉
            if (fs.existsSync(original)) {
                fs.unlinkSync(original);
            }
            fs.renameSync(backup, original);
            L(`  Restored: ${backup} → ${original}`);
        }
    }
}

async function runTests() {
    L('=== Discovering LS ===');
    const ls = await discoverLSAsync();
    if (!ls) throw new Error('LS not found');
    PORT = ls.port;
    CSRF = ls.csrf;
    L(`LS: port=${PORT}`);

    // =====================================================
    // 测试 A: 新建文件场景 -- 移走后 revert, 文件是否保留
    // =====================================================

    L('\n========== Test A: New file + move-away revert ==========');

    const rStart = await call('StartCascade', {});
    const cid = rStart.data?.cascadeId;
    if (!cid) throw new Error('StartCascade failed');
    L(`cascadeId = ${cid}`);

    // 让 AI 创建文件
    L('\n--- A1: Send message to create file ---');
    const bodyA = buildSendBody(cid,
        `Create a file at ${TEST_FILE} with content "preserved content - ${Date.now()}". Just create the file, no explanation needed.`,
        config
    );
    await call('SendUserCascadeMessage', bodyA);
    const rA1 = await waitForIdle(cid);
    L(`Steps: ${rA1.steps.length}`);

    const fileContentBeforeA = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(NOT FOUND)';
    L(`File content before: ${fileContentBeforeA.trim()}`);

    // GetRevertPreview
    L('\n--- A2: GetRevertPreview ---');
    const rPreviewA = await call('GetRevertPreview', {
        cascadeId: cid, stepIndex: 0, metadata, overrideConfig,
    });
    L(`Preview status: ${rPreviewA.status}`);
    const previewsA = rPreviewA.data?.codeEditPreviews || [];
    const affectedUrisA = previewsA.map(p => p.fileUri);
    L(`Affected files: ${JSON.stringify(affectedUrisA)}`);
    L(`Action types: ${previewsA.map(p => p.actionType).join(', ')}`);

    // 移走文件
    L('\n--- A3: Move files away ---');
    const movedA = moveFilesAway(affectedUrisA);
    L(`File exists at original path: ${fs.existsSync(TEST_FILE)}`);

    // 执行回退
    L('\n--- A4: RevertToCascadeStep ---');
    const rRevertA = await call('RevertToCascadeStep', {
        cascadeId: cid, stepIndex: 0, metadata, overrideConfig,
    });
    L(`Revert status: ${rRevertA.status}`);
    L(`Revert response: ${JSON.stringify(rRevertA.data)}`);

    await new Promise(r => setTimeout(r, 2000));

    // 检查回退后 trajectory
    const rAfterA = await call('GetCascadeTrajectory', { cascadeId: cid });
    const stepsAfterA = rAfterA.data?.trajectory?.steps || [];
    L(`Steps after revert: ${stepsAfterA.length} (was ${rA1.steps.length})`);

    // 检查文件是否被 LS 重新创建/删除
    L(`File at original path after revert (before restore): ${fs.existsSync(TEST_FILE)}`);

    // 移回文件
    L('\n--- A5: Move files back ---');
    moveFilesBack(movedA);
    const fileContentAfterA = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(NOT FOUND)';
    L(`File content after restore: ${fileContentAfterA.trim()}`);
    L(`Content preserved: ${fileContentBeforeA === fileContentAfterA ? 'YES' : 'NO'}`);

    // 验证: 回退后发新消息是否正常
    L('\n--- A6: Post-revert: send new message ---');
    const bodyA6 = buildSendBody(cid,
        `Read the file ${TEST_FILE} and tell me its content. If it does not exist, say "FILE NOT FOUND".`,
        config
    );
    await call('SendUserCascadeMessage', bodyA6);
    const rA6 = await waitForIdle(cid);
    L(`Post-revert steps: ${rA6.steps.length}`);

    // 看看 AI 是否能读到保留的文件
    const plannerSteps = rA6.steps.filter(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
    if (plannerSteps.length > 0) {
        const lastPlanner = plannerSteps[plannerSteps.length - 1];
        const responseText = lastPlanner.plannerResponse?.responseText || lastPlanner.plannerResponse?.text || '(empty)';
        L(`AI response (truncated): ${responseText.slice(0, 200)}`);
    }

    // =====================================================
    // 测试 B: 修改文件场景 (不是新建)
    // =====================================================

    L('\n========== Test B: Modify file + move-away revert ==========');

    // 先清理 A 的对话
    await call('DeleteCascadeTrajectory', { cascadeId: cid });

    const rStartB = await call('StartCascade', {});
    const cidB = rStartB.data?.cascadeId;
    L(`cascadeId = ${cidB}`);

    // 预先创建文件
    fs.writeFileSync(TEST_FILE, 'original line 1\noriginal line 2\n');
    L(`Pre-created file: ${TEST_FILE}`);

    // 让 AI 修改文件 (不是新建)
    L('\n--- B1: Send message to modify file ---');
    const bodyB = buildSendBody(cidB,
        `The file ${TEST_FILE} already exists. Append a new line "added by AI" to it.`,
        config
    );
    await call('SendUserCascadeMessage', bodyB);
    const rB1 = await waitForIdle(cidB);
    L(`Steps: ${rB1.steps.length}`);

    const fileContentBeforeB = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(NOT FOUND)';
    L(`File content before revert: ${fileContentBeforeB.trim()}`);

    // GetRevertPreview
    L('\n--- B2: GetRevertPreview ---');
    const rPreviewB = await call('GetRevertPreview', {
        cascadeId: cidB, stepIndex: 0, metadata, overrideConfig,
    });
    L(`Preview status: ${rPreviewB.status}`);
    const previewsB = rPreviewB.data?.codeEditPreviews || [];
    const affectedUrisB = previewsB.map(p => p.fileUri);
    L(`Affected files: ${JSON.stringify(affectedUrisB)}`);
    L(`Action types: ${previewsB.map(p => p.actionType).join(', ')}`);
    L(`Preview details: ${JSON.stringify(rPreviewB.data, null, 2)}`);

    // 移走文件
    L('\n--- B3: Move files away ---');
    const movedB = moveFilesAway(affectedUrisB);

    // 执行回退
    L('\n--- B4: RevertToCascadeStep ---');
    const rRevertB = await call('RevertToCascadeStep', {
        cascadeId: cidB, stepIndex: 0, metadata, overrideConfig,
    });
    L(`Revert status: ${rRevertB.status}`);
    L(`Revert response: ${JSON.stringify(rRevertB.data)}`);

    await new Promise(r => setTimeout(r, 2000));

    // 检查
    const rAfterB = await call('GetCascadeTrajectory', { cascadeId: cidB });
    const stepsAfterB = rAfterB.data?.trajectory?.steps || [];
    L(`Steps after revert: ${stepsAfterB.length} (was ${rB1.steps.length})`);
    L(`File at original path after revert (before restore): ${fs.existsSync(TEST_FILE)}`);

    // 移回文件
    L('\n--- B5: Move files back ---');
    moveFilesBack(movedB);
    const fileContentAfterB = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf-8') : '(NOT FOUND)';
    L(`File content after restore: ${fileContentAfterB.trim()}`);
    L(`Content preserved (with AI modification): ${fileContentBeforeB === fileContentAfterB ? 'YES' : 'NO'}`);

    // =====================================================
    // Cleanup
    // =====================================================

    L('\n=== Cleanup ===');
    await call('DeleteCascadeTrajectory', { cascadeId: cidB });
    if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
    if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true });
    L('Done');
}

function generateFindings() {
    const lines = [];
    lines.push('---');
    lines.push('title: Revert Preserve (移走文件方案) E2E 测试');
    lines.push('date: ' + new Date().toISOString().slice(0, 10));
    lines.push('target: daemon LS (auto-discovered)');
    lines.push('---');
    lines.push('');
    lines.push('# Revert Preserve 方案 E2E 测试');
    lines.push('');
    lines.push('## 核心假设');
    lines.push('');
    lines.push('如果在 `RevertToCascadeStep` 调用前把目标文件移走,');
    lines.push('LS 找不到文件就跳过文件撤销, 但 trajectory 仍然被裁剪。');
    lines.push('回退后再把文件移回来, 实现 "只回退对话, 不回退文件"。');
    lines.push('');
    lines.push('## 测试场景');
    lines.push('');
    lines.push('- **Test A**: 新建文件 → 移走 → Revert → 移回');
    lines.push('- **Test B**: 修改已有文件 → 移走 → Revert → 移回');
    lines.push('');
    lines.push('## 完整日志');
    lines.push('');
    lines.push('```');
    lines.push(log.join('\n'));
    lines.push('```');
    return lines.join('\n');
}

(async () => {
    console.log('=== Revert Preserve E2E Test ===\n');
    try {
        await runTests();
    } catch (e) {
        L(`FATAL: ${e.message}`);
        console.error(e);
    }

    const findings = generateFindings();
    const findingsPath = path.join(__dirname, '..', 'docs', 'findings', '260309-probe-revert-preserve.md');
    fs.writeFileSync(findingsPath, findings, 'utf-8');
    console.log(`\nFindings saved: ${findingsPath}`);
    console.log('=== Done ===');
})();
