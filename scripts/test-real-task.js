/**
 * test-real-task.js — 真实任务测试
 *
 * 让后台 LS 分析 docs/ 下 5 个文档的关系，验证完整的读+分析+写链路。
 */

const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');
const fs = require('fs');

const PORT = 42100;
const CSRF = 'daemon-with-ext-server';

(async () => {
    console.log('=== Real Task Test: 分析 docs/ 文档关系 ===\n');

    // 1. 创建会话
    console.log('[1] 创建会话...');
    const r1 = await grpcCall(PORT, CSRF, 'StartCascade', {}, 10000);
    const cid = r1.data.cascadeId;
    console.log(`    cascadeId: ${cid}\n`);

    // 2. 发送任务
    const config = { ...DEFAULT_CONFIG, agenticMode: false };
    const prompt = [
        '阅读 /home/tiemuer/antigravity-web/docs/ 目录下的这 5 个 markdown 文件：',
        '1. api-reference.md',
        '2. ls-grpc-api.md',
        '3. ls-reverse-engineering.md',
        '4. ls-step-raw-fields.md',
        '5. stream-payload-analysis.md',
        '',
        '请分析它们之间的关系（只需要第一层关系，不需要深入细节），',
        '然后把分析结果写入 /home/tiemuer/antigravity-web/tmp/docs-analysis.md 文件。',
    ].join('\n');

    const body = buildSendBody(cid, prompt, config);

    console.log('[2] 发送任务...');
    console.log(`    Prompt: "${prompt.slice(0, 100)}..."\n`);

    grpcCall(PORT, CSRF, 'SendUserCascadeMessage', body, 180000)
        .then(() => console.log('    [stream 结束]'))
        .catch(e => console.log(`    [stream: ${e.message}]`));

    // 3. 轮询
    console.log('[3] 轮询 Trajectory...\n');

    let lastStepCount = 0;
    let trajectoryId = null;

    for (let i = 0; i < 90; i++) {  // 最多 3 分钟
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

        if (!trajectoryId) {
            trajectoryId = trajectory.trajectoryId || trajectory.id || cid;
        }

        const steps = trajectory.steps || [];
        const cascadeStatus = trajectory.status || '';

        // 打印新 step
        if (steps.length > lastStepCount) {
            for (let j = lastStepCount; j < steps.length; j++) {
                const s = steps[j];
                const t = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
                console.log(`    [${i + 1}] Step ${j}: ${t.padEnd(25)} ${st}`);

                // 如果是 CODE_ACTION，打印更多信息
                if (t === 'CODE_ACTION' && s.codeAction) {
                    const spec = s.codeAction.actionSpec || {};
                    if (spec.createFile) console.log(`           → createFile: ${spec.createFile.path?.absoluteUri}`);
                    if (spec.editFile) console.log(`           → editFile: ${spec.editFile.path?.absoluteUri}`);
                }

                // 如果是 TOOL_RESULT 或类似的，打印工具名
                if (s.toolResult) {
                    console.log(`           → tool: ${s.toolResult.toolName || 'unknown'}`);
                }
            }
            lastStepCount = steps.length;
        } else {
            const last = steps[steps.length - 1];
            if (last) {
                const t = (last.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (last.status || '').replace('CORTEX_STEP_STATUS_', '');
                process.stdout.write(`    [${i + 1}] ... ${t} = ${st}  (cascade: ${cascadeStatus.replace('CORTEX_CASCADE_STATUS_', '')})\r`);
            }
        }

        // 自动审批 WAITING steps
        for (let j = 0; j < steps.length; j++) {
            const step = steps[j];
            if (step.status !== 'CORTEX_STEP_STATUS_WAITING') continue;

            const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
            console.log(`\n    >>> WAITING: Step ${j} [${stepType}]`);

            let interaction = { trajectoryId, stepIndex: j };
            const ri = step.requestedInteraction || {};

            if (ri.runCommand !== undefined || stepType === 'RUN_COMMAND') {
                const cmd = step.runCommand?.proposedCommand || step.command?.commandLine || '';
                interaction.runCommand = { confirm: true, proposedCommandLine: cmd };
                console.log(`    >>> 审批 runCommand: "${cmd}"`);
            } else if (ri.filePermission !== undefined || stepType === 'CODE_ACTION') {
                let fileUri = '';
                const fpReq = step.codeAction?.filePermissionRequest;
                if (fpReq?.absolutePathUri) {
                    fileUri = fpReq.absolutePathUri.startsWith('file://')
                        ? fpReq.absolutePathUri
                        : `file://${fpReq.absolutePathUri}`;
                } else if (step.permissions?.fileAccessPermissions?.[0]?.path) {
                    fileUri = step.permissions.fileAccessPermissions[0].path;
                }
                interaction.filePermission = { allow: true, scope: 2, absolutePathUri: fileUri };
                console.log(`    >>> 审批 filePermission: ${fileUri}`);
            } else {
                interaction.runCommand = { confirm: true };
                console.log(`    >>> 审批 通用`);
            }

            try {
                await grpcCall(PORT, CSRF, 'HandleCascadeUserInteraction', {
                    cascadeId: cid, interaction
                }, 10000);
                console.log(`    >>> 审批成功`);
            } catch (e) {
                console.log(`    >>> 审批失败: ${e.message}`);
            }
        }

        // 终止条件: 有 PLANNER_RESPONSE 且 cascade IDLE
        const plannerSteps = steps.filter(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
        const lastPlanner = plannerSteps[plannerSteps.length - 1];
        const isIdle = cascadeStatus.includes('IDLE') || cascadeStatus.includes('COMPLETED');

        // 需要第二个 PLANNER_RESPONSE（第一个是规划，第二个是总结）
        if (plannerSteps.length >= 2 && lastPlanner?.status === 'CORTEX_STEP_STATUS_DONE' && isIdle) {
            console.log('\n\n    [完成] 任务结束');
            break;
        }
    }

    // 4. 输出最终 AI 回复
    console.log('\n[4] AI 的最终回复:');
    const final = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
    const ft = final.data?.trajectory;
    const finalSteps = ft?.steps || [];

    const plannerResponses = finalSteps.filter(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
    const lastResponse = plannerResponses[plannerResponses.length - 1];
    if (lastResponse?.plannerResponse?.response) {
        console.log('─'.repeat(60));
        console.log(lastResponse.plannerResponse.response.slice(0, 2000));
        console.log('─'.repeat(60));
    }

    // 5. 验证输出文件
    console.log('\n[5] 验证输出文件:');
    const outputFile = '/home/tiemuer/antigravity-web/tmp/docs-analysis.md';
    if (fs.existsSync(outputFile)) {
        const content = fs.readFileSync(outputFile, 'utf-8');
        console.log(`    文件存在! 大小: ${content.length} 字符`);
        console.log(`    前 500 字符:\n${content.slice(0, 500)}`);
        console.log('\n    >>> TEST PASSED');
    } else {
        console.log(`    文件不存在: ${outputFile}`);
        console.log('\n    >>> TEST FAILED (文件未创建)');
    }

    console.log('\n=== Done ===');
})().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
