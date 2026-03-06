/**
 * test-mcp-tools.js — 测试自定义 MCP 工具
 */

const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const PORT = 42100;
const CSRF = 'daemon-with-ext-server';

(async () => {
    console.log('=== MCP Tools Test ===\n');

    // 1. 创建会话
    const r1 = await grpcCall(PORT, CSRF, 'StartCascade', {}, 10000);
    const cid = r1.data.cascadeId;
    console.log(`[1] cascadeId: ${cid}\n`);

    // 2. 发送指令 -- 让 LS 使用 MCP 工具
    const config = { ...DEFAULT_CONFIG, agenticMode: false };
    const prompt = '请使用 get_server_status 工具获取当前服务器的状态信息，然后用 write_note 工具写一条笔记，标题是"服务器状态报告"，内容包含刚才获取到的服务器信息摘要。';
    const body = buildSendBody(cid, prompt, config);

    console.log('[2] 发送指令...');
    grpcCall(PORT, CSRF, 'SendUserCascadeMessage', body, 120000)
        .then(() => console.log('    [stream 结束]'))
        .catch(e => console.log(`    [stream: ${e.message}]`));

    // 3. 轮询
    console.log('[3] 轮询...\n');
    let lastStepCount = 0;

    for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000));

        let r3;
        try {
            r3 = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
        } catch (e) {
            console.log(`    [${i + 1}] 失败: ${e.message}`);
            if (e.message.includes('ECONNREFUSED')) {
                console.log('    >>> LS 崩溃，终止');
                break;
            }
            continue;
        }

        const trajectory = r3.data?.trajectory;
        if (!trajectory) continue;

        const steps = trajectory.steps || [];

        // 打印新 step
        if (steps.length > lastStepCount) {
            for (let j = lastStepCount; j < steps.length; j++) {
                const s = steps[j];
                const t = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
                const keys = Object.keys(s).filter(k => !['type', 'status', 'metadata'].includes(k));
                console.log(`    [${i + 1}] Step ${j}: ${t.padEnd(25)} ${st.padEnd(12)} keys:[${keys.join(',')}]`);

                // 如果是 MCP 相关 step，打印详情
                if (t.includes('MCP') || t.includes('TOOL')) {
                    console.log(`           ${JSON.stringify(s).slice(0, 300)}`);
                }
            }
            lastStepCount = steps.length;
        } else {
            const last = steps[steps.length - 1];
            if (last) {
                const t = (last.type || '').replace('CORTEX_STEP_TYPE_', '');
                const st = (last.status || '').replace('CORTEX_STEP_STATUS_', '');
                if (st !== 'DONE') console.log(`    [${i + 1}] ${t} = ${st}`);
            }
        }

        // 自动审批 WAITING
        for (let j = 0; j < steps.length; j++) {
            if (steps[j].status !== 'CORTEX_STEP_STATUS_WAITING') continue;
            const stepType = (steps[j].type || '').replace('CORTEX_STEP_TYPE_', '');
            console.log(`\n    >>> WAITING: Step ${j} [${stepType}]`);

            let interaction = { trajectoryId: trajectory.trajectoryId || cid, stepIndex: j };
            const ri = steps[j].requestedInteraction || {};

            if (ri.mcp !== undefined || stepType.includes('MCP')) {
                interaction.mcp = { confirm: true };
                console.log('    >>> 审批类型: mcp');
            } else if (ri.runCommand !== undefined || stepType === 'RUN_COMMAND') {
                interaction.runCommand = { confirm: true };
                console.log('    >>> 审批类型: runCommand');
            } else if (ri.filePermission !== undefined || stepType === 'CODE_ACTION') {
                interaction.filePermission = { approve: true };
                console.log('    >>> 审批类型: filePermission');
            } else {
                interaction.runCommand = { confirm: true };
                console.log('    >>> 审批类型: unknown, 尝试 runCommand');
            }

            try {
                await grpcCall(PORT, CSRF, 'HandleCascadeUserInteraction', { cascadeId: cid, interaction }, 10000);
                console.log('    >>> 审批成功!\n');
            } catch (e) {
                console.log(`    >>> 审批失败: ${e.message}\n`);
            }
        }

        // 简单终止: 所有 step DONE/ERROR 且有 PLANNER_RESPONSE
        const hasPlanner = steps.some(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
        const allFinished = steps.length > 4 && steps.every(s =>
            s.status === 'CORTEX_STEP_STATUS_DONE' ||
            s.status === 'CORTEX_STEP_STATUS_ERROR' ||
            s.status === 'CORTEX_STEP_STATUS_COMPLETED'
        );
        // 检查最后一个 planner response 是否 DONE
        const lastPlanner = [...steps].reverse().find(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
        if (hasPlanner && allFinished && lastPlanner?.status === 'CORTEX_STEP_STATUS_DONE') {
            // 额外等 2s 防止还有新 step
            await new Promise(r => setTimeout(r, 2000));
            const r4 = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
            if ((r4.data?.trajectory?.steps || []).length === steps.length) {
                console.log('\n    [完成]');
                break;
            }
        }
    }

    // 4. 最终结果
    console.log('\n[4] 最终 Trajectory:');
    const final = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
    const finalSteps = final.data?.trajectory?.steps || [];

    for (let i = 0; i < finalSteps.length; i++) {
        const s = finalSteps[i];
        const t = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
        const st = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
        console.log(`\n    --- Step ${i} [${t}] (${st}) ---`);
        for (const key of Object.keys(s)) {
            if (['type', 'status', 'metadata'].includes(key)) continue;
            const val = JSON.stringify(s[key]);
            if (val && val.length > 2) console.log(`    ${key}: ${val.slice(0, 300)}`);
        }
    }

    // 5. 检查笔记
    const fs = require('fs');
    const notesDir = '/home/tiemuer/antigravity-web/tmp/notes';
    console.log('\n[5] 检查笔记目录:');
    if (fs.existsSync(notesDir)) {
        const files = fs.readdirSync(notesDir);
        console.log(`    文件数: ${files.length}`);
        files.forEach(f => {
            console.log(`    - ${f}`);
            const content = fs.readFileSync(`${notesDir}/${f}`, 'utf-8');
            console.log(`      ${content.slice(0, 200)}`);
        });
    } else {
        console.log('    目录不存在');
    }

    console.log('\n=== Done ===');
})().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
