/**
 * lib/yolo/index.js — YOLO 模块统一导出
 */

const { YoloEngine, safeCall, sleep } = require('./engine');
const { Logger } = require('./logger');
const marker = require('./marker');
const { parseArgs, AUTO_REPLY_TEMPLATE, DEFAULTS } = require('./config');
const { sendTelegram, notifyDone } = require('./notify');

module.exports = {
    YoloEngine,
    Logger,
    marker,
    parseArgs,
    AUTO_REPLY_TEMPLATE,
    DEFAULTS,
    sendTelegram,
    notifyDone,
    // 内部辅助（测试用）
    safeCall,
    sleep,
};
