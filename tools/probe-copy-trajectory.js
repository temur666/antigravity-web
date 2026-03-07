/**
 * probe-copy-trajectory.js
 *
 * 探测 CopyTrajectory API 的参数格式。
 * 用法: node tools/probe-copy-trajectory.js
 *
 * 策略: 先获取一个已有的 cascadeId，然后用不同参数组合调用 CopyTrajectory，
 * 观察返回值和错误信息，推断正确的参数格式。
 */

const { discoverLS, grpcCall } = require('../lib/core/ls-discovery');

function ts() {
    return new Date().toISOString().slice(11, 23);
}

async function main() {
    console.log('==================================================');
    console.log('  CopyTrajectory API 探测');
    console.log('==================================================\n');

    const ls = discoverLS();
    if (!ls) {
        console.error('LS 未找到');
        process.exit(1);
    }
    console.log(`[${ts()}] LS: port=${ls.port} pid=${ls.pid}\n`);

    // Step 1: 获取一个已有的对话 ID
    console.log('--- Step 1: 获取对话列表 ---');
    const listResult = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
    const summaries = listResult.data?.trajectorySummaries || {};
    const ids = Object.keys(summaries);
    if (ids.length === 0) {
        console.error('没有任何对话，无法测试');
        process.exit(1);
    }
    // 选一个 stepCount 最小的对话（减少复制开销）
    const sorted = ids
        .map(id => ({ id, stepCount: summaries[id].stepCount || 0, title: summaries[id].summary || '' }))
        .sort((a, b) => a.stepCount - b.stepCount);
    const target = sorted[0];
    console.log(`  选择对话: ${target.id}`);
    console.log(`  标题: "${target.title}", steps: ${target.stepCount}\n`);

    // Step 2: 尝试不同的参数组合
    const testCases = [
        {
            label: '空 body',
            body: {},
        },
        {
            label: '只有 cascadeId',
            body: { cascadeId: target.id },
        },
        {
            label: '只有 trajectoryId',
            body: { trajectoryId: target.id },
        },
        {
            label: '只有 id',
            body: { id: target.id },
        },
        {
            label: 'cascadeId + trajectoryId 相同',
            body: { cascadeId: target.id, trajectoryId: target.id },
        },
        {
            label: 'sourceCascadeId',
            body: { sourceCascadeId: target.id },
        },
        {
            label: 'sourceTrajectoryId',
            body: { sourceTrajectoryId: target.id },
        },
        {
            label: 'source (嵌套)',
            body: { source: { cascadeId: target.id } },
        },
        {
            label: 'trajectory (嵌套)',
            body: { trajectory: { cascadeId: target.id } },
        },
        {
            label: 'cascadeId + newTitle',
            body: { cascadeId: target.id, newTitle: 'Copy Test' },
        },
    ];

    console.log('--- Step 2: 参数探测 ---\n');

    for (const tc of testCases) {
        console.log(`  [${tc.label}]`);
        console.log(`    请求: ${JSON.stringify(tc.body)}`);
        try {
            const result = await grpcCall(ls.port, ls.csrf, 'CopyTrajectory', tc.body, 10000);
            console.log(`    状态: ${result.status}`);
            const dataStr = JSON.stringify(result.data);
            if (dataStr.length > 500) {
                console.log(`    响应: ${dataStr.slice(0, 500)}... (${dataStr.length} 字符)`);
            } else {
                console.log(`    响应: ${dataStr}`);
            }

            // 如果成功返回了 cascadeId，说明复制成功
            if (result.data?.cascadeId || result.data?.newCascadeId || result.data?.trajectoryId) {
                console.log(`    >>> 成功! 返回了有效的 ID <<<`);
            }
        } catch (err) {
            console.log(`    错误: ${err.message}`);
        }
        console.log('');
    }

    console.log(`[${ts()}] 探测完成`);
}

main().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
