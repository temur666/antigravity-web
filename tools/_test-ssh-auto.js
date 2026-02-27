/**
 * 测试 SSH 自动启动 → 等待 LS → 获取对话 的完整流程
 */
const { execSync, spawn } = require('child_process');
const api = require('../lib/api');
const svc = require('../lib/service');

const SSH_REMOTE = 'ssh-remote+gcp-iap';
const SSH_PATH = '/home/tiemuer';
const POLL_INTERVAL = 2000;
const MAX_WAIT = 60000;

function getSSHProcess() {
    const eps = api.discoverFromProcess();
    // SSH LS 是第二个进程（本地只有一个时，新出现的就是 SSH 的）
    // 更可靠的判断：看哪个是新 PID
    return eps;
}

async function main() {
    // Step 1: 当前状态
    console.log('=== Step 1: 当前 LS 进程 ===');
    const before = api.discoverFromProcess();
    console.log(`发现 ${before.length} 个 LS 进程:`, before.map(e => `PID:${e.pid}`));
    const beforePids = new Set(before.map(e => e.pid));

    // Step 2: 启动 SSH 窗口
    console.log('\n=== Step 2: 启动 SSH 窗口 ===');
    const cmd = `antigravity --remote ${SSH_REMOTE} ${SSH_PATH}`;
    console.log(`执行: ${cmd}`);

    const child = spawn('antigravity', ['--remote', SSH_REMOTE, SSH_PATH], {
        detached: true,
        stdio: 'ignore',
        shell: true,  // 需要 shell 来解析 .cmd
    });
    child.unref();
    console.log(`已启动 (child PID: ${child.pid})`);

    // Step 3: 轮询等待新 LS 进程出现
    console.log('\n=== Step 3: 等待 SSH LS 出现 ===');
    const startTime = Date.now();
    let sshEp = null;

    while (Date.now() - startTime < MAX_WAIT) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

        const current = api.discoverFromProcess();
        const newEps = current.filter(e => !beforePids.has(e.pid));

        console.log(`  [${elapsed}s] 进程数: ${current.length}, 新增: ${newEps.length}`);

        if (newEps.length > 0) {
            sshEp = newEps[0];
            console.log(`  ✅ 新 LS 出现! PID=${sshEp.pid} csrf=${sshEp.csrf.substring(0, 12)}... ports=${sshEp.allPorts}`);
            break;
        }
    }

    if (!sshEp) {
        console.log(`\n❌ 超时 (${MAX_WAIT / 1000}s)，SSH LS 未出现`);
        return;
    }

    // Step 4: 验证 gRPC 端口
    console.log('\n=== Step 4: 验证 gRPC 端口 ===');
    let grpcPort = null;
    for (const port of sshEp.allPorts) {
        const ok = await api.verifyEndpoint(port, sshEp.csrf);
        console.log(`  Port ${port}: ${ok ? '✅ gRPC' : '❌'}`);
        if (ok && !grpcPort) grpcPort = port;
    }

    if (!grpcPort) {
        console.log('❌ 未找到 gRPC 端口');
        return;
    }

    // Step 5: 注册端口并获取 SSH 对话
    console.log('\n=== Step 5: 获取 SSH 对话 ===');
    api.registerEndpoint(grpcPort, sshEp.csrf, { windowTitle: `PID:${sshEp.pid}` });

    const list = svc.listConversations();
    const sshConv = list.conversations.find(c => c.workspace && c.workspace.includes('SSH'));

    if (!sshConv) {
        console.log('❌ 没找到 SSH 对话');
        return;
    }

    console.log(`尝试获取: "${sshConv.title}" (${sshConv.id})`);

    try {
        const r = await api.getTrajectory(sshConv.id, { port: grpcPort });
        console.log(`✅ 成功! Steps: ${r.trajectory?.steps?.length}`);
    } catch (e) {
        console.log(`❌ 失败: ${e.message.substring(0, 100)}`);
    }

    console.log('\n=== 完成 ===');
}

main().catch(e => console.error('Fatal:', e));
