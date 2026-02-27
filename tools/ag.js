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
const service = require('../lib/service');
const format = require('../lib/format');

const EXPORT_DIR = path.join(__dirname, 'exports');

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

// ========== Commands ==========

async function cmdList(args) {
    const options = {};
    if (args.includes('--local')) options.localOnly = true;
    const limitIdx = args.indexOf('--limit');
    if (limitIdx >= 0 && args[limitIdx + 1]) options.limit = Number(args[limitIdx + 1]);
    const searchIdx = args.indexOf('--search');
    if (searchIdx >= 0 && args[searchIdx + 1]) options.search = args[searchIdx + 1];

    const result = service.listConversations(options);
    if (result.error) {
        console.error(`❌ ${result.error}`);
        return;
    }

    console.log(format.formatConversationList(result.conversations, options));
}

async function cmdExport(args) {
    const doAll = args.includes('--all');
    const target = args.find(a => !a.startsWith('--'));

    // 初始化 API
    console.log('🔌 初始化...');
    const initResult = await service.init({ quiet: true });
    if (!initResult.success) {
        console.error(`❌ API 初始化失败: ${initResult.error}`);
        return;
    }
    console.log(`✅ 已连接 (${initResult.endpoints.length} 个端口)`);

    if (doAll) {
        // 批量导出
        const { conversations } = service.listConversations({ localOnly: true });
        console.log(`📦 批量导出 ${conversations.length} 个对话...\n`);

        let success = 0, fail = 0;
        for (let i = 0; i < conversations.length; i++) {
            const c = conversations[i];
            process.stdout.write(`  [${i + 1}/${conversations.length}] ${c.title || '(无标题)'}... `);
            const result = await service.exportConversation(c.id, { title: c.title });
            if (result.error) {
                console.log(`❌ ${result.error}`);
                fail++;
            } else {
                const files = writeExport(c.title, result.markdown, result.json);
                console.log(`✅ (${(files.mdSize / 1024).toFixed(1)} KB)`);
                success++;
            }
        }
        console.log(`\n📊 完成: ${success} 成功, ${fail} 失败`);
        console.log(`📁 输出目录: ${EXPORT_DIR}`);
        return;
    }

    // 单个导出
    let conv;
    if (target) {
        const result = service.findConversation(target);
        if (result.error) {
            console.error(`❌ ${result.error}`);
            return;
        }
        conv = result.conversation;
    } else {
        // 默认最新本地对话
        const { conversations } = service.listConversations({ localOnly: true });
        conv = conversations[0];
        if (!conv) {
            console.error('❌ 没有找到本地对话');
            return;
        }
    }

    console.log(`📖 导出: ${conv.title || '(无标题)'}`);
    console.log(`   ID: ${conv.id}`);

    const result = await service.exportConversation(conv.id, { title: conv.title });
    if (result.error) {
        console.error(`❌ 导出失败: ${result.error}`);
        return;
    }

    const files = writeExport(conv.title, result.markdown, result.json);
    console.log(`\n✅ 导出完成:`);
    console.log(`   📄 ${files.mdPath} (${(files.mdSize / 1024).toFixed(1)} KB)`);
    console.log(`   📦 ${files.jsonPath} (${(files.jsonSize / 1024).toFixed(1)} KB)`);
}

async function cmdStatus() {
    const initResult = await service.init({ quiet: true });
    const status = service.getStatus();

    console.log('🔧 Antigravity API 状态');
    console.log(`   初始化: ${status.initialized ? '✅' : '❌'}`);
    console.log(`   活跃端口: ${status.api.activePort || '无'}`);
    console.log(`   端点:`);
    for (const ep of status.api.endpoints) {
        console.log(`     • ${ep.port} (${ep.windowTitle}) — CSRF: ${ep.hasCsrf ? '✅' : '❌'}`);
    }
}

async function cmdTest() {
    console.log('🧪 运行测试...\n');
    const { execSync } = require('child_process');
    try {
        execSync('node tests/format.test.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    } catch { }
    try {
        execSync('node tests/service.test.js --integration', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
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
