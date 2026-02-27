/**
 * 从远程 SSH 获取 LS 的 CSRF，然后在本地端口转发上验证
 */
const { execSync } = require('child_process');
const https = require('https');
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
        req.on('error', e => resolve({ status: 0, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
        req.write(d);
        req.end();
    });
}

async function main() {
    // 1. 从远程获取 LS 进程的 CSRF
    console.log('=== 获取远程 LS CSRF ===');
    let remoteOutput;
    try {
        remoteOutput = execSync(
            'ssh -T gcp-iap "ps aux | grep language_server | grep -v grep" 2>nul',
            { encoding: 'utf-8', timeout: 30000 }
        );
    } catch (e) {
        remoteOutput = e.stdout || '';
        console.log('SSH stderr (ignored):', (e.stderr || '').substring(0, 100));
    }

    console.log('远程进程输出:');
    const csrfs = [];
    for (const line of remoteOutput.split('\n')) {
        if (!line.trim()) continue;
        const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/i);
        if (csrfMatch) {
            csrfs.push(csrfMatch[1]);
            console.log(`  CSRF: ${csrfMatch[1].substring(0, 20)}...`);
        }
    }

    if (csrfs.length === 0) {
        console.log('❌ 未找到远程 CSRF');
        return;
    }

    // 2. 试本地返回 401 的端口 + 远程 CSRF
    const testPorts = ['36118', '46379'];
    const sshConvId = '8b4af5b0-0b1b-4bee-a0f4-0ef27e193fb4';

    for (const csrf of csrfs) {
        console.log(`\n=== 测试 CSRF: ${csrf.substring(0, 12)}... ===`);
        for (const port of testPorts) {
            const test = await post(port, 'GetUnleashData', {}, csrf);
            if (test.status === 200) {
                console.log(`  Port ${port}: ✅ gRPC 验证通过!`);
                const r = await post(port, 'GetCascadeTrajectory', { cascadeId: sshConvId }, csrf);
                console.log(`    GetCascadeTrajectory: status=${r.status}`);
                if (r.status === 200) {
                    try {
                        const data = JSON.parse(r.body);
                        console.log(`    🎉 SSH 对话获取成功! Steps: ${data.trajectory?.steps?.length}`);
                    } catch {
                        console.log(`    Body: ${r.body.substring(0, 200)}`);
                    }
                } else {
                    console.log(`    Body: ${(r.body || '').substring(0, 100)}`);
                }
            } else {
                console.log(`  Port ${port}: ${test.status} ${(test.body || test.error || '').substring(0, 60)}`);
            }
        }
    }
}

main().catch(e => console.error('Fatal:', e));
