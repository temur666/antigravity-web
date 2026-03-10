/**
 * lib/core/ls/index.js — LS 模块统一导出
 */

const { parseDiscoveryFile, isPidAlive, discoverLS, discoverLSAsync, discoverProcessCandidates, DEFAULT_DAEMON_DIR } = require('./discovery');
const { grpcCall, clearProtocolCache, getProtocolForPort, SERVICE_PATH } = require('./grpc');
const { StreamClient } = require('./stream-client');
const { LSManager } = require('./manager');

module.exports = {
    // discovery
    parseDiscoveryFile,
    isPidAlive,
    discoverLS,
    discoverLSAsync,
    discoverProcessCandidates,
    DEFAULT_DAEMON_DIR,

    // grpc
    grpcCall,
    clearProtocolCache,
    getProtocolForPort,
    SERVICE_PATH,

    // stream
    StreamClient,

    // manager
    LSManager,
};
