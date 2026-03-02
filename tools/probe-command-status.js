/**
 * probe-command-status.js — 探测 COMMAND_STATUS Step 的原始数据结构
 *
 * 遍历所有对话，找到包含 COMMAND_STATUS 和 RUN_COMMAND 的 step，
 * 输出它们的完整 JSON 结构到文件。
 */
const { discoverLSAsync, grpcCall } = require('../lib/core/ls-discovery');

(async () => {
    const ls = await discoverLSAsync();
    if (!ls) {
        console.log('LS not found');
        return;
    }
    console.log(`LS found: port=${ls.port}`);

    // 获取对话列表
    const convRes = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
    const sums = convRes.data?.trajectorySummaries || {};
    const ids = Object.keys(sums);
    console.log(`Total conversations: ${ids.length}`);

    // 遍历所有对话，收集 COMMAND_STATUS 和 RUN_COMMAND steps
    const allFound = [];
    let scanned = 0;

    for (const cid of ids) {
        scanned++;
        try {
            const trajRes = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId: cid });
            const steps = trajRes.data?.trajectory?.steps || [];

            for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                if (s.type === 'CORTEX_STEP_TYPE_COMMAND_STATUS' ||
                    s.type === 'CORTEX_STEP_TYPE_RUN_COMMAND') {
                    allFound.push({
                        conversationId: cid,
                        summary: sums[cid]?.summary?.substring(0, 50),
                        stepIndex: i,
                        type: s.type,
                        status: s.status,
                        // 完整的 step 结构，但截断大字段
                        allKeys: Object.keys(s),
                        runCommand: s.runCommand ? {
                            ...s.runCommand,
                            // 截断可能很长的 output
                            output: s.runCommand.output?.substring(0, 300),
                        } : undefined,
                        commandStatus: s.commandStatus,
                        // metadata 里可能有 toolCall
                        metadata: s.metadata ? {
                            ...s.metadata,
                            toolCall: s.metadata.toolCall ? {
                                name: s.metadata.toolCall.name,
                                argumentsJson: s.metadata.toolCall.argumentsJson?.substring(0, 200),
                                result: s.metadata.toolCall.result?.substring(0, 300),
                            } : undefined,
                        } : undefined,
                        // 其他可能的字段
                        action: s.action ? Object.keys(s.action) : undefined,
                    });
                }
            }
        } catch (err) {
            // skip
        }

        // 找到足够多就停
        if (allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_COMMAND_STATUS').length >= 5 &&
            allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_RUN_COMMAND').length >= 5) {
            break;
        }
    }

    console.log(`\nScanned ${scanned} conversations`);
    console.log(`Found ${allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_COMMAND_STATUS').length} COMMAND_STATUS steps`);
    console.log(`Found ${allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_RUN_COMMAND').length} RUN_COMMAND steps`);

    // 输出到文件
    const fs = require('fs');
    const outPath = 'tools/probe-command-status-output.json';
    fs.writeFileSync(outPath, JSON.stringify(allFound, null, 2));
    console.log(`\nWrote to ${outPath}`);

    // 直接在终端打印前几个
    console.log('\n=== Sample COMMAND_STATUS steps (if any) ===');
    const cmdStatusSteps = allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_COMMAND_STATUS');
    for (const s of cmdStatusSteps.slice(0, 3)) {
        console.log(JSON.stringify(s, null, 2));
        console.log('---');
    }

    console.log('\n=== Sample RUN_COMMAND steps ===');
    const runCmdSteps = allFound.filter(x => x.type === 'CORTEX_STEP_TYPE_RUN_COMMAND');
    for (const s of runCmdSteps.slice(0, 3)) {
        console.log(JSON.stringify(s, null, 2));
        console.log('---');
    }
})();
