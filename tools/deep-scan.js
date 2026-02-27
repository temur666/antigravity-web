/**
 * deep-scan.js — 深度搜索对话内容存储位置
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const targetUUID = 'c1730fbd-711b-49e0-84b9-979783ee753b';
const lines = [];
const log = (...args) => {
    const line = args.join(' ');
    console.log(line);
    lines.push(line);
};

const antigravityBase = path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity');

// 1. 检查 WebStorage
log('━━━ WebStorage 深度扫描 ━━━');
const webDir = path.join(antigravityBase, 'WebStorage');
for (const subDir of fs.readdirSync(webDir)) {
    const subPath = path.join(webDir, subDir);
    const stat = fs.statSync(subPath);
    if (stat.isDirectory()) {
        log(`\n目录: ${subDir}`);
        try {
            const files = fs.readdirSync(subPath);
            for (const f of files) {
                const fPath = path.join(subPath, f);
                const fStat = fs.statSync(fPath);
                if (fStat.isDirectory()) {
                    log(`  ${f}/ (dir)`);
                    try {
                        const subFiles = fs.readdirSync(fPath);
                        for (const sf of subFiles) {
                            const sfStat = fs.statSync(path.join(fPath, sf));
                            log(`    ${sf}  ${sfStat.isDirectory() ? '(dir)' : sfStat.size + ' bytes'}`);
                        }
                    } catch { }
                } else {
                    log(`  ${f}  ${fStat.size} bytes`);
                    // 如果是 SQLite 数据库
                    if (f.endsWith('.sqlite') || f.endsWith('.db')) {
                        try {
                            const db = new Database(fPath, { readonly: true });
                            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                            log(`    SQLite tables: ${tables.map(t => t.name).join(', ')}`);
                            db.close();
                        } catch { }
                    }
                }
            }
        } catch (e) {
            log(`  错误: ${e.message}`);
        }
    }
}

// 2. 检查 Local Storage leveldb  
log('\n━━━ Local Storage leveldb ━━━');
const lsDir = path.join(antigravityBase, 'Local Storage', 'leveldb');
if (fs.existsSync(lsDir)) {
    const lsFiles = fs.readdirSync(lsDir);
    for (const f of lsFiles) {
        const fPath = path.join(lsDir, f);
        const stat = fs.statSync(fPath);
        log(`  ${f}  ${stat.size} bytes`);
    }
}

// 3. 搜索 Antigravity 目录下所有 SQLite 数据库文件
log('\n━━━ 全部 SQLite 文件 ━━━');
function findFiles(dir, ext, maxDepth, depth = 0) {
    if (depth > maxDepth) return [];
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && depth < maxDepth) {
                results.push(...findFiles(fullPath, ext, maxDepth, depth + 1));
            } else if (entry.name.endsWith(ext)) {
                results.push(fullPath);
            }
        }
    } catch { }
    return results;
}

// 搜索所有 .sqlite, .db, .vscdb
const dbExts = ['.sqlite', '.db', '.vscdb'];
for (const ext of dbExts) {
    const files = findFiles(antigravityBase, ext, 5);
    for (const f of files) {
        const stat = fs.statSync(f);
        const rel = path.relative(antigravityBase, f);
        log(`  ${rel}  ${stat.size} bytes`);

        // 检查是否有包含 UUID 的内容
        try {
            const db = new Database(f, { readonly: true });
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            log(`    tables: ${tables.map(t => t.name).join(', ')}`);

            // 搜索所有表中包含 UUID 的值
            for (const table of tables) {
                try {
                    const cols = db.prepare(`PRAGMA table_info(${table.name})`).all();
                    const textCols = cols.filter(c => /text|varchar|char|blob|clob/i.test(c.type) || c.type === '');
                    for (const col of textCols) {
                        try {
                            const rows = db.prepare(`SELECT COUNT(*) as cnt FROM ${table.name} WHERE CAST(${col.name} AS TEXT) LIKE '%${targetUUID}%'`).get();
                            if (rows.cnt > 0) {
                                log(`    *** 找到! ${table.name}.${col.name} 包含目标 UUID (${rows.cnt} 行) ***`);
                                const matchRows = db.prepare(`SELECT * FROM ${table.name} WHERE CAST(${col.name} AS TEXT) LIKE '%${targetUUID}%' LIMIT 3`).all();
                                for (const row of matchRows) {
                                    const rowStr = JSON.stringify(row);
                                    log(`      ${rowStr.length > 3000 ? rowStr.substring(0, 3000) + '...' : rowStr}`);
                                }
                            }
                        } catch { }
                    }
                } catch { }
            }
            db.close();
        } catch { }
    }
}

// 4. 搜索 logs 目录中有没有提及 conversation storage 或 trajectory storage 路径的线索
log('\n━━━ Logs 搜索 ━━━');
const logsDir = path.join(antigravityBase, 'logs');
if (fs.existsSync(logsDir)) {
    const logDirs = fs.readdirSync(logsDir).sort().reverse().slice(0, 3); // 最近 3 个日志目录
    for (const ld of logDirs) {
        const logPath = path.join(logsDir, ld);
        log(`\n日志目录: ${ld}`);
        try {
            const logFiles = findFiles(logPath, '.log', 3);
            for (const lf of logFiles) {
                try {
                    const content = fs.readFileSync(lf, 'utf-8');
                    // 搜索 trajectory 路径相关线索
                    const lines2 = content.split('\n');
                    for (const line of lines2) {
                        if (/trajectory.*path|conversation.*stor|jetski.*stor/i.test(line)) {
                            log(`  ${path.relative(logPath, lf)}: ${line.trim().substring(0, 200)}`);
                        }
                    }
                } catch { }
            }
        } catch { }
    }
}

const outputFile = path.join(__dirname, 'deep-scan-output.txt');
fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
log('');
log('✅ 已保存到:', outputFile);
