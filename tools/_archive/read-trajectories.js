#!/usr/bin/env node
/**
 * read-trajectories.js — 读取 Antigravity 的 trajectorySummaries 数据
 */

const Database = require('better-sqlite3');
const path = require('path');

const homeDir = process.env.USERPROFILE || '';
const globalDb = path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');

const db = new Database(globalDb, { readonly: true });

// 1) trajectorySummaries
console.log('═'.repeat(70));
console.log('1. antigravityUnifiedStateSync.trajectorySummaries');
console.log('─'.repeat(70));
const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
if (trajRow) {
    const raw = trajRow.value;
    console.log(`  Raw length: ${raw.length} bytes`);
    console.log(`  Type: ${typeof raw}`);

    // 检查是否是 base64
    if (typeof raw === 'string') {
        // 先尝试 JSON
        try {
            const parsed = JSON.parse(raw);
            console.log('  Format: JSON');
            console.log('  Preview:', JSON.stringify(parsed).substring(0, 2000));
        } catch {
            // 尝试 base64
            try {
                const buf = Buffer.from(raw, 'base64');
                console.log(`  Format: base64 (decoded to ${buf.length} bytes)`);
                // 看是否像 protobuf
                console.log('  First 100 bytes (hex):', buf.slice(0, 100).toString('hex'));
                // 尝试 utf-8
                const utf8 = buf.toString('utf-8');
                console.log('  UTF-8 preview:', utf8.substring(0, 500));
            } catch {
                console.log('  Format: raw text');
                console.log('  Preview:', raw.substring(0, 2000));
            }
        }
    } else {
        // 可能是 Buffer
        console.log('  Raw (buffer):', Buffer.from(raw).slice(0, 200).toString('hex'));
    }
}

// 2) jetskiStateSync.agentManagerInitState
console.log('\n' + '═'.repeat(70));
console.log('2. jetskiStateSync.agentManagerInitState');
console.log('─'.repeat(70));
const jetskiRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('jetskiStateSync.agentManagerInitState');
if (jetskiRow) {
    const raw = jetskiRow.value;
    console.log(`  Raw length: ${raw.length} bytes`);
    console.log(`  Type: ${typeof raw}`);

    if (typeof raw === 'string') {
        // 先尝试 JSON
        try {
            const parsed = JSON.parse(raw);
            console.log('  Format: JSON');
        } catch {
            // 尝试 base64 解码
            try {
                const buf = Buffer.from(raw, 'base64');
                console.log(`  Format: base64 (decoded to ${buf.length} bytes)`);
                console.log('  First 200 bytes (hex):', buf.slice(0, 200).toString('hex'));

                // 搜索可读字符串
                const text = buf.toString('utf-8');
                console.log('\n  --- 搜索对话标题 ---');
                // 查找 UUID 和标题模式
                const matches = text.match(/[A-Za-z][A-Za-z ]{5,50}/g);
                if (matches) {
                    const unique = [...new Set(matches)].filter(m => {
                        const lower = m.toLowerCase().trim();
                        return !lower.startsWith('vscode') && m.length > 5;
                    });
                    console.log('  可读字符串 (前50个):');
                    unique.slice(0, 50).forEach(m => console.log(`    ${m.trim()}`));
                }

                // 搜索 UUID 模式
                const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
                if (uuids) {
                    console.log(`\n  UUID 数量: ${uuids.length}`);
                    console.log('  前10个 UUID:');
                    uuids.slice(0, 10).forEach(u => console.log(`    ${u}`));
                }
            } catch (e) {
                console.log('  Error decoding base64:', e.message);
            }
        }
    }
}

// 3) sidebarWorkspaces
console.log('\n' + '═'.repeat(70));
console.log('3. antigravityUnifiedStateSync.sidebarWorkspaces');
console.log('─'.repeat(70));
const sidebarRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.sidebarWorkspaces');
if (sidebarRow) {
    const raw = sidebarRow.value;
    console.log(`  Raw length: ${raw.length}`);
    try {
        const buf = Buffer.from(raw, 'base64');
        const text = buf.toString('utf-8');
        console.log('  Decoded:', text.substring(0, 1000));
    } catch {
        console.log('  Preview:', raw.substring(0, 1000));
    }
}

db.close();
console.log('\n' + '═'.repeat(70));
console.log('🏁 完成\n');
