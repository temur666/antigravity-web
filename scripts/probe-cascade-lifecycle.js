/**
 * probe-cascade-lifecycle.js — Cascade 核心生命周期 11 个 API 全参数 E2E 验证
 *
 * 目标 LS: daemon (port=42100, csrf="daemon-with-ext-server")
 *
 * Phase 1: 创建与查询 (不消耗配额)
 * Phase 2: 发送消息 + AI 回复 (简单 + 复杂任务)
 * Phase 3: 轨迹操作 (Copy/Markdown/Share/Load)
 * Phase 4: 清理 (删除简单会话, 保留复杂会话)
 *
 * 输出: docs/findings/260309-probe-cascade-lifecycle.md
 */

const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');
const path = require('path');

const PORT = 42100;
const CSRF = 'daemon-with-ext-server';
const TIMEOUT = 15000;
const POLL_INTERVAL = 2000;
const MAX_POLL = 60; // 最多 2 分钟

// ========== 结果收集 ==========

const results = [];

function record(apiName, variant, request, response, notes = '') {
    const entry = {
        api: apiName,
        variant,
        request,
        response: {
            status: response.status,
            data: response.data,
        },
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

// ========== 轮询等待 IDLE ==========

async function waitForIdle(cascadeId, label = '') {
    console.log(`  ... 等待 ${label || cascadeId} 完成`);
    for (let i = 0; i < MAX_POLL; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const r = await safeCall('GetCascadeTrajectory', { cascadeId });
        if (r.status !== 200) continue;

        const status = r.data?.status || '';
        const steps = r.data?.trajectory?.steps || [];
        const stepCount = steps.length;

        // 检查是否有 WAITING step (需要审批)
        for (let j = 0; j < steps.length; j++) {
            const step = steps[j];
            if (step.status !== 'CORTEX_STEP_STATUS_WAITING') continue;

            const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
            console.log(`    >>> WAITING: Step ${j} [${stepType}] - 自动审批`);

            const trajectoryId = r.data?.trajectory?.trajectoryId || cascadeId;
            const interaction = { trajectoryId, stepIndex: j };

            if (stepType === 'RUN_COMMAND') {
                const cmd = step.runCommand?.proposedCommand || step.command?.commandLine || '';
                interaction.runCommand = { confirm: true, proposedCommandLine: cmd };
            } else if (stepType === 'CODE_ACTION') {
                let fileUri = '';
                const fpReq = step.codeAction?.filePermissionRequest;
                if (fpReq?.absolutePathUri) {
                    fileUri = fpReq.absolutePathUri.startsWith('file://')
                        ? fpReq.absolutePathUri
                        : `file://${fpReq.absolutePathUri}`;
                }
                interaction.filePermission = { allow: true, scope: 2, absolutePathUri: fileUri };
            } else {
                interaction.runCommand = { confirm: true };
            }

            await safeCall('HandleCascadeUserInteraction', { cascadeId, interaction });
        }

        if (status.includes('IDLE') || status.includes('COMPLETED')) {
            console.log(`    IDLE (${stepCount} steps, poll #${i + 1})`);
            return r;
        }

        process.stdout.write(`    [${i + 1}/${MAX_POLL}] ${status} (${stepCount} steps)\r`);
    }
    console.log('    TIMEOUT');
    return await safeCall('GetCascadeTrajectory', { cascadeId });
}

// ========== Phase 1: 创建与查询 ==========

async function phase1() {
    console.log('\n' + '='.repeat(60));
    console.log('Phase 1: 创建与查询 (不消耗配额)');
    console.log('='.repeat(60));

    // --- 1. StartCascade (最小参数) ---
    console.log('\n--- [1/6] StartCascade (最小参数) ---');
    const r1 = await safeCall('StartCascade', {});
    const e1 = record('StartCascade', 'minimal', {}, r1);
    const cidA = r1.data?.cascadeId;
    if (!cidA) throw new Error('StartCascade minimal failed: no cascadeId');
    console.log(`    cascadeId_A = ${cidA}`);

    // --- 2. StartCascade (全参数) ---
    console.log('\n--- [2/6] StartCascade (全参数) ---');
    const fullStartBody = {
        metadata: {
            ideName: 'antigravity',
            apiKey: '',
            locale: 'zh',
            ideVersion: '1.19.6',
            extensionName: 'antigravity-probe',
        },
        experimentConfig: {},
        // source 和 trajectoryType 是 proto enum, 传空/默认就可以
    };
    const r2 = await safeCall('StartCascade', fullStartBody);
    record('StartCascade', 'full', fullStartBody, r2);
    const cidB = r2.data?.cascadeId;
    if (!cidB) throw new Error('StartCascade full failed: no cascadeId');
    console.log(`    cascadeId_B = ${cidB}`);

    // --- 3. GetAllCascadeTrajectories ---
    console.log('\n--- [3/6] GetAllCascadeTrajectories ---');
    const r3 = await safeCall('GetAllCascadeTrajectories', {});
    const summaries = r3.data?.trajectorySummaries || r3.data?.trajectory_summaries || {};
    const summaryKeys = Array.isArray(summaries)
        ? summaries.map(s => s.key)
        : Object.keys(summaries);
    const foundA = summaryKeys.includes(cidA);
    const foundB = summaryKeys.includes(cidB);
    record('GetAllCascadeTrajectories', 'default', {}, r3,
        `总数=${summaryKeys.length}, 找到A=${foundA}, 找到B=${foundB}`);

    // --- 4. GetCascadeTrajectory (空轨迹) ---
    console.log('\n--- [4/6] GetCascadeTrajectory (空轨迹, 两种 verbosity) ---');
    const r4a = await safeCall('GetCascadeTrajectory', { cascadeId: cidA });
    record('GetCascadeTrajectory', 'default_verbosity', { cascadeId: cidA }, r4a);

    const r4b = await safeCall('GetCascadeTrajectory', {
        cascadeId: cidA,
        verbosity: 'CLIENT_TRAJECTORY_VERBOSITY_DEBUG',
    });
    record('GetCascadeTrajectory', 'debug_verbosity', {
        cascadeId: cidA, verbosity: 'CLIENT_TRAJECTORY_VERBOSITY_DEBUG',
    }, r4b, 'diff vs default: ' + (JSON.stringify(r4a.data) === JSON.stringify(r4b.data) ? 'SAME' : 'DIFFERENT'));

    // --- 5. GetCascadeTrajectorySteps (空) ---
    console.log('\n--- [5/6] GetCascadeTrajectorySteps (空轨迹) ---');
    const r5 = await safeCall('GetCascadeTrajectorySteps', {
        cascadeId: cidA,
        stepOffset: 0,
        verbosity: 'CLIENT_TRAJECTORY_VERBOSITY_PROD_UI',
    });
    record('GetCascadeTrajectorySteps', 'empty', {
        cascadeId: cidA, stepOffset: 0, verbosity: 'PROD_UI',
    }, r5);

    // --- 6. GetCascadeTrajectoryGeneratorMetadata (空) ---
    console.log('\n--- [6/6] GetCascadeTrajectoryGeneratorMetadata (空) ---');
    const r6 = await safeCall('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: cidA,
        generatorMetadataOffset: 0,
        includeMessages: true,
    });
    record('GetCascadeTrajectoryGeneratorMetadata', 'empty', {
        cascadeId: cidA, generatorMetadataOffset: 0, includeMessages: true,
    }, r6);

    return { cidA, cidB };
}

// ========== Phase 2: 发送消息 ==========

async function phase2(cidA, cidB) {
    console.log('\n' + '='.repeat(60));
    console.log('Phase 2: 发送消息 + AI 回复');
    console.log('='.repeat(60));

    // --- 7. SendUserCascadeMessage (简单消息到 A) ---
    console.log('\n--- [7] SendUserCascadeMessage (简单消息 → A) ---');
    const simpleConfig = { ...DEFAULT_CONFIG, agenticMode: false };
    const simpleBody = buildSendBody(cidA, '请回复 ok', simpleConfig);
    const r7 = await safeCall('SendUserCascadeMessage', simpleBody, 30000);
    record('SendUserCascadeMessage', 'simple_chat', simpleBody, r7);

    // 等待 A 完成
    const r7final = await waitForIdle(cidA, 'A (简单)');

    // --- 8. SendUserCascadeMessage (复杂任务到 B - 含代码修改) ---
    console.log('\n--- [8] SendUserCascadeMessage (复杂任务 → B) ---');
    const complexConfig = { ...DEFAULT_CONFIG, model: 'MODEL_PLACEHOLDER_M18', agenticMode: true };
    const complexPrompt = [
        '创建文件 /home/tiemuer/antigravity-web/tmp/probe-test-output.js',
        '内容为: 一个简单的 add(a, b) 函数，带 JSDoc 注释，并导出。',
        '文件末尾加一行注释: // Created by probe-cascade-lifecycle.js',
    ].join('\n');
    const complexBody = buildSendBody(cidB, complexPrompt, complexConfig);
    const r8 = await safeCall('SendUserCascadeMessage', complexBody, 30000);
    record('SendUserCascadeMessage', 'complex_agent', complexBody, r8);

    // 等待 B 完成
    const r8final = await waitForIdle(cidB, 'B (复杂)');

    // --- 9. 再次查询 steps 和 metadata (有数据的) ---
    console.log('\n--- [9] GetCascadeTrajectorySteps (有数据) ---');
    const r9 = await safeCall('GetCascadeTrajectorySteps', {
        cascadeId: cidA,
        stepOffset: 0,
        verbosity: 'CLIENT_TRAJECTORY_VERBOSITY_DEBUG',
    });
    const stepCount = (r9.data?.steps || []).length;
    record('GetCascadeTrajectorySteps', 'with_data', {
        cascadeId: cidA, stepOffset: 0, verbosity: 'DEBUG',
    }, r9, `steps=${stepCount}`);

    // 测试 step_offset 分页
    if (stepCount > 1) {
        console.log('\n--- [9b] GetCascadeTrajectorySteps (offset=1 分页测试) ---');
        const r9b = await safeCall('GetCascadeTrajectorySteps', {
            cascadeId: cidA,
            stepOffset: 1,
        });
        const pagedCount = (r9b.data?.steps || []).length;
        record('GetCascadeTrajectorySteps', 'paged_offset1', {
            cascadeId: cidA, stepOffset: 1,
        }, r9b, `steps=${pagedCount} (expected ${stepCount - 1})`);
    }

    console.log('\n--- [10] GetCascadeTrajectoryGeneratorMetadata (有数据) ---');
    const r10 = await safeCall('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: cidA,
        generatorMetadataOffset: 0,
        includeMessages: true,
    });
    const metaCount = (r10.data?.generatorMetadata || r10.data?.generator_metadata || []).length;
    record('GetCascadeTrajectoryGeneratorMetadata', 'with_data', {
        cascadeId: cidA, generatorMetadataOffset: 0, includeMessages: true,
    }, r10, `metadata_count=${metaCount}`);

    // 测试不含 messages
    console.log('\n--- [10b] GetCascadeTrajectoryGeneratorMetadata (includeMessages=false) ---');
    const r10b = await safeCall('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: cidA,
        generatorMetadataOffset: 0,
        includeMessages: false,
    });
    record('GetCascadeTrajectoryGeneratorMetadata', 'without_messages', {
        cascadeId: cidA, generatorMetadataOffset: 0, includeMessages: false,
    }, r10b);

    return { r7final, r8final };
}

