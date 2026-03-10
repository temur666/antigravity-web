/**
 * lib/yolo/notify.js — YOLO 通知模块
 *
 * 通过 Telegram Bot API 发送 YOLO 完成通知（纯 HTTP，不依赖 grammy）。
 */

const https = require('https');
const { BOT_TOKEN, ALLOWED_USER_ID } = require('../telegram/config');

/**
 * 通过 Telegram Bot API 发送消息
 * @param {string} text - 消息文本（HTML 格式）
 * @returns {Promise<boolean>}
 */
function sendTelegram(text) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            chat_id: ALLOWED_USER_ID,
            text,
            parse_mode: 'HTML',
        });

        const req = https.request(
            {
                hostname: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 10000,
            },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('[yolo-notify] Telegram 通知已发送');
                        resolve(true);
                    } else {
                        console.error(`[yolo-notify] Telegram 发送失败: ${res.statusCode} ${body}`);
                        resolve(false);
                    }
                });
            }
        );

        req.on('error', (err) => {
            console.error(`[yolo-notify] Telegram 请求错误: ${err.message}`);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

/**
 * 发送 YOLO 完成通知
 * @param {string} summary - 完成摘要
 * @param {string} [completedAt] - 完成时间 ISO 字符串
 * @returns {Promise<boolean>}
 */
async function notifyDone(summary, completedAt) {
    const time = completedAt || new Date().toISOString();
    const msg = [
        '<b>YOLO 任务完成</b>',
        '',
        `<b>摘要:</b> ${summary}`,
        `<b>时间:</b> ${time}`,
        '',
        '请检阅工作成果。',
    ].join('\n');

    return sendTelegram(msg);
}

module.exports = { sendTelegram, notifyDone };
