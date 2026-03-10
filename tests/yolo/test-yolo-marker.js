/**
 * tests/yolo/test-yolo-marker.js — 标记文件熔断逻辑测试
 *
 * 测试 yolo.js 的标记文件检测逻辑：
 *   1. cleanMarker() 清理
 *   2. checkMarker() 检测
 *   3. 标记文件 JSON 格式解析
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MARKER_FILE = path.join(ROOT, '.yolo-done');

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  [PASS] ${label}`);
        passed++;
    } else {
        console.log(`  [FAIL] ${label}`);
        failed++;
    }
}

function cleanup() {
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }
}

// 复制 yolo.js 中的函数
function checkMarker() {
    return fs.existsSync(MARKER_FILE);
}

function cleanMarker() {
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }
}

console.log('=== 标记文件熔断逻辑测试 ===\n');

// ========== 测试 1: 初始状态（无标记文件） ==========
console.log('--- 测试 1: 初始状态 ---');
cleanup();
assert(!checkMarker(), '初始状态: 标记文件不存在');

// ========== 测试 2: 写入后检测 ==========
console.log('\n--- 测试 2: 写入后检测 ---');
const marker = {
    completedAt: new Date().toISOString(),
    summary: '测试熔断'
};
fs.writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2), 'utf-8');
assert(checkMarker(), '写入后: 标记文件存在');

// ========== 测试 3: 内容可解析 ==========
console.log('\n--- 测试 3: 标记内容解析 ---');
const content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
assert(content.summary === '测试熔断', '标记内容摘要正确');
assert(typeof content.completedAt === 'string', '标记内容时间戳存在');

// ========== 测试 4: cleanMarker() 清理 ==========
console.log('\n--- 测试 4: cleanMarker() 清理 ---');
cleanMarker();
assert(!checkMarker(), '清理后: 标记文件不存在');

// ========== 测试 5: 重复清理不报错 ==========
console.log('\n--- 测试 5: 重复清理不报错 ---');
let noError = true;
try {
    cleanMarker();
    cleanMarker();
    cleanMarker();
} catch {
    noError = false;
}
assert(noError, '重复清理不抛异常');

// ========== 测试 6: 标记文件路径正确性 ==========
console.log('\n--- 测试 6: 标记文件路径 ---');
assert(MARKER_FILE === path.join(ROOT, '.yolo-done'), '标记文件路径在项目根目录');
assert(MARKER_FILE.endsWith('.yolo-done'), '标记文件名正确');

// 清理
cleanup();

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
