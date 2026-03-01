/**
 * lib/telegram/config.js — Telegram Bot 配置
 *
 * 集中管理 Bot Token、用户白名单、Emoji 映射等配置。
 * 从 tg-antigravity/lib/config.js 移植。
 */

// ========== 基础配置 ==========

const BOT_TOKEN = process.env.TG_BOT_TOKEN || '8244102084:AAGZFOQC7rxQdX4AejKoPos1GkUCgcAEQwA';
const ALLOWED_USER_ID = Number(process.env.TG_USER_ID || '1888186582');

// ========== 流式更新配置 ==========

const STREAM_UPDATE_MS = 1000;    // Telegram 编辑间隔: 1s (Telegram API 硬限制)
const DRAFT_UPDATE_MS = 300;      // Draft 模式更新间隔: 300ms

// ========== Custom Emoji 配置 ==========

const USE_CUSTOM_EMOJI = process.env.USE_CUSTOM_EMOJI === 'true';

const EMOJI = {
    TYPING: { id: '5368324170671202286', fb: '⌨️' },
    ROCKET: { id: '5386367538735104399', fb: '🚀' },
    CHECK: { id: '5427009714745517609', fb: '✅' },
    CROSS: { id: '5440539497383087970', fb: '❌' },
    CAMERA: { id: '5424885441100782420', fb: '📸' },
    SEND: { id: '5413879192020029734', fb: '📤' },
    REFRESH: { id: '5447183459602669338', fb: '🔄' },
    STATUS: { id: '5431456208487716869', fb: '📊' },
    STOP: { id: '5210956306952758722', fb: '⛔' },
    COMPUTER: { id: '5368324170671202286', fb: '💻' },
    WARN: { id: '5465665476971471368', fb: '⚠️' },
    TOPIC: { id: '5413626424677060390', fb: '📌' },
    IMAGE: { id: '5424972587498498498', fb: '🖼' },
};

// ========== 状态持久化路径 ==========

const path = require('path');
const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'tg-state.json');

module.exports = {
    BOT_TOKEN, ALLOWED_USER_ID,
    STREAM_UPDATE_MS, DRAFT_UPDATE_MS,
    USE_CUSTOM_EMOJI, EMOJI,
    STATE_FILE,
};
