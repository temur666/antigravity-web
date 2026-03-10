/**
 * lib/core/ls-discovery.js — 兼容性 re-export
 *
 * 已重构拆分为:
 *   - ls/discovery.js  (发现逻辑)
 *   - ls/grpc.js       (gRPC 传输)
 *
 * 本文件保留所有原始导出，确保外部引用无需修改。
 */

const { parseDiscoveryFile, isPidAlive, discoverLS, discoverLSAsync, discoverProcessCandidates, DEFAULT_DAEMON_DIR } = require('./ls/discovery');
const { grpcCall, clearProtocolCache, getProtocolForPort, SERVICE_PATH } = require('./ls/grpc');

module.exports = {
    parseDiscoveryFile,
    isPidAlive,
    discoverLS,
    discoverLSAsync,
    discoverProcessCandidates,
    grpcCall,
    clearProtocolCache,
    getProtocolForPort,
    DEFAULT_DAEMON_DIR,
    SERVICE_PATH,
};
