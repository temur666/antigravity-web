#!/usr/bin/env node
/**
 * tools/ag.js — Antigravity CLI 统一入口
 *
 * Usage:
 *   ag list                     列出对话
 *   ag list --limit 10          限制数量
 *   ag list --search "关键词"   搜索
 *   ag export                   导出最新对话
 *   ag export <id|index|title>  导出指定对话
 *   ag export --all             批量导出所有
 *   ag status                   API 状态
 *   ag test                     运行测试
 */

const path = require('path');
const fs = require('fs');
const { Controller } = require('../lib/core/controller');
const format = require('../lib/data/format');
const { getConversations } = require('../lib/data/conversations');

const EXPORT_DIR = path.join(__dirname, 'exports');

// ========== Controller 实例 ==========

const controller = new Controller();

// ========== Helpers ==========

function ts() {
    return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

function safeName(title) {
    return (title || 'untitled').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
}

function writeExport(title, markdown, json) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const base = `${safeName(title)}_${ts()}`;
    const mdPath = path.join(EXPORT_DIR, `${base}.md`);
    const jsonPath = path.join(EXPORT_DIR, `${base}.json`);

    fs.writeFileSync(mdPath, markdown, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

    return { mdPath, jsonPath, mdSize: markdown.length, jsonSize: JSON.stringify(json).length };
}

// ========== 对话查找 (CLI 专用) ==========

/**
 * 列出对话 (从 SQLite + Controller)
 * @param {object} [options]
 * @returns {{ conversations: Array, total: number }}
 */
function listConversations(options = {}) {
    const result = getConversations();
    if (result.error) return { conversations: [], total: 0, error: result.error };

    let convs = result.conversations;

    if (options.localOnly) {
        convs = convs.filter(c =>
            c.workspace && !c.workspace.includes('SSH') && !c.workspace.includes('WSL'),
        );
    }
    if (options.search) {
        const q = options.search.toLowerCase();
        convs = convs.filter(c =>
            (c.title || '').toLowerCase().includes(q) ||
            (c.id || '').toLowerCase().includes(q),
        );
    }

    const total = convs.length;
    if (options.limit) convs = convs.slice(0, options.limit);
    return { conversations: convs, total };
}

/**
 * 通过索引 / ID / 部分ID / 标题模糊匹配查找对话
 * @param {string|number} idOrIndex
 * @param {object} [listOptions]
 * @returns {{ conversation: object|null, error?: string }}
 */
function findConversation(idOrIndex, listOptions = {}) {
    const { conversations } = listConversations(listOptions);
    if (conversations.length === 0) {
        return { conversation: null, error: '没有找到任何对话' };
    }

    // 数字索引
    if (typeof idOrIndex === 'number' || /^\d+$/.test(idOrIndex)) {
        const idx = Number(idOrIndex);
        if (idx < 0 || idx >= conversations.length) {
            return { conversation: null, error: `索引 ${idx} 超出范围 (0-${conversations.length - 1})` };
        }
        return { conversation: conversations[idx] };
    }

    // 精确 ID
    const conv = conversations.find(c => c.id === idOrIndex);
    if (conv) return { conversation: conv };

    // 部分 ID 前缀
    const partial = conversations.find(c => c.id.startsWith(idOrIndex));
    if (partial) return { conversation: partial };

    // 标题包含
    const byTitle = conversations.find(c =>
        (c.title || '').toLowerCase().includes(idOrIndex.toLowerCase()),
    );
    if (byTitle) return { conversation: byTitle };

    return { conversation: null, error: `未找到匹配 "${idOrIndex}" 的对话` };
}

/**
 * 导出对话为 Markdown + JSON (纯数据，不写文件)
 * @param {string} cascadeId
 * @param {object} [options]
 * @returns {Promise<{ markdown: string, json: object, metadata: object, error?: string }>}
 */
async function exportConversation(cascadeId, options = {}) {
    try {
        const data = await controller.getTrajectory(cascadeId);
        if (!data || !data.trajectory) {
            return { markdown: '', json: null, metadata: null, error: 'trajectory 数据为空' };
        }

        const title = options.title || 'Untitled';
        const markdown = format.toMarkdown(data, title, options);
        const metadata = format.extractMetadata(data);

        return {
            markdown,
            json: data,
            metadata: { ...metadata, title, cascadeId },
        };
    } catch (e) {
        return { markdown: '', json: null, metadata: null, error: e.message };
    }
}

// ========== Commands ==========

async function cmdList(args) {
    const options = {};
    if (args.includes('--local')) options.localOnly = true;
    const limitIdx = args.indexOf('--limit');
    if (limitIdx >= 0 && args[limitIdx + 1]) options.limit = Number(args[limitIdx + 1]);
    const searchIdx = args.indexOf('--search');
    if (searchIdx >= 0 && args[searchIdx + 1]) options.search = args[searchIdx + 1];

    const result = listConversations(options);
    if (result.error) {
        console.error(`[!] ${result.error}`);
        return;
    }

    console.log(format.formatConversationList(result.conversations, options));
}

async function cmdExport(args) {
    const doAll = args.includes('--all');
    const target = args.find(a => !a.startsWith('--'));

    // 初始化 Controller
    console.log('[*] 初始化...');
    try {
        await controller.init();
        console.log(`[+] 已连接 (LS port: ${controller.ls?.port || 'unknown'})`);
    } catch (err) {
        console.error(`[!] 初始化失败: ${err.message}`);
        return;
    }

    if (doAll) {
        const { conversations } = listConversations({ localOnly: true });
        console.log(`[*] 批量导出 ${conversations.length} 个对话...\n`);

        let success = 0, fail = 0;
        for (let i = 0; i < conversations.length; i++) {
            const c = conversations[i];
            process.stdout.write(`  [${i + 1}/${conversations.length}] ${c.title || '(无标题)'}... `);
            const result = await exportConversation(c.id, { title: c.title });
            if (result.error) {
                console.log(`[!] ${result.error}`);
                fail++;
            } else {
                const files = writeExport(c.title, result.markdown, result.json);
                console.log(`[+] (${(files.mdSize / 1024).toFixed(1)} KB)`);
                success++;
            }
        }
        console.log(`\n[*] 完成: ${success} 成功, ${fail} 失败`);
        console.log(`[*] 输出目录: ${EXPORT_DIR}`);
        return;
    }

    // 单个导出
    let conv;
    if (target) {
        const result = findConversation(target);
        if (result.error) {
            console.error(`[!] ${result.error}`);
            return;
        }
        conv = result.conversation;
    } else {
        const { conversations } = listConversations({ localOnly: true });
        conv = conversations[0];
        if (!conv) {
            console.error('[!] 没有找到本地对话');
            return;
        }
    }

    console.log(`[*] 导出: ${conv.title || '(无标题)'}`);
    console.log(`    ID: ${conv.id}`);

    const result = await exportConversation(conv.id, { title: conv.title });
    if (result.error) {
        console.error(`[!] 导出失败: ${result.error}`);
        return;
    }

    const files = writeExport(conv.title, result.markdown, result.json);
    console.log(`\n[+] 导出完成:`);
    console.log(`    ${files.mdPath} (${(files.mdSize / 1024).toFixed(1)} KB)`);
    console.log(`    ${files.jsonPath} (${(files.jsonSize / 1024).toFixed(1)} KB)`);
}

async function cmdStatus() {
    try {
        await controller.init();
    } catch { /* non-fatal */ }

    const status = controller.getStatus();

    console.log('[*] Antigravity API 状态');
    console.log(`    LS: ${status.ls.connected ? '[+] 已连接' : '[!] 未连接'}`);
    if (status.ls.connected) {
        console.log(`    端口: ${status.ls.port}`);
        console.log(`    PID: ${status.ls.pid}`);
        console.log(`    版本: ${status.ls.version || 'unknown'}`);
    }
    console.log(`    对话数: ${status.conversations.total}`);
    console.log(`    运行中: ${status.conversations.running}`);
}

async function cmdTest() {
    console.log('[*] 运行测试...\n');
    const { execSync } = require('child_process');
    try {
        execSync('node tests/format.test.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    } catch { }
}

function showHelp() {
    console.log(`
Antigravity CLI

Usage: node tools/ag.js <command> [options]

Commands:
  list                        列出对话
    --limit <n>               限制数量
    --search <keyword>        按标题搜索
    --local                   只显示本地工作区

  export [id|index|title]     导出对话
    --all                     批量导出所有
                              不指定则导出最新本地对话

  status                      显示 API 状态
  test                        运行测试
  help                        显示帮助

Examples:
  node tools/ag.js list --limit 5
  node tools/ag.js export 0            导出列表中第 1 个
  node tools/ag.js export a2a88218     按 ID 前缀导出
  node tools/ag.js export "API Test"   按标题导出
  node tools/ag.js export --all        导出所有
`);
}

// ========== Main ==========

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
    case 'list': case 'ls': case 'l':
        cmdList(args); break;
    case 'export': case 'exp': case 'e':
        cmdExport(args); break;
    case 'status': case 'st': case 's':
        cmdStatus(); break;
    case 'test': case 't':
        cmdTest(); break;
    case 'help': case '-h': case '--help': case undefined:
        showHelp(); break;
    default:
        console.error(`未知命令: ${cmd}`);
        showHelp();
        process.exit(1);
}
