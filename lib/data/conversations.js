/**
 * lib/conversations.js — 从 Antigravity 的本地 SQLite 数据库直接读取对话列表
 *
 * 数据来源:
 *   1. jetskiStateSync.agentManagerInitState  — 对话 UUID + 最后活跃时间戳 (protobuf)
 *   2. antigravityUnifiedStateSync.trajectorySummaries — 对话 UUID + 标题 + 步骤数 + 工作区 (protobuf)
 *
 * 两者通过 UUID 关联，合并后返回完整的对话列表。
 * 
 * 数据库路径: %APPDATA%\Antigravity\User\globalStorage\state.vscdb
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ========== Protobuf 解码工具 ==========

function decodeVarint(buf, offset) {
    let result = 0, shift = 0, pos = offset;
    while (pos < buf.length) {
        const byte = buf[pos++];
        result |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 49) throw new Error('varint too long');
    }
    return { value: result, bytesRead: pos - offset };
}

function decodeMessage(buf) {
    const fields = [];
    let pos = 0;
    while (pos < buf.length) {
        try {
            const tag = decodeVarint(buf, pos);
            const fieldNumber = tag.value >> 3;
            const wireType = tag.value & 0x7;
            pos += tag.bytesRead;
            if (fieldNumber === 0) break;

            switch (wireType) {
                case 0: {
                    const val = decodeVarint(buf, pos);
                    fields.push({ fn: fieldNumber, wt: wireType, val: val.value });
                    pos += val.bytesRead;
                    break;
                }
                case 2: {
                    const len = decodeVarint(buf, pos);
                    pos += len.bytesRead;
                    if (pos + len.value > buf.length) throw new Error('overflow');
                    fields.push({ fn: fieldNumber, wt: wireType, val: buf.slice(pos, pos + len.value) });
                    pos += len.value;
                    break;
                }
                case 1: { pos += 8; break; }
                case 5: { pos += 4; break; }
                default: throw new Error(`bad wt ${wireType}`);
            }
        } catch { break; }
    }
    return fields;
}

function tryStr(buf) {
    if (!Buffer.isBuffer(buf)) return null;
    const str = buf.toString('utf-8');
    const ok = [...str].every(c => c.charCodeAt(0) >= 0x20 || c === '\n' || c === '\r' || c === '\t');
    return ok && str.length > 0 ? str : null;
}

// ========== 数据库路径 ==========

function getDbPath() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    // Windows: %APPDATA%\Antigravity\User\globalStorage\state.vscdb
    const candidates = [
        path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
        path.join(homeDir, 'AppData', 'Roaming', 'antigravity', 'User', 'globalStorage', 'state.vscdb'),
        // macOS / Linux
        path.join(homeDir, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ========== 解析 trajectorySummaries ==========
// 结构: repeated field1 { field1=UUID, field2=detailMsg }
// detailMsg.field1 = base64(title), detailMsg.field2 = stepCount, detailMsg.field3 = createdTs, ...

function parseTrajectorySummaries(rawBase64) {
    const buf = Buffer.from(rawBase64, 'base64');
    const topFields = decodeMessage(buf);
    const map = new Map(); // UUID → { title, stepCount, workspace, createdAt }

    for (const tf of topFields) {
        if (tf.fn !== 1 || tf.wt !== 2) continue;
        const entryFields = decodeMessage(tf.val);

        let id = '';
        let title = '';
        let stepCount = 0;
        let workspace = '';
        let createdAt = 0;
        let updatedAt = 0;

        for (const f of entryFields) {
            // field1 = UUID
            if (f.fn === 1 && f.wt === 2) {
                const str = tryStr(f.val);
                if (str && str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
                    id = str;
                }
            }
            // field2 = wrapper message containing a base64-encoded protobuf string
            if (f.fn === 2 && f.wt === 2) {
                const wrapperFields = decodeMessage(f.val);
                // field1 inside wrapper = base64 string that decodes to the actual detail protobuf
                const b64Field = wrapperFields.find(wf => wf.fn === 1 && wf.wt === 2);
                if (!b64Field) continue;

                const b64Str = tryStr(b64Field.val);
                if (!b64Str) continue;

                let detailBuf;
                try { detailBuf = Buffer.from(b64Str, 'base64'); } catch { continue; }
                const detailFields = decodeMessage(detailBuf);

                for (const df of detailFields) {
                    // field1 = title (plain text!)
                    if (df.fn === 1 && df.wt === 2) {
                        const str = tryStr(df.val);
                        if (str && str.length < 300) title = str;
                    }
                    // field2 = step count
                    if (df.fn === 2 && df.wt === 0) {
                        stepCount = df.val;
                    }
                    // field3 = created timestamp { field1=seconds, field2=nanos }
                    if (df.fn === 3 && df.wt === 2) {
                        const tsFields = decodeMessage(df.val);
                        for (const tsf of tsFields) {
                            if (tsf.fn === 1 && tsf.wt === 0 && tsf.val > 1700000000 && tsf.val < 2100000000) {
                                createdAt = tsf.val;
                            }
                        }
                    }
                    // field7 = updated timestamp
                    if (df.fn === 7 && df.wt === 2) {
                        const tsFields = decodeMessage(df.val);
                        for (const tsf of tsFields) {
                            if (tsf.fn === 1 && tsf.wt === 0 && tsf.val > 1700000000 && tsf.val < 2100000000) {
                                updatedAt = tsf.val;
                            }
                        }
                    }
                    // field9 = workspace info
                    if (df.fn === 9 && df.wt === 2) {
                        const wsFields = decodeMessage(df.val);
                        for (const wf of wsFields) {
                            if (wf.wt === 2) {
                                const str = tryStr(wf.val);
                                if (str && (str.includes('://') || str.startsWith('/'))) {
                                    if (!workspace) workspace = str;
                                }
                            }
                        }
                    }
                    // field10 = last active timestamp
                    if (df.fn === 10 && df.wt === 2) {
                        const tsFields = decodeMessage(df.val);
                        for (const tsf of tsFields) {
                            if (tsf.fn === 1 && tsf.wt === 0 && tsf.val > 1700000000 && tsf.val < 2100000000) {
                                if (tsf.val > updatedAt) updatedAt = tsf.val;
                            }
                        }
                    }
                }
            }
        }

        if (id) {
            map.set(id, { title, stepCount, workspace, createdAt, updatedAt });
        }
    }
    return map;
}

// ========== 解析 agentManagerInitState ==========
// field10 = repeated { field1=UUID, field2={ field1=seconds, field2=nanos } }

function parseManagerState(rawBase64) {
    const buf = Buffer.from(rawBase64, 'base64');
    const topFields = decodeMessage(buf);
    const map = new Map(); // UUID → { lastActiveAt }

    for (const tf of topFields) {
        if (tf.fn !== 10 || tf.wt !== 2) continue;
        const fields = decodeMessage(tf.val);

        let id = '';
        let lastActiveAt = 0;

        for (const f of fields) {
            if (f.fn === 1 && f.wt === 2) {
                const str = tryStr(f.val);
                if (str && str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
                    id = str;
                }
            }
            if (f.fn === 2 && f.wt === 2) {
                const tsFields = decodeMessage(f.val);
                for (const tsf of tsFields) {
                    if (tsf.fn === 1 && tsf.wt === 0 && tsf.val > 1700000000 && tsf.val < 2100000000) {
                        lastActiveAt = tsf.val;
                    }
                }
            }
        }

        if (id) {
            map.set(id, { lastActiveAt });
        }
    }
    return map;
}

// ========== 工作区路径美化 ==========

function prettifyWorkspace(ws) {
    if (!ws) return '';
    // file:///c%3A/Users/Admin/project → c:\Users\Admin\project
    if (ws.startsWith('file:///')) {
        let p = ws.replace('file:///', '').replace(/%3A/gi, ':');
        p = decodeURIComponent(p);
        return p;
    }
    // vscode-remote://ssh-remote%2B.../path → [SSH] path
    if (ws.includes('ssh-remote')) {
        const match = ws.match(/\/([^/]+)$/);
        return match ? `[SSH] ${match[1]}` : ws;
    }
    // vscode-remote://wsl%2Bubuntu/path → [WSL] path
    if (ws.includes('wsl')) {
        const match = ws.match(/wsl[^/]*\/(.+)/);
        return match ? `[WSL] /${match[1]}` : ws;
    }
    return ws;
}

// ========== 对外 API ==========

/**
 * 获取所有对话列表，按最后活跃时间排序（最新在前）
 * @returns {{ conversations: Array, total: number, error: string|null }}
 */
