/**
 * tests/yolo/test-yolo-args.js — yolo.js 参数解析单元测试
 *
 * 注意: parseArgs() 从 process.argv 读取，这里通过 mock 来测试。
 * 同时直接测试 yolo.js 的参数校验行为（缺少参数时 exit）。
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const YOLO_SCRIPT = path.join(ROOT, 'scripts', 'yolo.js');

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

function runYolo(args, opts = {}) {
    try {
        const stdout = execSync(`node "${YOLO_SCRIPT}" ${args}`, {
            cwd: ROOT,
            timeout: opts.timeout || 5000,
            env: { ...process.env, ...opts.env },
        }).toString();
        return { exitCode: 0, stdout, stderr: '' };
    } catch (err) {
        return {
            exitCode: err.status,
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || '',
        };
    }
}

console.log('=== yolo.js 参数解析测试 ===\n');

// ========== 测试 1: 无参数退出 ==========
console.log('--- 测试 1: 无参数退出 ---');
const r1 = runYolo('');
assert(r1.exitCode !== 0, '无参数时应 exit(1)');
assert(r1.stderr.includes('用法:') || r1.stdout.includes('用法:'), '输出用法说明');

// ========== 测试 2: 文档不存在 ==========
console.log('\n--- 测试 2: 文档不存在 ---');
const r2 = runYolo('/tmp/nonexistent-12345.md');
assert(r2.exitCode !== 0, '文档不存在时应 exit(1)');
assert(r2.stderr.includes('不存在') || r2.stdout.includes('不存在'), '输出文件不存在提示');

// ========== 测试 3: parseArgs 逻辑验证 ==========
// 由于 parseArgs 是内部函数，创建可导入版本来测试
console.log('\n--- 测试 3: parseArgs 逻辑验证 ---');

// 提取 parseArgs 函数进行独立测试
function parseArgs(argv) {
    const args = argv;
    const config = {
        docPath: null,
        timeout: 7200,
        port: null,
        csrf: null,
        cascadeId: null,
        cooldown: 5,
        pollInterval: 3,
        agentic: false,
    };

    let i = 0;
    while (i < args.length) {
        switch (args[i]) {
            case '--timeout':
                config.timeout = parseInt(args[++i], 10);
                break;
            case '--port':
                config.port = parseInt(args[++i], 10);
                break;
            case '--csrf':
                config.csrf = args[++i];
                break;
            case '--cascade':
                config.cascadeId = args[++i];
                break;
            case '--cooldown':
                config.cooldown = parseInt(args[++i], 10);
                break;
            case '--poll-interval':
                config.pollInterval = parseInt(args[++i], 10);
                break;
            case '--agentic':
                config.agentic = true;
                break;
            default:
                if (!args[i].startsWith('--') && !config.docPath) {
                    config.docPath = args[i];
                }
                break;
        }
        i++;
    }

    return config;
}

// 3a: 纯文档路径
const c3a = parseArgs(['my-task.md']);
assert(c3a.docPath === 'my-task.md', '解析文档路径');
assert(c3a.agentic === false, '默认非 agentic');
assert(c3a.timeout === 7200, '默认超时 7200');
assert(c3a.port === null, '默认端口 null（自动发现）');
assert(c3a.csrf === null, '默认 CSRF null（自动发现）');

// 3b: 全参数
const c3b = parseArgs([
    'task.md', '--timeout', '3600', '--port', '42200',
    '--csrf', 'my-token', '--cascade', 'abc-123',
    '--cooldown', '10', '--poll-interval', '5', '--agentic'
]);
assert(c3b.docPath === 'task.md', '全参数: 文档路径');
assert(c3b.timeout === 3600, '全参数: timeout');
assert(c3b.port === 42200, '全参数: port');
assert(c3b.csrf === 'my-token', '全参数: csrf');
assert(c3b.cascadeId === 'abc-123', '全参数: cascadeId');
assert(c3b.cooldown === 10, '全参数: cooldown');
assert(c3b.pollInterval === 5, '全参数: pollInterval');
assert(c3b.agentic === true, '全参数: agentic');

// 3c: 参数顺序无关
const c3c = parseArgs(['--agentic', '--timeout', '1800', 'task2.md']);
assert(c3c.docPath === 'task2.md', '参数顺序无关: 文档路径');
assert(c3c.agentic === true, '参数顺序无关: agentic');
assert(c3c.timeout === 1800, '参数顺序无关: timeout');

// 3d: 未知参数忽略
const c3d = parseArgs(['task.md', '--unknown', 'value']);
assert(c3d.docPath === 'task.md', '未知参数忽略: 文档路径仍正确');

// ========== 总结 ==========
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
