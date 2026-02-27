/**
 * dump-auth.js — 提取认证相关数据，分析云端 API 调用的可能性
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'auth-dump.txt');
const dbPath = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');

const lines = [];
const log = (...args) => { const l = args.join(' '); console.log(l); lines.push(l); };

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
    const authKeys = [
        'antigravityUnifiedStateSync.oauthToken',
        'antigravityAuthStatus',
        'antigravity.profileUrl',
        'antigravityAnalytics.clearcutBuffer',
        'antigravityUnifiedStateSync.userStatus',
        'google.antigravity',
        'google.antigravity-remote-openssh',
    ];

    for (const key of authKeys) {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
        if (!row) { log(`\n━━━ ${key}: <不存在> ━━━`); continue; }

        log(`\n━━━ ${key} (${row.value.length} bytes) ━━━`);

        // 尝试 JSON 解析
        try {
            const parsed = JSON.parse(row.value);
            log(JSON.stringify(parsed, null, 2));
        } catch {
            // 尝试 base64 解码
            if (/^[A-Za-z0-9+/=]+$/.test(row.value.trim())) {
                log('[base64 encoded]');
                try {
                    const decoded = Buffer.from(row.value, 'base64').toString('utf-8');
                    // 检查是否是可读文本
                    const readable = [...decoded].every(c => c.charCodeAt(0) >= 0x20 || '\n\r\t'.includes(c));
                    if (readable) {
                        log(decoded.substring(0, 3000));
                    } else {
                        log(`[binary, ${decoded.length} bytes decoded]`);
                    }
                } catch {
                    log(row.value.substring(0, 1000));
                }
            } else {
                log(row.value.substring(0, 3000));
            }
        }
    }

    // 搜索可能包含 API 端点的 key
    log('\n\n━━━ 搜索可能的 API 端点 / URL ━━━');
    const allRows = db.prepare('SELECT key, value FROM ItemTable').all();
    for (const row of allRows) {
        const val = typeof row.value === 'string' ? row.value : '';
        // 搜索包含 googleapis, cloudfront, api, endpoint 的值
        if (/googleapis|autopush|cloudfront|trajectory|jetski.*api|stateSync.*api/i.test(val)) {
            log(`\nKEY: ${row.key}`);
            log(`VALUE (前 500): ${val.substring(0, 500)}`);
        }
    }

    // 搜索 secret key
    log('\n\n━━━ Secret / Credential keys ━━━');
    const secretRows = allRows.filter(r => /secret|credential|token|auth/i.test(r.key));
    for (const row of secretRows) {
        log(`\nKEY: ${row.key} (${row.value.length} bytes)`);
        try {
            const parsed = JSON.parse(row.value);
            log(JSON.stringify(parsed, null, 2));
        } catch {
            log(row.value.substring(0, 1000));
        }
    }

} finally {
    db.close();
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
console.log(`\n✅ 已保存到: ${outputFile}`);
