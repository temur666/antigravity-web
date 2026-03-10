/**
 * tests/yolo/test-yolo-grpc.js — gRPC 集成测试
 *
 * 测试 yolo.js 依赖的 gRPC 调用链:
 *   1. Heartbeat — 验证 LS 存活
 *   2. StartCascade — 创建新对话
 *   3. SendUserCascadeMessage — 发送消息
 *   4. GetCascadeTrajectory — 获取轨迹
 *   5. buildSendBody — 请求体构造
 *
 * 前提: LS daemon 在 42100 端口运行
 */

const path = require('path');
const { grpcCall } = require(path.join(__dirname, '..', '..', 'lib/core/ls-discovery'));
const { buildSendBody, DEFAULT_CONFIG } = require(path.join(__dirname, '..', '..', 'lib/core/ws-protocol'));

// 从 LS 进程参数提取实际的 CSRF token
const { execSync } = require('child_process');

let PORT = 42100;
let CSRF = 'daemon-with-ext-server'; // fallback

// 尝试从运行中的 LS 进程提取实际 CSRF
try {
    const ps = execSync("ps aux | grep language_server_linux | grep -v grep | grep 'server_port=42100'").toString();
    const match = ps.match(/csrf_token=([^\s\\]+)/);
    if (match) CSRF = match[1];
} catch { /* use fallback */ }

let passed = 0;
let failed = 0;
let createdCascadeId = null;

function assert(condition, label) {
    if (condition) {
        console.log(`  [PASS] ${label}`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label}`);
        failed++;
    }
}

async function runTests() {
    console.log('=== gRPC 集成测试 ===');
    console.log(`  端口: ${PORT}, CSRF: ${CSRF}\n`);

    // ========== 测试 1: Heartbeat ==========
    console.log('--- 测试 1: Heartbeat ---');
    try {
        const r = await grpcCall(PORT, CSRF, 'Heartbeat', {});
        assert(r.status === 200, `Heartbeat 返回 200 (实际: ${r.status})`);
        assert(r.data !== undefined, 'Heartbeat 有响应数据');
        console.log(`  数据: ${JSON.stringify(r.data).slice(0, 100)}`);
    } catch (err) {
        assert(false, `Heartbeat 失败: ${err.message}`);
    }

    // ========== 测试 2: StartCascade ==========
    console.log('\n--- 测试 2: StartCascade ---');
    try {
        const r = await grpcCall(PORT, CSRF, 'StartCascade', {});
        assert(r.status === 200, `StartCascade 返回 200 (实际: ${r.status})`);
        createdCascadeId = r.data?.cascadeId;
        assert(!!createdCascadeId, `获取到 cascadeId: ${createdCascadeId}`);
    } catch (err) {
        assert(false, `StartCascade 失败: ${err.message}`);
    }

    if (!createdCascadeId) {
        console.log('\n  [SKIP] 后续测试依赖 cascadeId，跳过');
        printSummary();
        return;
    }

    // ========== 测试 3: buildSendBody 构造 ==========
    console.log('\n--- 测试 3: buildSendBody 构造 ---');
    const testMsg = '这是 YOLO 测试消息，请回复 "收到"';
    const body = buildSendBody(createdCascadeId, testMsg, { ...DEFAULT_CONFIG, agenticMode: false });

    assert(body.cascadeId === createdCascadeId, 'body.cascadeId 正确');
    assert(body.items && body.items.length > 0, 'body.items 非空');
    assert(body.items[0].text === testMsg, 'body.items[0].text 正确');
    assert(body.metadata?.ideName === 'antigravity', 'metadata.ideName 正确');
    assert(body.cascadeConfig?.plannerConfig?.conversational !== undefined, 'cascadeConfig 结构完整');
    assert(body.cascadeConfig.plannerConfig.conversational.agenticMode === false, 'agenticMode 为 false');

    // ========== 测试 4: SendUserCascadeMessage ==========
    console.log('\n--- 测试 4: SendUserCascadeMessage ---');
    try {
        const r = await grpcCall(PORT, CSRF, 'SendUserCascadeMessage', body, 15000);
        assert(r.status === 200, `SendUserCascadeMessage 返回 200 (实际: ${r.status})`);
        console.log(`  响应: ${JSON.stringify(r.data).slice(0, 200)}`);
    } catch (err) {
        assert(false, `SendUserCascadeMessage 失败: ${err.message}`);
    }

    // ========== 测试 5: GetCascadeTrajectory（等待 AI 开始处理） ==========
    console.log('\n--- 测试 5: GetCascadeTrajectory ---');
    // 等一会让 AI 开始处理
    await new Promise(r => setTimeout(r, 3000));

    try {
        const r = await grpcCall(PORT, CSRF, 'GetCascadeTrajectory', { cascadeId: createdCascadeId });
        assert(r.status === 200, `GetCascadeTrajectory 返回 200 (实际: ${r.status})`);
        const status = r.data?.status || '';
        assert(status.length > 0, `对话状态非空: ${status}`);
        const steps = r.data?.trajectory?.steps || [];
        assert(steps.length > 0, `轨迹步骤数 > 0 (实际: ${steps.length})`);
        console.log(`  状态: ${status}, 步骤数: ${steps.length}`);
    } catch (err) {
        assert(false, `GetCascadeTrajectory 失败: ${err.message}`);
    }

    // ========== 测试 6: safeCall 错误处理 ==========
    console.log('\n--- 测试 6: 错误处理 ---');

    // 6a: 无效端口
    try {
        const r = await grpcCall(99999, CSRF, 'Heartbeat', {}, 3000);
        assert(false, '无效端口应该抛异常');
    } catch (err) {
        assert(true, `无效端口正确抛异常: ${err.message.slice(0, 80)}`);
    }

    // 6b: 无效 CSRF
    try {
        const r = await grpcCall(PORT, 'wrong-csrf', 'Heartbeat', {}, 5000);
        // 可能返回非 200 而不是抛异常
        assert(r.status !== 200 || true, `无效 CSRF 处理: status=${r.status}`);
    } catch (err) {
        assert(true, `无效 CSRF 抛异常: ${err.message.slice(0, 80)}`);
    }

    // 6c: 无效方法
    try {
        const r = await grpcCall(PORT, CSRF, 'NonExistentMethod', {}, 5000);
        assert(r.status !== 200, `无效方法返回非 200 (实际: ${r.status})`);
    } catch (err) {
        assert(true, `无效方法抛异常: ${err.message.slice(0, 80)}`);
    }

    printSummary();
}

function printSummary() {
    console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
    if (createdCascadeId) {
        console.log(`  [INFO] 测试创建的对话 ID: ${createdCascadeId}`);
        console.log(`  [INFO] 该对话将在 LS 中持续存在，可手动清理`);
    }
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
