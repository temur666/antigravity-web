#!/usr/bin/env node
/**
 * auto-approve.js — 自动批准 SafeToAutoRun=false 的命令
 *
 * 功能：
 *   1. 自动发现本机 LS (Windows + Linux)
 *   2. 持续监控 RUNNING 状态的对话
 *   3. 发现 WAITING 的 RUN_COMMAND / CODE_ACTION step 时自动批准
 *
 * 用法：node tools/auto-approve.js
 *   --interval <ms>    轮询间隔 (默认 2000)
 *   --dry-run           只检测不批准
 *   --once              只检查一次后退出
 *   --verbose           详细日志
 */

const https = require('https');
const { execSync } = require('child_process');
const os = require('os');

// ========== 配置 ==========

const ARGS = process.argv.slice(2);
const POLL_INTERVAL = getArg('--interval', 2000, Number);
const DRY_RUN = ARGS.includes('--dry-run');
const ONCE = ARGS.includes('--once');
const VERBOSE = ARGS.includes('--verbose');

const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';
const IS_WINDOWS = os.platform() === 'win32';

// 已处理过的 step 记录
const approvedKeys = new Set();

// ========== 工具函数 ==========

function getArg(name, defaultVal, castFn = String) {
    const idx = ARGS.indexOf(name);
    if (idx === -1 || idx + 1 >= ARGS.length) return defaultVal;
    return castFn(ARGS[idx + 1]);
}

function ts() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function log(msg) {
    console.log(`[${ts()}] ${msg}`);
}

function debug(msg) {
    if (VERBOSE) console.log(`[${ts()}] [debug] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ========== gRPC 调用 ==========

function grpcCall(port, csrf, method, body, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body || {});
        const req = https.request({
            hostname: '127.0.0.1',
            port,
            path: `${SERVICE_PATH}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-codeium-csrf-token': csrf,
                'connect-protocol-version': '1',
            },
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(d) });
                } catch {
                    resolve({ status: res.statusCode, data: d });
                }
            });
        });
        req.on('error', e => resolve({ status: 0, data: null, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, error: 'timeout' }); });
        req.write(data);
        req.end();
    });
}

// ========== LS 发现 ==========

function discoverAllLS() {
    return IS_WINDOWS ? discoverWindows() : discoverLinux();
}

function discoverWindows() {
    const results = [];
    try {
        const raw = execSync(
            'powershell -Command "Get-CimInstance Win32_Process | Where-Object {$_.Name -like \'language_server*\'} | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"',
            { encoding: 'utf-8', timeout: 10000 }
        );

        let procs = JSON.parse(raw);
        if (!Array.isArray(procs)) procs = [procs];

        for (const proc of procs) {
            if (!proc.CommandLine) continue;

            const csrfMatch = proc.CommandLine.match(/--csrf_token\s+([a-f0-9-]+)/);
            const extPortMatch = proc.CommandLine.match(/--extension_server_port\s+(\d+)/);
            const workspaceMatch = proc.CommandLine.match(/--workspace_id\s+(\S+)/);

            if (!csrfMatch) continue;

            const pid = proc.ProcessId;
            const csrf = csrfMatch[1];
            const workspace = workspaceMatch ? workspaceMatch[1] : 'unknown';

            let httpsPort = null;
            try {
                const netstat = execSync(`netstat -ano | findstr "${pid}" | findstr "LISTENING"`, { encoding: 'utf-8', timeout: 5000 });
                const ports = [...netstat.matchAll(/127\.0\.0\.1:(\d+)/g)]
                    .map(m => parseInt(m[1]))
                    .filter(p => extPortMatch ? p !== parseInt(extPortMatch[1]) : true)
                    .sort((a, b) => a - b);

                if (ports.length > 0) httpsPort = ports[0];
            } catch { /* netstat failed */ }

            if (httpsPort) {
                results.push({ pid, port: httpsPort, csrf, workspace });
            }
        }
    } catch (e) {
        debug('Windows discovery failed: ' + e.message);
    }
    return results;
}

