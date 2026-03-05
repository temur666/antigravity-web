/**
 * test-agent-file-ops.js — v3
 *
 * 基于 ls-reverse-engineering.md 的正确交互格式:
 * - HandleCascadeUserInteraction 需要 interaction 对象
 * - CODE_ACTION 用 file_permission 类型
 * - RUN_COMMAND 用 runCommand 类型
 */

const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const PORT = 42100;
const CSRF = 'daemon-with-ext-server';
const TARGET_FILE = '/home/tiemuer/antigravity-web/tmp/antigravity-agent-test.txt';

const fs = require('fs');
try { fs.unlinkSync(TARGET_FILE); } catch { /* ignore */ }

(async () => {
    console.log('=== Agent File Ops Test v3 ===\n');

    // 1. 创建会话
    console.log('[1] 创建会话...');
    const r1 = await grpcCall(PORT, CSRF, 'StartCascade', {}, 10000);
    const cid = r1.data.cascadeId;
    console.log(`    cascadeId: ${cid}\n`);

    // 2. 发送指令
    const config = { ...DEFAULT_CONFIG, agenticMode: false };
    const prompt = `Create a file at ${TARGET_FILE} with the content: "Hello from Antigravity Agent". Just do it without asking.`;
    const body = buildSendBody(cid, prompt, config);

    console.log('[2] 发送指令...');
    grpcCall(PORT, CSRF, 'SendUserCascadeMessage', body, 120000)
        .then(() => console.log('    [stream 结束]'))
        .catch(e => console.log(`    [stream: ${e.message}]`));

    // 3. 轮询 + 正确的自动审批
    console.log('[3] 轮询 Trajectory...\n');

    let lastStepCount = 0;
    let trajectoryId = null;

    for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000));

        let r3;
        try {
            r3 = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
        } catch (e) {
            console.log(`    [${i + 1}] 获取失败: ${e.message}`);
            continue;
        }

        const trajectory = r3.data?.trajectory;
        if (!trajectory) { console.log(`    [${i + 1}] 无 trajectory`); continue; }

        // 获取 trajectoryId
        if (!trajectoryId) {
            trajectoryId = trajectory.trajectoryId || trajectory.id || cid;
        }

        const steps = trajectory.steps || [];
        const cascadeStatus = trajectory.status || '';

        // 只打印新的 step
        if (steps.length > lastStepCount) {
            for (let j = lastStepCount; j < steps.length; j++) {
                const s = steps[j];
                const t = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
                const keys = Object.keys(s).filter(k => !['type', 'status', 'metadata'].includes(k));
                console.log(`    [${i + 1}] NEW Step ${j}: ${t.padEnd(25)} ${st.padEnd(12)} keys:[${keys.join(',')}]`);
            }
            lastStepCount = steps.length;
        } else {
            const last = steps[steps.length - 1];
            if (last) {
                const t = (last.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (last.status || '').replace('CORTEX_STEP_STATUS_', '');
                console.log(`    [${i + 1}] Last: ${t} = ${st}  (cascade: ${cascadeStatus.replace('CORTEX_CASCADE_STATUS_', '')})`);
            }
        }

        // 检查 WAITING step 并用正确格式审批
        for (let j = 0; j < steps.length; j++) {
            const step = steps[j];
            if (step.status !== 'CORTEX_STEP_STATUS_WAITING') continue;

            const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
            console.log(`\n    >>> WAITING: Step ${j} [${stepType}]`);
            console.log(`    >>> requestedInteraction:`, JSON.stringify(step.requestedInteraction || {}).slice(0, 200));

            // 构建正确的 interaction 对象
            let interaction = {
                trajectoryId: trajectoryId,
                stepIndex: j,
            };

            const ri = step.requestedInteraction || {};

            if (ri.runCommand !== undefined || stepType === 'RUN_COMMAND') {
                // 命令审批
                const cmd = step.runCommand?.proposedCommand || step.command?.commandLine || '';
                interaction.runCommand = { confirm: true, proposedCommandLine: cmd };
                console.log(`    >>> 类型: runCommand, 命令: "${cmd}"`);
            } else if (ri.filePermission !== undefined || stepType === 'CODE_ACTION') {
                // 文件操作审批 — 逆向自 exa.cortex_pb.FilePermissionInteraction
                // field 1: allow (bool), field 2: scope (PermissionScope enum), field 3: absolute_path_uri (string)
                // PermissionScope: 0=UNSPECIFIED, 1=ONCE, 2=CONVERSATION

                // 从 step 中提取文件路径
                let fileUri = '';
                const fpReq = step.codeAction?.filePermissionRequest;
                if (fpReq?.absolutePathUri) {
                    // filePermissionRequest.absolutePathUri 可能是纯路径或 file:// URI
                    fileUri = fpReq.absolutePathUri.startsWith('file://')
                        ? fpReq.absolutePathUri
                        : `file://${fpReq.absolutePathUri}`;
                } else if (step.permissions?.fileAccessPermissions?.[0]?.path) {
                    fileUri = step.permissions.fileAccessPermissions[0].path;
                } else if (step.codeAction?.actionSpec?.createFile?.path?.absoluteUri) {
                    fileUri = step.codeAction.actionSpec.createFile.path.absoluteUri;
                }

                interaction.filePermission = {
                    allow: true,
                    scope: 2,                   // PERMISSION_SCOPE_CONVERSATION
                    absolutePathUri: fileUri
                };
                console.log(`    >>> 类型: filePermission (allow=true, scope=CONVERSATION)`)
                console.log(`    >>> 文件: ${fileUri}`);
            } else {
                // 未知类型，尝试通用审批
                console.log(`    >>> 类型: 未知，尝试通用 runCommand=true`);
                interaction.runCommand = { confirm: true };
            }

            try {
                const approveResult = await grpcCall(PORT, CSRF, 'HandleCascadeUserInteraction', {
                    cascadeId: cid,
                    interaction: interaction,
                }, 10000);
                console.log(`    >>> 审批成功! 响应:`, JSON.stringify(approveResult.data || {}).slice(0, 200));
            } catch (e) {
                console.log(`    >>> 审批失败: ${e.message}`);
            }
            console.log('');
        }

        // 终止条件
        const hasPlannerResponse = steps.some(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
        const isIdle = cascadeStatus.includes('IDLE') || cascadeStatus.includes('COMPLETED');
        if (hasPlannerResponse && isIdle) {
            console.log('\n    [完成] PLANNER_RESPONSE + IDLE');
            break;
        }
    }

    // 4. 最终 Trajectory
    console.log('\n[4] 最终 Trajectory:');
    const final = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
    const ft = final.data?.trajectory;
    const finalSteps = ft?.steps || [];
    console.log(`    总 steps: ${finalSteps.length}, status: ${ft?.status}`);
    console.log(`    trajectoryId: ${ft?.trajectoryId || 'N/A'}`);

    for (let i = 0; i < finalSteps.length; i++) {
        const s = finalSteps[i];
        const t = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
        const st = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
        console.log(`\n    --- Step ${i} [${t}] (${st}) ---`);
        for (const key of Object.keys(s)) {
            if (['type', 'status', 'metadata'].includes(key)) continue;
            const val = JSON.stringify(s[key]);
            if (val && val.length > 2) console.log(`    ${key}: ${val.slice(0, 500)}`);
        }
    }

    // 5. 验证文件
    console.log('\n[5] 验证文件:');
    if (fs.existsSync(TARGET_FILE)) {
        const content = fs.readFileSync(TARGET_FILE, 'utf-8');
        console.log(`    文件存在! 内容: "${content.trim()}"`);
        console.log('\n    >>> TEST PASSED');
    } else {
        console.log(`    文件不存在: ${TARGET_FILE}`);
        console.log('\n    >>> TEST FAILED');
    }

    console.log('\n=== Done ===');
})().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
