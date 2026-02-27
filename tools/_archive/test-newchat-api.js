/**
 * test-newchat-api.js — 测试 StartCascade + SendUserCascadeMessage
 */
const https = require('https');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const csrf = process.env.CSRF_TOKEN || 'YOUR_CSRF_TOKEN_HERE';
const port = '60432';
const base = `/exa.language_server_pb.LanguageServerService`;

function postStream(method, body) {
    return new Promise((resolve, reject) => {
        const d = JSON.stringify(body);
        const req = https.request({
            hostname: '127.0.0.1', port,
            path: `${base}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(d),
                'x-codeium-csrf-token': csrf,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
        }, (res) => {
            console.log(`  Status: ${res.statusCode}`);
            console.log(`  Headers: ${JSON.stringify(res.headers).substring(0, 300)}`);

            let chunks = [];
            res.on('data', c => {
                chunks.push(c.toString());
                console.log(`  [chunk ${chunks.length}]: ${c.toString().substring(0, 200)}`);
            });
            res.on('end', () => {
                resolve({ status: res.statusCode, body: chunks.join('') });
            });
        });
        req.on('error', e => {
            console.log(`  Error: ${e.message}`);
            resolve({ status: 0, body: '', error: e.message });
        });
        req.write(d);
        req.end();
    });
}

async function main() {
    // Test 1: StartCascade with various params
    console.log('═══ Test 1: StartCascade 参数探索 ═══\n');

    const startTests = [
        ['empty', {}],
        ['workspacePath', { workspacePath: '/home/tiemuer' }],
        ['with init message', { userMessage: 'hello from API test' }],
        ['with items', { items: [{ text: 'hello from API test' }] }],
    ];

    let newCascadeId = null;
    for (const [label, body] of startTests) {
        console.log(`\n--- StartCascade: ${label} ---`);
        const r = await postStream('StartCascade', body);
        console.log(`  Full body: ${r.body.substring(0, 500)}`);

        // 提取 cascadeId
        try {
            const parsed = JSON.parse(r.body);
            if (parsed.cascadeId) {
                newCascadeId = parsed.cascadeId;
                console.log(`  ✅ Got cascadeId: ${newCascadeId}`);
            }
        } catch { }
    }

    if (!newCascadeId) {
        console.log('\n❌ 没有获取到 cascadeId');
        return;
    }

    // Test 2: SendUserCascadeMessage with streaming
    console.log('\n\n═══ Test 2: SendUserCascadeMessage (streaming) ═══\n');

    const sendTests = [
        ['cascadeId only', { cascadeId: newCascadeId }],
        ['with userResponse', { cascadeId: newCascadeId, userResponse: 'What is 2+2?' }],
        ['with userInput obj', { cascadeId: newCascadeId, userInput: { userResponse: 'What is 2+2?' } }],
        ['with items array', { cascadeId: newCascadeId, items: [{ text: 'What is 2+2?' }] }],
    ];

    for (const [label, body] of sendTests) {
        console.log(`\n--- SendUserCascadeMessage: ${label} ---`);
        console.log(`  Body: ${JSON.stringify(body)}`);
        const r = await postStream('SendUserCascadeMessage', body);
        console.log(`  Full body: ${(r.body || '').substring(0, 500)}`);
        if (r.status === 200 && r.body.length > 10) {
            console.log('  ✅ Got response! Breaking...');
            break;
        }
    }

    // Test 3: 也试试 StreamCascadeReactiveUpdates 看 new cascade 的状态
    console.log('\n\n═══ Test 3: GetCascadeTrajectory 验证 ═══\n');
    const trajResult = await postStream('GetCascadeTrajectory', { cascadeId: newCascadeId });
    console.log(`  Full body: ${trajResult.body.substring(0, 1000)}`);

    console.log('\n✅ 完成');
}

main().catch(err => console.error('Fatal:', err));
