/**
 * scan-workspace-dbs.js — 扫描所有 workspace state.vscdb 中的 key，
 * 搜索可能包含对话内容的数据
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'workspace-db-scan.txt');
const wsDir = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'User', 'workspaceStorage');

const targetUUID = 'c1730fbd-711b-49e0-84b9-979783ee753b';

const lines = [];
const log = (...args) => {
    const line = args.join(' ');
    console.log(line);
    lines.push(line);
};

log('扫描所有 workspace 数据库');
log('目标 UUID:', targetUUID);
log('');

const dirs = fs.readdirSync(wsDir);
for (const dir of dirs) {
    const dbPath = path.join(wsDir, dir, 'state.vscdb');
    if (!fs.existsSync(dbPath)) continue;

    let db;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const keys = db.prepare('SELECT key FROM ItemTable').all().map(r => r.key);

        // 搜索包含 UUID 的 key
        const uuidKeys = keys.filter(k => k.includes(targetUUID));
        // 搜索包含 "trajectory", "conversation", "chat", "jetski", "agent" 的 key
        const relatedKeys = keys.filter(k => /trajectory|conversation|jetski|agentManager/i.test(k));

        if (uuidKeys.length > 0 || relatedKeys.length > 0) {
            log(`━━━ ${dir} ━━━`);

            // workspace.json
            const wsJsonPath = path.join(wsDir, dir, 'workspace.json');
            if (fs.existsSync(wsJsonPath)) {
                log('workspace.json:', fs.readFileSync(wsJsonPath, 'utf-8'));
            }

            if (uuidKeys.length > 0) {
                log(`  包含目标 UUID 的 key (${uuidKeys.length}个):`);
                for (const key of uuidKeys) {
                    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
                    const val = row ? row.value : '<null>';
                    log(`    KEY: ${key}`);
                    log(`    VALUE 长度: ${typeof val === 'string' ? val.length : 'N/A'}`);
                    if (typeof val === 'string' && val.length < 5000) {
                        log(`    VALUE: ${val}`);
                    } else if (typeof val === 'string') {
                        log(`    VALUE (前 2000): ${val.substring(0, 2000)}`);
                    }
                }
            }

            if (relatedKeys.length > 0) {
                log(`  相关 key (${relatedKeys.length}个):`);
                for (const key of relatedKeys) {
                    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
                    const val = row ? row.value : '<null>';
                    log(`    KEY: ${key} (${typeof val === 'string' ? val.length : 0} bytes)`);
                }
            }
            log('');
        }
    } catch (err) {
        // skip
    } finally {
        if (db) db.close();
    }
}

// 也搜索全局数据库中 jetskiStateSync 的所有 key
log('');
log('━━━ 全局 state.vscdb 中的 jetskiStateSync key ━━━');
const globalDb = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
let db2;
try {
    db2 = new Database(globalDb, { readonly: true, fileMustExist: true });
    const allKeys = db2.prepare('SELECT key FROM ItemTable').all().map(r => r.key);
    const jetskiKeys = allKeys.filter(k => k.includes('jetski') || k.includes('Jetski'));
    for (const key of jetskiKeys) {
        const row = db2.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
        const val = row ? row.value : '<null>';
        log(`  KEY: ${key} (${typeof val === 'string' ? val.length : 0} bytes)`);
    }

    // Also check the agentManagerInitState for full content dump for latest
    log('');
    log('━━━ 尝试搜索对话存储路径 ━━━');

    // 搜索可能的文件存储
    const antigravityBase = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity');

    // 搜索 User 目录下有没有包含该 UUID 的文件
    const searchDirs = [
        path.join(antigravityBase, 'User'),
        path.join(antigravityBase, 'CachedData'),
        path.join(antigravityBase, 'logs'),
    ];

    for (const searchDir of searchDirs) {
        if (!fs.existsSync(searchDir)) continue;
        // 快速检查是否有包含 UUID 的文件名
        try {
            const found = findFilesContaining(searchDir, targetUUID, 2);
            if (found.length > 0) {
                log(`  在 ${searchDir} 找到包含 UUID 的文件:`);
                for (const f of found) {
                    log(`    ${f}`);
                }
            }
        } catch { }
    }

    // 搜索 Local Storage
    const lsDir = path.join(antigravityBase, 'Local Storage');
    if (fs.existsSync(lsDir)) {
        log('');
        log('Local Storage 内容:');
        const lsFiles = fs.readdirSync(lsDir);
        for (const f of lsFiles) {
            const fPath = path.join(lsDir, f);
            const stat = fs.statSync(fPath);
            log(`  ${f}  ${stat.isDirectory() ? '(dir)' : stat.size + ' bytes'}`);
        }
    }

    // 搜索 Session Storage
    const ssDir = path.join(antigravityBase, 'Session Storage');
    if (fs.existsSync(ssDir)) {
        log('');
        log('Session Storage 内容:');
        const ssFiles = fs.readdirSync(ssDir);
        for (const f of ssFiles) {
            const fPath = path.join(ssDir, f);
            const stat = fs.statSync(fPath);
            log(`  ${f}  ${stat.isDirectory() ? '(dir)' : stat.size + ' bytes'}`);
        }
    }

    // 搜索 WebStorage
    const webDir = path.join(antigravityBase, 'WebStorage');
    if (fs.existsSync(webDir)) {
        log('');
        log('WebStorage 内容:');
        const webFiles = fs.readdirSync(webDir);
        for (const f of webFiles) {
            const fPath = path.join(webDir, f);
            const stat = fs.statSync(fPath);
            log(`  ${f}  ${stat.isDirectory() ? '(dir)' : stat.size + ' bytes'}`);
        }
    }

} finally {
    if (db2) db2.close();
}

function findFilesContaining(dir, pattern, maxDepth, depth = 0) {
    if (depth > maxDepth) return [];
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.includes(pattern)) {
                results.push(path.join(dir, entry.name));
            }
            if (entry.isDirectory() && depth < maxDepth) {
                results.push(...findFilesContaining(path.join(dir, entry.name), pattern, maxDepth, depth + 1));
            }
        }
    } catch { }
    return results;
}

fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
log('');
log('✅ 已保存到:', outputFile);
