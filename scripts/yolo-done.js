/**
 * scripts/yolo-done.js — YOLO 完成 Hook
 *
 * AI 在完成工作后调用此脚本，触发：
 *   1. 写 .yolo-done 标记文件（熔断 yolo.js 主循环）
 *   2. 发送 Telegram 通知
 *
 * 用法: node scripts/yolo-done.js "工作摘要"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ========== 配置 ==========

const { BOT_TOKEN, ALLOWED_USER_ID } = require('../lib/telegram/config');
const MARKER_FILE = path.join(__dirname, '..', '.yolo-done');

// ========== Telegram 通知 ==========

/**
 * 通过 Telegram Bot API 发送消息（纯 HTTP，不依赖 grammy）
 * @param {string} text - 消息文本
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
                        console.log('[yolo-done] Telegram 通知已发送');
                        resolve(true);
                    } else {
                        console.error(`[yolo-done] Telegram 发送失败: ${res.statusCode} ${body}`);
                        resolve(false);
                    }
                });
            }
        );

        req.on('error', (err) => {
            console.error(`[yolo-done] Telegram 请求错误: ${err.message}`);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

// ========== 主流程 ==========

(async () => {
    const summary = process.argv.slice(2).join(' ') || '(无摘要)';

    // 1. 写标记文件（携带摘要和时间戳）
    const marker = {
        completedAt: new Date().toISOString(),
        summary,
    };
    fs.writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2), 'utf-8');
    console.log(`[yolo-done] 标记文件已写入: ${MARKER_FILE}`);

    // 2. 发 Telegram 通知
    const msg = [
        '<b>YOLO 任务完成</b>',
        '',
        `<b>摘要:</b> ${summary}`,
        `<b>时间:</b> ${marker.completedAt}`,
        '',
        '请检阅工作成果。',
    ].join('\n');

    await sendTelegram(msg);

    console.log('[yolo-done] Done.');
})();
