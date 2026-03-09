/**
 * probe-revert-edge-cases.js — Revert 保留文件方案: 边缘情况 + 鲁棒性测试
 *
 * 测试目标:
 *   1. Revert API 失败后的回滚 (try/finally)
 *   2. 文件被外部删除/不存在时的处理
 *   3. 多文件场景 (部分存在, 部分不存在)
 *   4. 空文件 / 二进制文件
 *   5. 完整的 "安全回退" 函数 (safeRevertPreservingFiles) 原型
 *
 * 输出: docs/findings/260309-probe-revert-edge-cases.md
 */

const { grpcCall, discoverLSAsync } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');
const path = require('path');

const TIMEOUT = 30000;
const POLL_INTERVAL = 2000;
const MAX_POLLS = 30;

const TEST_DIR = '/home/tiemuer/antigravity-web/revert-edge-test';

let PORT, CSRF;
const log = [];
const testResults = [];

function L(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log(line);
    log.push(line);
}

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    L(`  ${passed ? 'PASS' : 'FAIL'}: ${name}${details ? ' -- ' + details : ''}`);
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
                await call('HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction: { trajectoryId: cascadeId, stepIndex: j, runCommand: { confirm: true } }
                });
            }
        }
        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            return { steps, status };
        }
    }
    return { steps: [], status: 'TIMEOUT' };
}

const agenticConfig = { ...DEFAULT_CONFIG, agenticMode: true };
const overrideConfig = {
    plannerConfig: { requestedModel: { model: agenticConfig.model } },
};
const metadata = { ideName: 'antigravity', apiKey: '', locale: 'zh' };

// =================================================================
// 核心: safeRevertPreservingFiles -- 带完整错误处理的安全回退函数
// =================================================================

/**
 * 安全回退: 保留文件改动, 只回退 trajectory
 *
 * 流程:
 *   1. GetRevertPreview → 获取受影响的文件 URI 列表
 *   2. 读取所有文件内容到内存 (Buffer), 跳过不存在的
 *   3. 删除文件 (让 LS 找不到)
 *   4. RevertToCascadeStep
 *   5. 写回文件内容
 *
 * 错误处理:
 *   - 步骤 2 失败: 直接返回错误, 不执行回退
 *   - 步骤 3 失败: 回滚已删除的文件, 返回错误
 *   - 步骤 4 失败 (Revert API 错误): 立即写回所有已删除的文件
 *   - 步骤 5 失败: 记录哪些文件写回失败 (数据仍在内存中)
 *
 * @param {string} cascadeId
 * @param {number} stepIndex
 * @param {boolean} preserveFiles - true=保留文件, false=正常回退(撤销文件)
 * @returns {{ success, stepsBeforeRevert, stepsAfterRevert, revertedUris, preservedFiles, errors }}
 */