// ========== Phase 3: 轨迹操作 ==========

async function phase3(cidA, cidB) {
    console.log('\n' + '='.repeat(60));
    console.log('Phase 3: 轨迹操作 (Copy/Markdown/Share/Load)');
    console.log('='.repeat(60));

    // --- 11. CopyTrajectory ---
    console.log('\n--- [11] CopyTrajectory ---');
    const r11 = await safeCall('CopyTrajectory', { cascadeId: cidB });
    const copiedId = r11.data?.newCascadeId;
    record('CopyTrajectory', 'default', { cascadeId: cidB }, r11,
        copiedId ? `newCascadeId=${copiedId}` : 'no newCascadeId');

    // 带 additional_details
    console.log('\n--- [11b] CopyTrajectory (with additionalDetails) ---');
    const r11b = await safeCall('CopyTrajectory', {
        cascadeId: cidA,
        additionalDetails: 'Copied by probe script for testing',
    });
    const copiedId2 = r11b.data?.newCascadeId;
    record('CopyTrajectory', 'with_details', {
        cascadeId: cidA, additionalDetails: 'Copied by probe script for testing',
    }, r11b);

    // --- 12. ConvertTrajectoryToMarkdown ---
    console.log('\n--- [12] ConvertTrajectoryToMarkdown ---');
    // 先获取完整 trajectory
    const traj = await safeCall('GetCascadeTrajectory', { cascadeId: cidA });
    const trajectoryObj = traj.data?.trajectory;
    if (trajectoryObj) {
        const r12 = await safeCall('ConvertTrajectoryToMarkdown', {
            trajectory: trajectoryObj,
        }, 30000);
        const mdLength = (r12.data?.markdown || '').length;
        record('ConvertTrajectoryToMarkdown', 'default', {
            trajectory: '(Trajectory object, omitted for brevity)',
        }, r12, `markdown_length=${mdLength}`);
    } else {
        record('ConvertTrajectoryToMarkdown', 'skipped', {}, {
            status: 'SKIP', data: { reason: 'no trajectory data' },
        }, 'GetCascadeTrajectory returned no trajectory');
    }

    // --- 13. CreateTrajectoryShare ---
    console.log('\n--- [13] CreateTrajectoryShare ---');
    const r13 = await safeCall('CreateTrajectoryShare', {
        metadata: {
            ideName: 'antigravity',
            apiKey: '',
        },
        cascadeId: cidB,
        // shareStatus 是 enum, 试默认值
    });
    record('CreateTrajectoryShare', 'default', {
        metadata: { ideName: 'antigravity' },
        cascadeId: cidB,
    }, r13, r13.data?.url ? `url=${r13.data.url}` : 'no url');

    // --- 14. LoadTrajectory ---
    console.log('\n--- [14] LoadTrajectory ---');
    if (copiedId) {
        const r14 = await safeCall('LoadTrajectory', { cascadeId: copiedId });
        record('LoadTrajectory', 'default', { cascadeId: copiedId }, r14);
    } else {
        record('LoadTrajectory', 'skipped', {}, {
            status: 'SKIP', data: { reason: 'no copied trajectory' },
        });
    }

    return { copiedId, copiedId2 };
}