function discoverLinux() {
    const results = [];
    try {
        const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
        const lsLines = psOutput.split('\n')
            .filter(l => l.includes('language_server') && !l.includes('grep') && !l.includes('standalone'));

        for (const line of lsLines) {
            const pid = parseInt(line.trim().split(/\s+/)[1]);
            const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/);
            if (!csrfMatch) continue;

            const serverPortMatch = line.match(/--server_port\s+(\d+)/);
            const workspaceMatch = line.match(/--workspace_id\s+(\S+)/);

            let port = serverPortMatch ? parseInt(serverPortMatch[1]) : null;

            if (!port) {
                try {
                    const ssOutput = execSync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`, { encoding: 'utf-8', timeout: 5000 });
                    const portMatches = [...ssOutput.matchAll(/127\.0\.0\.1:(\d+)/g)].map(m => parseInt(m[1]));
                    if (portMatches.length > 0) port = portMatches[0];
                } catch { /* ss failed */ }
            }

            if (port) {
                results.push({ pid, port, csrf: csrfMatch[1], workspace: workspaceMatch ? workspaceMatch[1] : 'unknown' });
            }
        }
    } catch (e) {
        debug('Linux discovery failed: ' + e.message);
    }
    return results;
}

async function verifyLS(ls) {
    const res = await grpcCall(ls.port, ls.csrf, 'Heartbeat', { metadata: {} }, 3000);
    return res.status === 200;
}

// ========== 对话监控 ==========

async function getRunningConversations(ls) {
    const res = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
    if (res.status !== 200 || !res.data?.trajectorySummaries) return [];

    const sums = res.data.trajectorySummaries;
    return Object.keys(sums)
        .filter(id => sums[id].status === 'CASCADE_RUN_STATUS_RUNNING')
        .map(id => ({
            id,
            summary: sums[id].summary || '(untitled)',
            stepCount: sums[id].stepCount || 0,
        }));
}

/**
 * 获取对话轨迹中的 WAITING step (需要用户批准的)
 */
async function findWaitingSteps(ls, cascadeId) {
    const res = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId });
    if (res.status !== 200 || !res.data?.trajectory) return [];

    const trajectory = res.data.trajectory;
    const steps = trajectory.steps || [];
    const trajectoryId = trajectory.trajectoryId;
    const waiting = [];

    steps.forEach((step, index) => {
        // 关键：状态是 WAITING 而不是 PENDING
        if (step.status !== 'CORTEX_STEP_STATUS_WAITING') return;

        // 只处理有 requestedInteraction 的 step
        if (!step.requestedInteraction) return;

        const detail = step.runCommand?.commandLine
            || step.runCommand?.proposedCommandLine
            || step.codeAction?.actionSpec?.createFile?.path?.absoluteUri
            || step.codeAction?.actionSpec?.editFile?.path?.absoluteUri
            || '(unknown)';

        waiting.push({
            index,
            type: step.type,
            detail,
            trajectoryId,
            requestedInteraction: step.requestedInteraction,
        });
    });

    return waiting;
}

// ========== 批准逻辑 ==========

/**
 * 通过 HandleCascadeUserInteraction 批准一个 WAITING step
 *
 * Proto 结构 (逆向自 extension.js):
 *   HandleCascadeUserInteractionRequest {
 *     cascade_id: string (field 1)
 *     interaction: CascadeUserInteraction (field 2) {
 *       trajectory_id: string (field 1)
 *       step_index: uint32 (field 2)
 *       oneof interaction {
 *         run_command: CascadeRunCommandInteraction (field 5) {
 *           confirm: bool (field 1)
 *           proposed_command_line: string (field 2)
 *         }
 *         file_permission: ... (field 19)
 *       }
 *     }
 *   }
 */
async function approveStep(ls, cascadeId, step) {
    // 根据 requestedInteraction 类型选择对应的批准方式
    const interaction = {
        trajectoryId: step.trajectoryId,
        stepIndex: step.index,
    };

    if (step.requestedInteraction.runCommand !== undefined) {
        // 批准运行命令
        interaction.runCommand = {
            confirm: true,
            proposedCommandLine: step.detail,
        };
    } else if (step.requestedInteraction.filePermission !== undefined) {
        // 批准文件权限
        interaction.filePermission = { confirm: true };
    } else {
        // 未知类型，尝试通用批准
        debug(`Unknown interaction type: ${JSON.stringify(step.requestedInteraction)}`);
        interaction.runCommand = { confirm: true };
    }

    const body = { cascadeId, interaction };
    debug(`Approve request: ${JSON.stringify(body)}`);

    const r = await grpcCall(ls.port, ls.csrf, 'HandleCascadeUserInteraction', body);

    if (r.status === 200) {
        return { success: true, method: 'HandleCascadeUserInteraction' };
    }

    // Fallback: ResolveOutstandingSteps
    debug(`HandleCascadeUserInteraction failed (${r.status}): ${JSON.stringify(r.data)}`);
    const r2 = await grpcCall(ls.port, ls.csrf, 'ResolveOutstandingSteps', { cascadeId });
    if (r2.status === 200) {
        return { success: true, method: 'ResolveOutstandingSteps' };
    }

    return {
        success: false,
        error: `HandleCascadeUserInteraction: ${r.status} ${JSON.stringify(r.data)} | ResolveOutstandingSteps: ${r2.status} ${JSON.stringify(r2.data)}`,
    };
}

// ========== 主循环 ==========

async function main() {
    console.log('');
    console.log('  Auto-Approve Daemon v2');
    console.log('  ─────────────────────────────────');
    console.log(`  Platform:  ${IS_WINDOWS ? 'Windows' : 'Linux'}`);
    console.log(`  Interval:  ${POLL_INTERVAL}ms`);
    console.log(`  Dry-run:   ${DRY_RUN}`);
    console.log(`  Once:      ${ONCE}`);
    console.log('  ─────────────────────────────────');
    console.log('');

    // 发现 LS
    log('Discovering LS instances...');
    let lsInstances = discoverAllLS();

    if (lsInstances.length === 0) {
        log('No LS instances found. Exiting.');
        process.exit(1);
    }

    // 验证每个 LS
    const verified = [];
    for (const ls of lsInstances) {
        const ok = await verifyLS(ls);
        if (ok) {
            verified.push(ls);
            log(`  [OK] PID=${ls.pid} port=${ls.port} workspace=${ls.workspace}`);
        } else {
            // 尝试相邻端口
            for (const offset of [1, -1, 2]) {
                const tryLs = { ...ls, port: ls.port + offset };
                const ok2 = await verifyLS(tryLs);
                if (ok2) {
                    verified.push(tryLs);
                    log(`  [OK] PID=${ls.pid} port=${tryLs.port} (adjusted)`);
                    break;
                }
            }
        }
    }

    if (verified.length === 0) {
        log('No LS instances responding. Exiting.');
        process.exit(1);
    }

    log(`Monitoring ${verified.length} LS instance(s). Press Ctrl+C to stop.\n`);

    // 监控循环
    let lastRediscoverTime = Date.now();

    while (true) {
        for (const ls of verified) {
            try {
                const conversations = await getRunningConversations(ls);

                for (const conv of conversations) {
                    const waitingSteps = await findWaitingSteps(ls, conv.id);

                    for (const step of waitingSteps) {
                        const key = `${conv.id}:${step.index}`;
                        if (approvedKeys.has(key)) continue;

                        const shortType = step.type.replace('CORTEX_STEP_TYPE_', '');
                        log(`WAITING detected -- [${shortType}] ${step.detail}`);
                        log(`  Conversation: ${conv.summary} (step #${step.index})`);

                        if (DRY_RUN) {
                            log('  [DRY-RUN] Skipping approval.');
                            approvedKeys.add(key);
                            continue;
                        }

                        const result = await approveStep(ls, conv.id, step);
                        if (result.success) {
                            log(`  APPROVED via ${result.method}`);
                            approvedKeys.add(key);
                        } else {
                            log(`  FAILED: ${result.error}`);
                            // 不加入 approvedKeys，下次轮询会重试
                        }
                    }
                }
            } catch (e) {
                debug(`Error monitoring LS PID=${ls.pid}: ${e.message}`);
            }
        }

        if (ONCE) break;

        // 每 5 分钟重新发现 LS
        if (Date.now() - lastRediscoverTime > 5 * 60 * 1000) {
            debug('Re-discovering LS instances...');
            const fresh = discoverAllLS();
            for (const ls of fresh) {
                const exists = verified.some(v => v.pid === ls.pid);
                if (!exists) {
                    const ok = await verifyLS(ls);
                    if (ok) {
                        verified.push(ls);
                        log(`New LS discovered: PID=${ls.pid} port=${ls.port}`);
                    }
                }
            }
            for (let i = verified.length - 1; i >= 0; i--) {
                const ok = await verifyLS(verified[i]);
                if (!ok) {
                    log(`LS PID=${verified[i].pid} gone. Removing.`);
                    verified.splice(i, 1);
                }
            }
            lastRediscoverTime = Date.now();
        }

        await sleep(POLL_INTERVAL);
    }

    log('Done.');
}

main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
});