async function safeRevertPreservingFiles(cascadeId, stepIndex, preserveFiles = true) {
    const result = {
        success: false,
        preserveFiles,
        stepsBeforeRevert: 0,
        stepsAfterRevert: 0,
        revertedUris: [],
        preservedFiles: [],
        errors: [],
    };

    // 1. 获取当前 trajectory 状态
    const rTraj = await call('GetCascadeTrajectory', { cascadeId });
    if (rTraj.status !== 200) {
        result.errors.push(`GetCascadeTrajectory failed: ${rTraj.status}`);
        return result;
    }
    result.stepsBeforeRevert = (rTraj.data?.trajectory?.steps || []).length;

    // 2. 如果不需要保留文件, 直接回退
    if (!preserveFiles) {
        const rRevert = await call('RevertToCascadeStep', {
            cascadeId, stepIndex, metadata, overrideConfig,
        });
        if (rRevert.status !== 200) {
            result.errors.push(`RevertToCascadeStep failed: ${rRevert.status} - ${JSON.stringify(rRevert.data)}`);
            return result;
        }
        result.success = true;
        result.revertedUris = rRevert.data?.metadata?.revertedUris || [];
        return result;
    }

    // 3. GetRevertPreview → 获取受影响的文件
    const rPreview = await call('GetRevertPreview', {
        cascadeId, stepIndex, metadata, overrideConfig,
    });
    if (rPreview.status !== 200) {
        result.errors.push(`GetRevertPreview failed: ${rPreview.status} - ${JSON.stringify(rPreview.data)}`);
        return result;
    }

    const previews = rPreview.data?.codeEditPreviews || [];
    const affectedUris = previews.map(p => p.fileUri);
    L(`  Affected URIs: ${JSON.stringify(affectedUris)}`);

    // 4. 读取文件内容到内存
    const fileBackups = []; // { uri, filePath, content: Buffer|null, existed: bool }

    for (const uri of affectedUris) {
        const filePath = uri.replace('file://', '');
        const entry = { uri, filePath, content: null, existed: false, deleted: false };

        try {
            if (fs.existsSync(filePath)) {
                entry.content = fs.readFileSync(filePath); // Buffer, 支持二进制
                entry.existed = true;
                L(`  Backed up: ${filePath} (${entry.content.length} bytes)`);
            } else {
                L(`  Skip (not found): ${filePath}`);
            }
        } catch (err) {
            L(`  Read error: ${filePath} - ${err.message}`);
            result.errors.push(`Read failed: ${filePath} - ${err.message}`);
            // 读取失败不中断, 继续处理其他文件
        }

        fileBackups.push(entry);
    }

    // 5. 删除存在的文件
    for (const entry of fileBackups) {
        if (entry.existed && entry.content !== null) {
            try {
                fs.unlinkSync(entry.filePath);
                entry.deleted = true;
                L(`  Deleted: ${entry.filePath}`);
            } catch (err) {
                L(`  Delete failed: ${entry.filePath} - ${err.message}`);
                result.errors.push(`Delete failed: ${entry.filePath} - ${err.message}`);
            }
        }
    }

    // 6. 执行 Revert (try/finally 确保文件恢复)
    let revertSuccess = false;
    try {
        const rRevert = await call('RevertToCascadeStep', {
            cascadeId, stepIndex, metadata, overrideConfig,
        });

        if (rRevert.status === 200) {
            revertSuccess = true;
            result.revertedUris = rRevert.data?.metadata?.revertedUris || [];
            L(`  Revert OK, revertedUris: ${JSON.stringify(result.revertedUris)}`);
        } else {
            result.errors.push(`RevertToCascadeStep failed: ${rRevert.status} - ${JSON.stringify(rRevert.data)}`);
            L(`  Revert FAILED: ${rRevert.status}`);
        }
    } catch (err) {
        result.errors.push(`RevertToCascadeStep threw: ${err.message}`);
        L(`  Revert EXCEPTION: ${err.message}`);
    }

    // 7. 写回文件 (无论 Revert 成功与否, 都要恢复文件!)
    // 等一小段时间让 LS 完成文件操作
    await new Promise(r => setTimeout(r, 1000));

    for (const entry of fileBackups) {
        if (entry.deleted && entry.content !== null) {
            try {
                // 确保目录存在
                const dir = path.dirname(entry.filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                // 如果 LS revert 在原位创建了文件 (恢复旧版本), 先检查
                if (fs.existsSync(entry.filePath)) {
                    L(`  LS recreated file, overwriting: ${entry.filePath}`);
                }
                fs.writeFileSync(entry.filePath, entry.content);
                result.preservedFiles.push(entry.filePath);
                L(`  Restored: ${entry.filePath} (${entry.content.length} bytes)`);
            } catch (err) {
                result.errors.push(`Write-back failed: ${entry.filePath} - ${err.message}`);
                L(`  CRITICAL: Write-back failed: ${entry.filePath} - ${err.message}`);
                L(`    Data still in memory, ${entry.content.length} bytes`);
            }
        }
    }

    // 8. 获取回退后的 trajectory 状态
    await new Promise(r => setTimeout(r, 1000));
    const rAfter = await call('GetCascadeTrajectory', { cascadeId });
    result.stepsAfterRevert = (rAfter.data?.trajectory?.steps || []).length;

    result.success = revertSuccess && result.errors.length === 0;
    return result;
}

// =================================================================
// 测试用例
// =================================================================

async function runTests() {
    L('=== Discovering LS ===');
    const ls = await discoverLSAsync();
    if (!ls) throw new Error('LS not found');
    PORT = ls.port;
    CSRF = ls.csrf;
    L(`LS: port=${PORT}`);

    // 创建测试目录
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

    // =========================================================
    // Test 1: 正常场景 -- 新建文件, 保留文件回退
    // =========================================================

    L('\n========== Test 1: Normal -- preserve new file ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const testFile = path.join(TEST_DIR, 'test1.txt');
        const body = buildSendBody(cid,
            `Create a file at ${testFile} with content "test1 content ${Date.now()}". Just create it.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        const contentBefore = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf-8') : null;
        L(`File before: ${contentBefore ? contentBefore.trim() : 'NOT FOUND'}`);

        const result = await safeRevertPreservingFiles(cid, 0, true);
        L(`Result: ${JSON.stringify({ ...result, preservedFiles: result.preservedFiles.length })}`);

        const contentAfter = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf-8') : null;

        recordTest('Normal preserve',
            result.success && contentBefore === contentAfter && result.stepsAfterRevert === 1,
            `steps: ${result.stepsBeforeRevert}→${result.stepsAfterRevert}, content preserved: ${contentBefore === contentAfter}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Test 2: 文件已被外部删除
    // =========================================================

    L('\n========== Test 2: File externally deleted ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const testFile = path.join(TEST_DIR, 'test2.txt');
        const body = buildSendBody(cid,
            `Create a file at ${testFile} with content "test2 content". Just create it.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        // 手动删除文件
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
            L('Manually deleted file before revert');
        }

        const result = await safeRevertPreservingFiles(cid, 0, true);
        L(`Result: ${JSON.stringify(result)}`);

        // 文件已不存在, safeRevert 应该跳过备份/恢复, 但 revert 仍成功
        recordTest('File externally deleted',
            result.stepsAfterRevert === 1,
            `steps: ${result.stepsBeforeRevert}→${result.stepsAfterRevert}, errors: ${result.errors.length}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Test 3: Revert API 失败时的回滚
    // =========================================================

    L('\n========== Test 3: Revert API failure recovery ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const testFile = path.join(TEST_DIR, 'test3.txt');
        const body = buildSendBody(cid,
            `Create a file at ${testFile} with content "test3 should survive". Just create it.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        const contentBefore = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf-8') : null;

        // 模拟 Revert 失败: 使用不存在的 cascadeId
        // (不能真正让 safeRevert 失败因为它内部硬编码了, 但我们可以测试极端 stepIndex)
        const result = await safeRevertPreservingFiles(cid, 99999, true);
        L(`Result (expect failure): success=${result.success}, errors=${JSON.stringify(result.errors)}`);

        // 文件应该被恢复 (即使 revert 失败, finally 块也会写回)
        const contentAfter = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf-8') : null;
        recordTest('Revert failure recovery',
            contentBefore === contentAfter,
            `File preserved after API failure: ${contentBefore === contentAfter}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Test 4: 空文件
    // =========================================================

    L('\n========== Test 4: Empty file ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const testFile = path.join(TEST_DIR, 'test4-empty.txt');
        const body = buildSendBody(cid,
            `Create an empty file at ${testFile}. The file should have zero bytes. Just create it.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        const existsBefore = fs.existsSync(testFile);
        const sizeBefore = existsBefore ? fs.statSync(testFile).size : -1;
        L(`File before: exists=${existsBefore}, size=${sizeBefore}`);

        const result = await safeRevertPreservingFiles(cid, 0, true);

        const existsAfter = fs.existsSync(testFile);
        recordTest('Empty file preserve',
            existsAfter === existsBefore && result.stepsAfterRevert === 1,
            `exists: ${existsBefore}→${existsAfter}, steps: ${result.stepsBeforeRevert}→${result.stepsAfterRevert}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Test 5: preserveFiles=false (正常回退, 文件应被撤销)
    // =========================================================

    L('\n========== Test 5: Normal revert (no preserve) ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const testFile = path.join(TEST_DIR, 'test5.txt');
        const body = buildSendBody(cid,
            `Create a file at ${testFile} with content "test5 will be deleted". Just create it.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        const existsBefore = fs.existsSync(testFile);

        const result = await safeRevertPreservingFiles(cid, 0, false);

        await new Promise(r => setTimeout(r, 2000));
        const existsAfter = fs.existsSync(testFile);

        recordTest('Normal revert (no preserve)',
            result.success && existsBefore && !existsAfter,
            `existed: ${existsBefore}→${existsAfter}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Test 6: 多文件场景
    // =========================================================

    L('\n========== Test 6: Multiple files ==========');
    {
        const rStart = await call('StartCascade', {});
        const cid = rStart.data?.cascadeId;
        L(`cid = ${cid}`);

        const file1 = path.join(TEST_DIR, 'multi-a.txt');
        const file2 = path.join(TEST_DIR, 'multi-b.txt');

        const body = buildSendBody(cid,
            `Create TWO files:\n1. ${file1} with content "file A"\n2. ${file2} with content "file B"\nJust create them, no explanation.`,
            agenticConfig
        );
        await call('SendUserCascadeMessage', body);
        await waitForIdle(cid);

        const contentA = fs.existsSync(file1) ? fs.readFileSync(file1, 'utf-8') : null;
        const contentB = fs.existsSync(file2) ? fs.readFileSync(file2, 'utf-8') : null;
        L(`Before: A=${contentA ? 'exists' : 'missing'}, B=${contentB ? 'exists' : 'missing'}`);

        const result = await safeRevertPreservingFiles(cid, 0, true);

        const contentAAfter = fs.existsSync(file1) ? fs.readFileSync(file1, 'utf-8') : null;
        const contentBAfter = fs.existsSync(file2) ? fs.readFileSync(file2, 'utf-8') : null;

        const bothPreserved = contentA === contentAAfter && contentB === contentBAfter;
        recordTest('Multiple files preserve',
            result.stepsAfterRevert === 1 && bothPreserved,
            `A: ${contentA === contentAAfter}, B: ${contentB === contentBAfter}, steps: ${result.stepsBeforeRevert}→${result.stepsAfterRevert}`
        );

        await call('DeleteCascadeTrajectory', { cascadeId: cid });
    }

    // =========================================================
    // Cleanup
    // =========================================================

    L('\n=== Cleanup ===');
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    L('Done');
}

// =================================================================
// Findings 生成
// =================================================================

function generateFindings() {
    const lines = [];
    lines.push('---');
    lines.push('title: Revert 边缘情况 + 鲁棒性测试');
    lines.push('date: ' + new Date().toISOString().slice(0, 10));
    lines.push('target: daemon LS (auto-discovered)');
    lines.push('---');
    lines.push('');
    lines.push('# Revert 边缘情况 + safeRevertPreservingFiles 原型测试');
    lines.push('');
    lines.push('## 测试汇总');
    lines.push('');
    lines.push('| # | Test | Result | Details |');
    lines.push('|---|------|--------|---------|');
    testResults.forEach((r, i) => {
        lines.push(`| ${i + 1} | ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.details} |`);
    });
    lines.push('');
    lines.push(`Total: ${testResults.filter(r => r.passed).length}/${testResults.length} passed`);
    lines.push('');
    lines.push('## safeRevertPreservingFiles 函数原型');
    lines.push('');
    lines.push('见 `scripts/probe-revert-edge-cases.js` 中的 `safeRevertPreservingFiles()` 函数。');
    lines.push('');
    lines.push('## 完整日志');
    lines.push('');
    lines.push('```');
    lines.push(log.join('\n'));
    lines.push('```');
    return lines.join('\n');
}

(async () => {
    console.log('=== Revert Edge Cases E2E Test ===\n');
    try {
        await runTests();
    } catch (e) {
        L(`FATAL: ${e.message}`);
        console.error(e);
    }

    const findings = generateFindings();
    const findingsPath = path.join(__dirname, '..', 'docs', 'findings', '260309-probe-revert-edge-cases.md');
    fs.writeFileSync(findingsPath, findings, 'utf-8');
    console.log(`\nFindings saved: ${findingsPath}`);

    console.log('\n=== Test Results ===');
    testResults.forEach((r, i) => {
        console.log(`  ${r.passed ? 'PASS' : 'FAIL'} [${i + 1}] ${r.name}: ${r.details}`);
    });
    console.log(`\n  Total: ${testResults.filter(r => r.passed).length}/${testResults.length} passed`);
    console.log('=== Done ===');
})();