// ========== Phase 4: 清理 ==========

async function phase4(cidA, cidB, copiedId, copiedId2) {
    console.log('\n' + '='.repeat(60));
    console.log('Phase 4: 清理');
    console.log('='.repeat(60));

    // 删除简单会话 A
    console.log('\n--- [15] DeleteCascadeTrajectory (删除 A - 简单) ---');
    const r15 = await safeCall('DeleteCascadeTrajectory', { cascadeId: cidA });
    record('DeleteCascadeTrajectory', 'delete_simple', { cascadeId: cidA }, r15);

    // 删除复制的会话
    if (copiedId) {
        console.log('\n--- [15b] DeleteCascadeTrajectory (删除 copy of B) ---');
        const r15b = await safeCall('DeleteCascadeTrajectory', { cascadeId: copiedId });
        record('DeleteCascadeTrajectory', 'delete_copy', { cascadeId: copiedId }, r15b);
    }
    if (copiedId2) {
        console.log('\n--- [15c] DeleteCascadeTrajectory (删除 copy of A) ---');
        const r15c = await safeCall('DeleteCascadeTrajectory', { cascadeId: copiedId2 });
        record('DeleteCascadeTrajectory', 'delete_copy2', { cascadeId: copiedId2 }, r15c);
    }

    // 验证删除
    console.log('\n--- [16] GetAllCascadeTrajectories (验证删除) ---');
    const r16 = await safeCall('GetAllCascadeTrajectories', {});
    const summaries = r16.data?.trajectorySummaries || r16.data?.trajectory_summaries || {};
    const keys = Array.isArray(summaries) ? summaries.map(s => s.key) : Object.keys(summaries);
    const aGone = !keys.includes(cidA);
    const bExists = keys.includes(cidB);
    record('GetAllCascadeTrajectories', 'post_cleanup', {}, r16,
        `A deleted=${aGone}, B exists=${bExists}, total=${keys.length}`);

    console.log(`\n    保留的复杂会话 B: ${cidB}`);
}

