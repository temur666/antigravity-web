/**
 * 测试通过本地 Antigravity 端口转发访问远程 SSH 对话
 * 
 * 思路: Antigravity 主进程 (PID 23024) 监听了多个端口
 *       其中一些可能是转发到远程 LS 的
 */
const https = require('https');
const { execSync } = require('child_process');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SERVICE = '/exa.language_server_pb.LanguageServerService';

function post(port, method, body, csrf) {
    return new Promise((resolve, reject) => {
        const d = JSON.stringify(body);
        const req = https.request({
            hostname: '127.0.0.1', port: Number(port),
            path: `${SERVICE}/${method}`, method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(d),
                'x-codeium-csrf-token': csrf,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
            timeout: 5000,
        }, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.on('error', e => resolve({ status: 0, body: '', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
        req.write(d);
        req.end();
    });
}

async function main() {
    // 1. 获取本地 LS 的 CSRF (已知能用)
    const localCsrf = execSync(
        `wmic process where "name='language_server_windows_x64.exe'" get CommandLine /format:list`,
        { encoding: 'utf-8', windowsHide: true }
    );
    const csrfMatch = localCsrf.match(/--csrf_token\s+([a-f0-9-]+)/i);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    console.log('本地 CSRF:', csrf.substring(0, 12) + '...');

    // 2. 找 Antigravity 主进程监听的所有端口
    const netstat = execSync('netstat -ano | findstr "LISTENING"', { encoding: 'utf-8', windowsHide: true });

    // PID 23024 (Antigravity 主进程) 的端口
    const antigravityPorts = [];
    for (const line of netstat.split('\n')) {
        const m = line.match(/127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+23024/);
        if (m) antigravityPorts.push(m[1]);
    }
    console.log(`\nAntigravity 主进程 (PID:23024) 端口: ${antigravityPorts.join(', ')}`);

    // 3. 一个 SSH 对话 ID
    const sshConvId = '8b4af5b0-0b1b-4bee-a0f4-0ef27e193fb4';

    // 4. 先试本地 LS 端口 (应该 not found)
    console.log('\n=== 本地 LS (51627) ===');
    const local = await post('51627', 'GetCascadeTrajectory', { cascadeId: sshConvId }, csrf);
    console.log(`  Status: ${local.status}, Body: ${local.body.substring(0, 100)}`);

    // 5. 逐个试 Antigravity 主进程端口
    console.log(`\n=== 扫描 ${antigravityPorts.length} 个 Antigravity 端口 ===`);
    for (const port of antigravityPorts) {
        // 先试 GetUnleashData 看是不是 gRPC
        const test = await post(port, 'GetUnleashData', {}, csrf);
        if (test.status === 200) {
            console.log(`  Port ${port}: ✅ gRPC 响应 200`);
            // 试获取 SSH 对话
            const r = await post(port, 'GetCascadeTrajectory', { cascadeId: sshConvId }, csrf);
            console.log(`    GetCascadeTrajectory: status=${r.status} body=${r.body.substring(0, 100)}`);
            if (r.status === 200 && r.body.includes('trajectory')) {
                console.log(`    🎉 找到 SSH 对话!`);
            }
        } else if (test.error) {
            // skip silently
        } else {
            console.log(`  Port ${port}: status=${test.status} ${test.body.substring(0, 60)}`);
        }
    }
}

main().catch(e => console.error('Fatal:', e));
