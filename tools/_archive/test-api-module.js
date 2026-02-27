#!/usr/bin/env node
/**
 * test-api-module.js — 测试 lib/api.js 模块
 *
 * Usage: node tools/test-api-module.js
 *
 * 流程:
 *   1. init() — 自动发现端口 + 获取 CSRF
 *   2. startCascade() — 创建新对话
 *   3. getTrajectory() — 验证对话已创建
 *   4. getModelConfigs() — 获取可用模型
 */
const api = require('../lib/api');

async function main() {
    console.log('═══ lib/api.js 模块测试 ═══\n');

    // 1. 初始化
    console.log('--- Step 1: init() ---');
    try {
        await api.init();
        const status = api.getStatus();
        console.log('状态:', JSON.stringify(status, null, 2));
    } catch (e) {
        console.log(`❌ 初始化失败: ${e.message}`);
        console.log('   请确保 IDE 以 --remote-debugging-port=9000 启动');
        console.log('   并在 IDE 中做一个操作来触发网络请求');
        return;
    }

    // 2. 创建新对话
    console.log('\n--- Step 2: startCascade() ---');
    let cascadeId;
    try {
        const result = await api.startCascade();
        cascadeId = result.cascadeId;
        console.log(`✅ 新对话: ${cascadeId}`);
    } catch (e) {
        console.log(`❌ 创建对话失败: ${e.message}`);
        return;
    }

    // 3. 验证
    console.log('\n--- Step 3: getTrajectory() ---');
    try {
        const traj = await api.getTrajectory(cascadeId);
        console.log(`✅ Trajectory 获取成功:`);
        console.log(`   cascadeId: ${traj.trajectory?.cascadeId}`);
        console.log(`   type: ${traj.trajectory?.trajectoryType}`);
        console.log(`   status: ${traj.status}`);
        console.log(`   steps: ${traj.trajectory?.steps?.length || 0}`);
        console.log(`   workspace: ${traj.trajectory?.metadata?.workspaces?.[0]?.workspaceFolderAbsoluteUri || 'N/A'}`);
    } catch (e) {
        console.log(`❌ 获取 trajectory 失败: ${e.message}`);
    }

    // 4. 获取模型配置
    console.log('\n--- Step 4: getModelConfigs() ---');
    try {
        const configs = await api.getModelConfigs();
        console.log('✅ 模型配置:', JSON.stringify(configs).substring(0, 500));
    } catch (e) {
        console.log(`⚠️ 获取模型配置失败: ${e.message}`);
    }

    // 5. 测试 sendMessage (不等待回复)
    console.log('\n--- Step 5: sendMessage() (不等待回复) ---');
    try {
        const sendResult = await api.sendMessage(cascadeId, 'Hello from API test!');
        console.log(`发送结果: status=${sendResult.status}, body=${JSON.stringify(sendResult.data).substring(0, 200)}`);
    } catch (e) {
        console.log(`⚠️ 发送消息: ${e.message}`);
        console.log('   (socket hang up 是预期的 — streaming API 的已知行为)');
    }

    // 6. 再次获取 trajectory 验证消息是否到达
    console.log('\n--- Step 6: 再次 getTrajectory() 验证 ---');
    try {
        // 等一下让消息处理
        await new Promise(r => setTimeout(r, 3000));
        const traj2 = await api.getTrajectory(cascadeId);
        const steps = traj2.trajectory?.steps || [];
        console.log(`✅ 步骤数: ${steps.length}`);
        console.log(`   状态: ${traj2.status}`);
        for (const step of steps.slice(0, 5)) {
            const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
            let preview = '';
            if (type === 'USER_INPUT') {
                preview = step.userInput?.userResponse || step.userInput?.items?.[0]?.text || '';
            } else if (type === 'PLANNER_RESPONSE') {
                const pr = step.plannerResponse || {};
                preview = (pr.reply || pr.text || pr.content || '').substring(0, 100);
            }
            console.log(`   [${type}] ${preview}`);
        }
    } catch (e) {
        console.log(`⚠️ 获取 trajectory 失败: ${e.message}`);
    }

    console.log('\n✅ 测试完成');
}

main().catch(err => console.error('Fatal:', err));