// ========== 输出 Findings 文档 ==========

function generateFindings(cidA, cidB) {
    const lines = [];
    const add = (...a) => lines.push(a.join(''));

    add('---');
    add('title: Cascade 核心生命周期 API E2E 验证');
    add('date: ', new Date().toISOString().slice(0, 10));
    add('target: daemon LS v1.19.6 (port=42100)');
    add('---');
    add('');
    add('# Cascade 核心生命周期 API E2E 验证结果');
    add('');
    add(`> 执行时间: ${new Date().toISOString()}`);
    add(`> 目标: daemon LS v1.19.6 (port=${PORT})`);
    add(`> 简单会话 A: ${cidA} (已删除)`);
    add(`> 复杂会话 B: ${cidB} (保留)`);
    add('');

    // 汇总表
    add('## 汇总');
    add('');
    add('| # | API | Variant | Status | Notes |');
    add('|---|-----|---------|--------|-------|');
    results.forEach((r, i) => {
        const status = r.success ? 'OK' : 'FAIL';
        add(`| ${i + 1} | \`${r.api}\` | ${r.variant} | ${status} | ${r.notes} |`);
    });
    add('');

    // 每个 API 的详细记录
    add('## 详细记录');
    add('');

    let currentApi = '';
    for (const r of results) {
        if (r.api !== currentApi) {
            currentApi = r.api;
            add(`### ${r.api}`);
            add('');
        }

        add(`#### ${r.variant}`);
        add('');
        add('**请求:**');
        add('```json');

        // 对 request 做处理: 隐藏过长的字段
        const reqDisplay = { ...r.request };
        if (reqDisplay.items) {
            reqDisplay.items = reqDisplay.items.map(item => {
                if (item.text && item.text.length > 200) {
                    return { text: item.text.slice(0, 200) + '...' };
                }
                return item;
            });
        }
        if (reqDisplay.trajectory && typeof reqDisplay.trajectory === 'object') {
            reqDisplay.trajectory = '(Trajectory object, see GetCascadeTrajectory response)';
        }
        // 隐藏 cascadeConfig 的大对象
        if (reqDisplay.cascadeConfig) {
            reqDisplay.cascadeConfig = '(CascadeConfig object)';
        }
        add(JSON.stringify(reqDisplay, null, 2));
        add('```');
        add('');
        add(`**响应 (status=${r.response.status}):**`);
        add('```json');

        // 响应也做截断
        let respStr = JSON.stringify(r.response.data, null, 2);
        if (respStr.length > 3000) {
            respStr = respStr.slice(0, 3000) + '\n... (truncated)';
        }
        add(respStr);
        add('```');

        if (r.notes) {
            add(`> ${r.notes}`);
        }
        add('');
    }

    return lines.join('\n');
}

