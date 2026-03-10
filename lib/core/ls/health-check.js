/**
 * lib/core/ls/health-check.js — LS 健康验证
 *
 * 职责:
 *   1. checkVersion: 版本号校验 (最低版本要求)
 *   2. smokeTest: 业务冒烟测试 (StartCascade → DeleteCascadeTrajectory)
 *   3. fullHealthCheck: 版本 + 冒烟 的组合验证
 *
 * 设计:
 *   - 只依赖 grpc.js，不依赖 conversation 模块
 *   - 所有函数返回 { ok, error?, detail? }，调用方决定如何处理
 */

const { grpcCall } = require('./grpc');

// 最低支持版本 (1.19.0 — StreamCascadeReactiveUpdates API 可用)
const MIN_VERSION = { major: 1, minor: 19, patch: 0 };

/**
 * 解析语义化版本号
 * @param {string} versionStr - 如 '1.19.4'
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(versionStr) {
    if (!versionStr || versionStr === 'unknown') return null;

    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;

    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
    };
}

/**
 * 比较版本: a >= b ?
 * @param {{ major: number, minor: number, patch: number }} a
 * @param {{ major: number, minor: number, patch: number }} b
 * @returns {boolean}
 */
function isVersionGte(a, b) {
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    return a.patch >= b.patch;
}

/**
 * 版本号校验
 * @param {{ port: number, csrf: string, pid: number, version: string }} ls
 * @returns {{ ok: boolean, error?: string, detail?: object }}
 */
function checkVersion(ls) {
    const parsed = parseVersion(ls.version);

    if (!parsed) {
        // version 为 'unknown' (进程 fallback 路径) — 放行但 warn
        return {
            ok: true,
            detail: { version: ls.version, warning: 'Version unknown, skipping version check' },
        };
    }

    if (!isVersionGte(parsed, MIN_VERSION)) {
        return {
            ok: false,
            error: `LS version ${ls.version} is below minimum ${MIN_VERSION.major}.${MIN_VERSION.minor}.${MIN_VERSION.patch}`,
            detail: { version: ls.version, parsed, required: MIN_VERSION },
        };
    }

    return { ok: true, detail: { version: ls.version, parsed } };
}

/**
 * 业务冒烟测试: StartCascade → DeleteCascadeTrajectory
 * 验证 LS 核心业务 API 可用，不仅仅是 Heartbeat 活着
 * @param {{ port: number, csrf: string }} ls
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ ok: boolean, error?: string, detail?: object }>}
 */
async function smokeTest(ls, timeoutMs = 5000) {
    let cascadeId = null;
    try {
        // Step 1: 创建对话
        const createResult = await grpcCall(ls.port, ls.csrf, 'StartCascade', {}, timeoutMs);
        cascadeId = createResult.data?.cascadeId;

        if (!cascadeId) {
            return {
                ok: false,
                error: 'StartCascade returned no cascadeId',
                detail: { response: createResult.data },
            };
        }

        // Step 2: 删除对话 (清理)
        await grpcCall(ls.port, ls.csrf, 'DeleteCascadeTrajectory', { cascadeId }, timeoutMs);

        return { ok: true, detail: { cascadeId, cleaned: true } };
    } catch (err) {
        // 如果创建成功但删除失败，尝试清理
        if (cascadeId) {
            try {
                await grpcCall(ls.port, ls.csrf, 'DeleteCascadeTrajectory', { cascadeId }, timeoutMs);
            } catch { /* 尽力清理 */ }
        }

        return {
            ok: false,
            error: `Smoke test failed: ${err.message}`,
            detail: { cascadeId, originalError: err.message },
        };
    }
}

/**
 * 完整健康检查: 版本校验 + 业务冒烟测试
 * @param {{ port: number, csrf: string, pid: number, version: string }} ls
 * @returns {Promise<{ ok: boolean, version: object, smoke: object }>}
 */
async function fullHealthCheck(ls) {
    const versionResult = checkVersion(ls);

    if (!versionResult.ok) {
        console.error(`[HealthCheck] ${versionResult.error}`);
        return { ok: false, version: versionResult, smoke: null };
    }

    if (versionResult.detail?.warning) {
        console.warn(`[HealthCheck] ${versionResult.detail.warning}`);
    }

    const smokeResult = await smokeTest(ls);

    if (!smokeResult.ok) {
        console.error(`[HealthCheck] ${smokeResult.error}`);
        return { ok: false, version: versionResult, smoke: smokeResult };
    }

    console.log(`[HealthCheck] OK — version=${ls.version}, smoke=pass`);
    return { ok: true, version: versionResult, smoke: smokeResult };
}

module.exports = {
    parseVersion,
    isVersionGte,
    checkVersion,
    smokeTest,
    fullHealthCheck,
    MIN_VERSION,
};