function getConversations() {
    const dbPath = getDbPath();
    if (!dbPath) {
        return { conversations: [], total: 0, error: 'Antigravity 数据库未找到' };
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });

        // 读取两个数据源
        const trajRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('antigravityUnifiedStateSync.trajectorySummaries');
        const managerRow = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get('jetskiStateSync.agentManagerInitState');

        if (!trajRow && !managerRow) {
            return { conversations: [], total: 0, error: '没有找到对话数据' };
        }

        // 解析两个数据源
        const trajMap = trajRow ? parseTrajectorySummaries(trajRow.value) : new Map();
        const managerMap = managerRow ? parseManagerState(managerRow.value) : new Map();

        // 合并: 以 trajectorySummaries 为主（有标题），补充 manager 中的时间戳
        const allIds = new Set([...trajMap.keys(), ...managerMap.keys()]);
        const conversations = [];

        for (const id of allIds) {
            const traj = trajMap.get(id) || {};
            const mgr = managerMap.get(id) || {};

            // 确定最佳时间戳
            let updatedAt = mgr.lastActiveAt || traj.updatedAt || traj.createdAt || 0;
            if (traj.updatedAt && traj.updatedAt > updatedAt) updatedAt = traj.updatedAt;

            conversations.push({
                id,
                title: traj.title || '',
                stepCount: traj.stepCount || 0,
                workspace: prettifyWorkspace(traj.workspace || ''),
                createdAt: traj.createdAt ? new Date(traj.createdAt * 1000).toISOString() : null,
                updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : null,
                updatedTs: updatedAt,
            });
        }

        // 按 updatedAt 降序排列（最新在前）
        conversations.sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));

        // 移除内部字段
        conversations.forEach(c => delete c.updatedTs);

        return { conversations, total: conversations.length, error: null };

    } catch (err) {
        return { conversations: [], total: 0, error: `读取数据库失败: ${err.message}` };
    } finally {
        if (db) db.close();
    }
}

module.exports = { getConversations, getDbPath };