// ========== 主流程 ==========

(async () => {
    console.log('╔' + '═'.repeat(58) + '╗');
    console.log('║  Cascade 核心生命周期 API E2E 全参数验证                ║');
    console.log('║  Target: daemon LS v1.19.6 (port=42100)                ║');
    console.log('╚' + '═'.repeat(58) + '╝');

    // 先验证 LS 连通性
    console.log('\n[预检] Heartbeat...');
    const hb = await safeCall('Heartbeat', { metadata: {} });
    if (hb.status !== 200) {
        console.error('LS 不可达! 请确认 daemon LS 正在运行。');
        console.error('响应:', JSON.stringify(hb));
        process.exit(1);
    }
    console.log('  LS 在线:', JSON.stringify(hb.data));

    let cidA, cidB, copiedId, copiedId2;

    try {
        // Phase 1
        const p1 = await phase1();
        cidA = p1.cidA;
        cidB = p1.cidB;

        // Phase 2
        await phase2(cidA, cidB);

        // Phase 3
        const p3 = await phase3(cidA, cidB);
        copiedId = p3.copiedId;
        copiedId2 = p3.copiedId2;

        // Phase 4
        await phase4(cidA, cidB, copiedId, copiedId2);

    } catch (err) {
        console.error('\n\nFATAL ERROR:', err.message);
        console.error(err.stack);
    }

    // 输出 Findings
    console.log('\n' + '='.repeat(60));
    console.log('生成 Findings 文档...');
    console.log('='.repeat(60));

    const findings = generateFindings(cidA || 'unknown', cidB || 'unknown');
    const findingsDir = path.join(__dirname, '..', 'docs', 'findings');
    fs.mkdirSync(findingsDir, { recursive: true });
    const findingsPath = path.join(findingsDir, '260309-probe-cascade-lifecycle.md');
    fs.writeFileSync(findingsPath, findings, 'utf-8');
    console.log(`\n  Findings 已保存: ${findingsPath}`);

    // 写 JSON 原始数据
    const jsonPath = path.join(findingsDir, '260309-probe-cascade-lifecycle.json');
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`  JSON 原始数据: ${jsonPath}`);

    // 统计
    const okCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const skipCount = results.filter(r => r.response.status === 'SKIP').length;
    console.log(`\n  总计: ${results.length} 测试 | ${okCount} 成功 | ${failCount} 失败 | ${skipCount} 跳过`);

    console.log('\n=== Done ===');
})().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
