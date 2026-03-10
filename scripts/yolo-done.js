/**
 * scripts/yolo-done.js — YOLO 完成 Hook
 *
 * AI 在完成工作后调用此脚本，触发：
 *   1. 写 .yolo-done 标记文件（熔断 yolo.js 主循环）
 *   2. 发送 Telegram 通知
 *
 * 用法: node scripts/yolo-done.js "工作摘要"
 */

const { marker, notifyDone } = require('../lib/yolo');

(async () => {
    const summary = process.argv.slice(2).join(' ') || '(无摘要)';

    // 1. 写标记文件
    const m = marker.write(summary);
    console.log(`[yolo-done] 标记文件已写入: ${marker.MARKER_FILE}`);

    // 2. 发 Telegram 通知
    await notifyDone(summary, m.completedAt);

    console.log('[yolo-done] Done.');
})();
