/**
 * dump-latest.js — 读取最新一条对话的原始数据并保存到文件
 * 
 * Usage: node tools/dump-latest.js
 * Output: tools/latest-conversation-dump.txt
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { getConversations, getDbPath } = require('../lib/conversations');

const outputFile = path.join(__dirname, 'latest-conversation-dump.txt');

function main() {
    const lines = [];
    const log = (...args) => {
        const line = args.join(' ');
        console.log(line);
        lines.push(line);
    };

    log('='.repeat(80));
    log('Antigravity 最新对话原始数据转储');
    log('时间:', new Date().toISOString());
    log('='.repeat(80));
    log('');

    // 1. 获取对话列表
    const result = getConversations();
    if (result.error) {
        log('❌ 错误:', result.error);
        fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
        return;
    }

    log(`总对话数: ${result.total}`);
    log('');

    if (result.conversations.length === 0) {
        log('没有找到任何对话');
        fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
        return;
    }

    // 2. 获取最新一条
    const latest = result.conversations[0];
    log('━'.repeat(80));
    log('最新对话信息:');
    log('━'.repeat(80));
    log(JSON.stringify(latest, null, 2));
    log('');

    // 3. 打开数据库，搜索所有包含该 UUID 的 key
    const dbPath = getDbPath();
    log(`数据库路径: ${dbPath}`);
    log('');

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    try {
        // 3a. 列出所有 key
        const allKeys = db.prepare('SELECT key FROM ItemTable').all().map(r => r.key);
        log(`数据库 ItemTable 总条目数: ${allKeys.length}`);
        log('');

        // 3b. 搜索包含该 UUID 的 key
        const uuid = latest.id;
        const matchingKeys = allKeys.filter(k => k.includes(uuid));
        log(`━━━ 包含 UUID "${uuid}" 的 key (${matchingKeys.length} 个) ━━━`);
        for (const key of matchingKeys) {
            const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
            const val = row ? row.value : '<null>';
            log('');
            log(`KEY: ${key}`);
            log(`VALUE 类型: ${typeof val}`);
            log(`VALUE 长度: ${typeof val === 'string' ? val.length : 'N/A'}`);
            // 打印内容 (截断超长内容)
            if (typeof val === 'string') {
                if (val.length > 50000) {
                    log(`VALUE (前 50000 字符):`);
                    log(val.substring(0, 50000));
                    log(`... [截断，总长度 ${val.length}]`);
                } else {
                    log(`VALUE:`);
                    log(val);
                }
            }
        }
        log('');

        // 3c. 也搜索一些通用的关键 key，可能包含所有对话数据
        const interestingPatterns = [
            'trajectorySummaries',
            'agentManagerInitState',
            'trajectory',
            'conversation',
            'chat',
            'jetski',
        ];

        // 查找与对话内容相关的 key（排除已经匹配的）
        const relatedKeys = allKeys.filter(k => {
            if (matchingKeys.includes(k)) return false;
            return interestingPatterns.some(p => k.toLowerCase().includes(p.toLowerCase()));
        });

        log(`━━━ 其他相关 key (${relatedKeys.length} 个) ━━━`);
        for (const key of relatedKeys) {
            const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
            const val = row ? row.value : '<null>';
            log('');
            log(`KEY: ${key}`);
            log(`VALUE 类型: ${typeof val}`);
            log(`VALUE 长度: ${typeof val === 'string' ? val.length : 'N/A'}`);
            // 只打印前 500 字符的预览
            if (typeof val === 'string') {
                if (val.length > 2000) {
                    log(`VALUE (预览前 2000 字符):`);
                    log(val.substring(0, 2000));
                    log(`... [截断，总长度 ${val.length}]`);
                } else {
                    log(`VALUE:`);
                    log(val);
                }
            }
        }
        log('');

        // 3d. 列出所有 key 名称（用于参考）
        log('━'.repeat(80));
        log(`所有 key 列表 (${allKeys.length} 个):`);
        log('━'.repeat(80));
        for (const key of allKeys.sort()) {
            const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
            const valLen = row && typeof row.value === 'string' ? row.value.length : 0;
            log(`  ${key}  (${valLen} bytes)`);
        }

    } finally {
        db.close();
    }

    // 保存到文件
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    console.log('');
    console.log(`✅ 已保存到: ${outputFile}`);
}

main();
