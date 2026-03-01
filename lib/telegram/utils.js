/**
 * lib/telegram/utils.js — Telegram 工具函数
 *
 * 封装 Telegram Bot API 的常用操作。
 * 从 tg-antigravity/lib/telegram.js 移植。
 */

const { USE_CUSTOM_EMOJI } = require('./config');

/**
 * 生成自定义 Emoji HTML，降级回普通 Emoji
 * @param {{ id: string, fb: string }} e
 * @returns {string}
 */
function ce(e) {
    return USE_CUSTOM_EMOJI
        ? `<tg-emoji emoji-id="${e.id}">${e.fb}</tg-emoji>`
        : e.fb;
}

/**
 * HTML 转义（防止动态内容破坏 HTML）
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 安全编辑消息（忽略 "message is not modified" 错误和限流）
 * @param {import('grammy').Api} api
 * @param {number} chatId
 * @param {number} msgId
 * @param {string} text
 * @param {string} [parseMode]
 * @returns {Promise<boolean>}
 */
async function safeEditText(api, chatId, msgId, text, parseMode) {
    try {
        const opts = parseMode ? { parse_mode: parseMode } : {};
        await api.editMessageText(chatId, msgId, text, opts);
        return true;
    } catch (err) {
        if (err.error_code === 400) {
            // 降级纯文本重试
            if (parseMode) {
                try {
                    const plain = text.replace(/<[^>]+>/g, '');
                    await api.editMessageText(chatId, msgId, plain);
                    return true;
                } catch { /* ignore */ }
            }
            return false;
        }
        if (err.error_code === 429) return false;
        throw err;
    }
}

/**
 * Telegram 单条消息最大 4096 字符，安全截断
 * @param {string} text
 * @param {number} [maxLen=4000]
 * @returns {string}
 */
function truncateForTG(text, maxLen = 4000) {
    if (!text) return '(空回复)';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '\n\n... (已截断)';
}

module.exports = { ce, esc, safeEditText, truncateForTG };
