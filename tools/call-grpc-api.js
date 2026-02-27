/**
 * call-grpc-api.js — 直接调用本地 gRPC API 获取对话内容
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getConversations } = require('../lib/conversations');

const outputFile = path.join(__dirname, 'grpc-trajectory.txt');

// 忽略自签名证书
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function postJSON(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            rejectUnauthorized: false,
        };
        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                resolve({ status: res.statusCode, headers: res.headers, body: responseData });
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    const lines = [];
    const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

    // 获取对话列表
    const result = getConversations();
    const latest = result.conversations[0];
    log('最新对话:');
    log(JSON.stringify(latest, null, 2));
    log('');

    // 尝试不同端口
    const ports = [59513, 63243, 33071];

    for (const port of ports) {
        log(`\n━━━ 尝试端口 ${port} ━━━`);

        // 1. 先试 GetCascadeTrajectory
        try {
            const url = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory`;
            log(`POST ${url}`);
            log(`Body: {"cascadeId": "${latest.id}"}`);

            const res = await postJSON(url, { cascadeId: latest.id });
            log(`Status: ${res.status}`);
            log(`Content-Type: ${res.headers['content-type']}`);
            log(`Response (${res.body.length} bytes):`);

            if (res.body.length > 20000) {
                log(res.body.substring(0, 20000));
                log(`... [截断，总 ${res.body.length} 字符]`);
            } else {
                log(res.body);
            }
        } catch (e) {
            log(`❌ 失败: ${e.message}`);
        }

        // 2. 试其他可能的方法
        const methods = [
            'GetCascadeTrajectory',
            'GetTrajectory',
            'ListTrajectories',
            'GetConversation',
        ];

        for (const method of methods) {
            if (method === 'GetCascadeTrajectory') continue; // 已经试过
            try {
                const url = `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/${method}`;
                const res = await postJSON(url, { cascadeId: latest.id });
                if (res.status !== 404 && res.status !== 501) {
                    log(`\n${method}: Status ${res.status}`);
                    log(`Response: ${res.body.substring(0, 2000)}`);
                }
            } catch { }
        }
    }

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
}

main().catch(err => console.error('Fatal:', err));
