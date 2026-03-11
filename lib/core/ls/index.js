/**
 * lib/core/ls/index.js — LS 模块统一导出
 */

const { parseDiscoveryFile, isPidAlive, discoverLS, discoverLSAsync, discoverProcessCandidates, DEFAULT_DAEMON_DIR } = require('./discovery');
const { grpcCall, clearProtocolCache, getProtocolForPort, SERVICE_PATH } = require('./grpc');
const { AgentStreamClient } = require('./agent-stream-client');
const { LSManager } = require('./manager');
const { checkVersion, smokeTest, fullHealthCheck, parseVersion, isVersionGte, MIN_VERSION } = require('./health-check');

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

    // health-check
    checkVersion,
    smokeTest,
    fullHealthCheck,
    parseVersion,
    isVersionGte,
    MIN_VERSION,

    // stream
    AgentStreamClient,

    // manager
    LSManager,
};
