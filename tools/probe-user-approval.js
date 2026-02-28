/**
 * probe-user-approval-v2.js — 深入分析 RUN_COMMAND step 结构
 */

const https = require('https');
const fs = require('fs');
const PORT = 65176;
const CSRF = '3f96f6d1-3f5e-43e1-8fe0-b665726ef030';

function grpcCall(method, body) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body || {});
        const req = https.request({
            hostname: '127.0.0.1', port: PORT,
            path: '/exa.language_server_pb.LanguageServerService/' + method,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-codeium-csrf-token': CSRF,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false, timeout: 5000,
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, data: d }));
        });
        req.on('error', e => resolve({ status: 0, data: 'ERR:' + e.code }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: 'TIMEOUT' }); });
        req.write(data); req.end();
    });
}

(async () => {
    // 获取对话列表
    const convRes = await grpcCall('GetAllCascadeTrajectories', {});
    const sums = JSON.parse(convRes.data)?.trajectorySummaries || {};
    const ids = Object.keys(sums);
    const idle = ids.filter(id => sums[id].status === 'CASCADE_RUN_STATUS_IDLE');

    // 遍历所有 IDLE 对话，找包含 RUN_COMMAND 最多的
    const results = [];

    for (const cid of idle) {
        const trajRes = await grpcCall('GetCascadeTrajectory', { cascadeId: cid });
        const traj = JSON.parse(trajRes.data);
        const steps = traj?.trajectory?.steps || [];
        const cmdSteps = steps.filter(s => s.type === 'CORTEX_STEP_TYPE_RUN_COMMAND');
        results.push({ cid, summary: sums[cid]?.summary, cmdCount: cmdSteps.length, totalSteps: steps.length });
    }

    results.sort((a, b) => b.cmdCount - a.cmdCount);
    console.log('=== Conversations sorted by RUN_COMMAND count ===');
    for (const r of results) {
        console.log(`  ${r.cmdCount} cmds / ${r.totalSteps} steps | ${r.summary?.substring(0, 40)} | ${r.cid}`);
    }

    // 选最多 cmd 的对话，输出所有 RUN_COMMAND 的完整结构
    const best = results[0];
    if (!best || best.cmdCount === 0) {
        console.log('No RUN_COMMAND steps found.');
        return;
    }

    console.log(`\nAnalyzing: ${best.cid} (${best.cmdCount} commands)`);

    const trajRes = await grpcCall('GetCascadeTrajectory', { cascadeId: best.cid });
    const traj = JSON.parse(trajRes.data);
    const steps = traj?.trajectory?.steps || [];

    // 输出所有 RUN_COMMAND 和 COMMAND_STATUS step 的完整结构
    const output = [];
    steps.forEach((s, i) => {
        if (s.type === 'CORTEX_STEP_TYPE_RUN_COMMAND' || s.type === 'CORTEX_STEP_TYPE_CODE_ACTION') {
            output.push({
                stepIndex: i,
                type: s.type,
                status: s.status,
                // 去掉大段 output 避免文件太大
                metadata: s.metadata,
                runCommand: s.runCommand,
                codeAction: s.codeAction ? {
                    ...s.codeAction,
                    // 截断 diff
                    diff: s.codeAction?.diff?.substring(0, 200),
                } : undefined,
            });
        }
    });

    // 写到文件
    const outPath = 'tools/probe-output.json';
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${output.length} steps to ${outPath}`);

    // toolCall 里的关键信息
    console.log('\n=== RUN_COMMAND toolCall details ===');
    for (const o of output.filter(x => x.type === 'CORTEX_STEP_TYPE_RUN_COMMAND')) {
        const tc = o.metadata?.toolCall;
        if (tc?.argumentsJson) {
            try {
                const args = JSON.parse(tc.argumentsJson);
                console.log(`[step ${o.stepIndex}] SafeToAutoRun=${args.SafeToAutoRun} | Cmd: ${args.CommandLine?.substring(0, 60)}`);
            } catch {
                console.log(`[step ${o.stepIndex}] args parse failed`);
            }
        }
    }
})();
