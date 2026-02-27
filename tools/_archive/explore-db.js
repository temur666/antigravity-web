#!/usr/bin/env node
/**
 * explore-db.js — 探索 Antigravity 的 vscdb 数据库查找对话数据
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const homeDir = process.env.USERPROFILE || '';

async function main() {
    console.log('\n🔬 Antigravity DB Explorer\n');

    // 1) 全局 state.vscdb
    const globalDb = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');

    console.log('═'.repeat(70));
    console.log(`1. 全局 state.vscdb (${(fs.statSync(globalDb).size / 1024).toFixed(0)}KB)`);
    console.log('─'.repeat(70));

    const db = new Database(globalDb, { readonly: true });

    // 查看表结构
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('  Tables:', tables.map(t => t.name));

    for (const table of tables) {
        const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get();
        console.log(`\n  Table "${table.name}" (${count.cnt} rows):`);

        const cols = db.prepare(`PRAGMA table_info("${table.name}")`).all();
        console.log(`    Columns: ${cols.map(c => c.name).join(', ')}`);

        // 查找 conversation/chat/jetski 相关的 key
        if (cols.some(c => c.name === 'key')) {
            const chatKeys = db.prepare(`SELECT key, LENGTH(value) as vlen FROM "${table.name}" WHERE key LIKE '%convers%' OR key LIKE '%chat%' OR key LIKE '%jetski%' OR key LIKE '%thread%' OR key LIKE '%agent%' OR key LIKE '%cascade%' OR key LIKE '%history%'`).all();
            if (chatKeys.length > 0) {
                console.log('\n  ⭐ 对话相关的 keys:');
                for (const row of chatKeys) {
                    console.log(`    KEY: ${row.key}  VALUE_LEN: ${row.vlen}`);
                    // 获取 value 的前500字符
                    const valRow = db.prepare(`SELECT SUBSTR(value, 1, 1000) as val FROM "${table.name}" WHERE key = ?`).get(row.key);
                    if (valRow) {
                        console.log(`    VALUE (前1000字): ${valRow.val.substring(0, 1000)}`);
                    }
                }
            }

            // 输出所有 key（过滤掉太长的）
            const allKeys = db.prepare(`SELECT key, LENGTH(value) as vlen FROM "${table.name}" ORDER BY key`).all();
            console.log(`\n  所有 keys (${allKeys.length}个):`);
            for (const row of allKeys) {
                const isInteresting = row.key.toLowerCase().includes('convers') ||
                    row.key.toLowerCase().includes('chat') ||
                    row.key.toLowerCase().includes('jetski') ||
                    row.key.toLowerCase().includes('agent') ||
                    row.key.toLowerCase().includes('thread');
                console.log(`    ${isInteresting ? '⭐' : '  '} ${row.key} (${row.vlen}B)`);
            }
        }
    }
    db.close();

    // 2) 查看 antigravity-web 的 workspaceStorage
    console.log('\n\n' + '═'.repeat(70));
    console.log('2. antigravity-web workspaceStorage');
    console.log('─'.repeat(70));

    const wsDb = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'workspaceStorage', 'd78341970754565d91fb44a1760437c7', 'state.vscdb');

    if (fs.existsSync(wsDb)) {
        const db2 = new Database(wsDb, { readonly: true });
        const tables2 = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

        for (const table of tables2) {
            const count = db2.prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get();
            console.log(`\n  Table "${table.name}" (${count.cnt} rows):`);

            if (table.name === 'ItemTable') {
                const allKeys = db2.prepare(`SELECT key, LENGTH(value) as vlen FROM "${table.name}" ORDER BY key`).all();
                console.log(`  所有 keys (${allKeys.length}个):`);
                for (const row of allKeys) {
                    const isInteresting = row.key.toLowerCase().includes('convers') ||
                        row.key.toLowerCase().includes('chat') ||
                        row.key.toLowerCase().includes('jetski') ||
                        row.key.toLowerCase().includes('agent') ||
                        row.key.toLowerCase().includes('thread');
                    console.log(`    ${isInteresting ? '⭐' : '  '} ${row.key} (${row.vlen}B)`);
                    if (isInteresting) {
                        const valRow = db2.prepare(`SELECT SUBSTR(value, 1, 2000) as val FROM "${table.name}" WHERE key = ?`).get(row.key);
                        if (valRow) {
                            console.log(`      VALUE (前2000字): ${valRow.val}`);
                        }
                    }
                }
            }
        }
        db2.close();
    }

    // 3) 查看最大的 workspaceStorage (可能有更多对话数据)
    console.log('\n\n' + '═'.repeat(70));
    console.log('3. 最大的 workspaceStorage DB');
    console.log('─'.repeat(70));

    const wsDir = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'workspaceStorage');
    const wsDirs = fs.readdirSync(wsDir);

    const dbSizes = [];
    for (const d of wsDirs) {
        const dbPath = path.join(wsDir, d, 'state.vscdb');
        if (fs.existsSync(dbPath)) {
            const size = fs.statSync(dbPath).size;
            if (size > 30000) { // 只关注大文件
                dbSizes.push({ dir: d, size, path: dbPath });
            }
        }
    }
    dbSizes.sort((a, b) => b.size - a.size);

    console.log('  大数据库:');
    for (const item of dbSizes.slice(0, 5)) {
        // 读取 workspace.json 获取项目名
        const wsJson = path.join(wsDir, item.dir, 'workspace.json');
        let folder = '';
        if (fs.existsSync(wsJson)) {
            const data = JSON.parse(fs.readFileSync(wsJson, 'utf8'));
            folder = data.folder || '';
        }
        console.log(`\n  📁 ${item.dir} (${(item.size / 1024).toFixed(0)}KB) — ${folder}`);

        const db3 = new Database(item.path, { readonly: true });
        try {
            const chatKeys = db3.prepare(`SELECT key, LENGTH(value) as vlen FROM ItemTable WHERE key LIKE '%convers%' OR key LIKE '%chat%' OR key LIKE '%jetski%' OR key LIKE '%thread%' OR key LIKE '%agent%'`).all();
            if (chatKeys.length > 0) {
                console.log('  ⭐ 对话相关 keys:');
                for (const row of chatKeys) {
                    console.log(`    ${row.key} (${row.vlen}B)`);
                    if (row.vlen < 5000) {
                        const valRow = db3.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get(row.key);
                        console.log(`    VALUE: ${valRow.value.substring(0, 2000)}`);
                    }
                }
            }
        } catch { }
        db3.close();
    }

    console.log('\n' + '═'.repeat(70));
    console.log('🏁 完成\n');
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
