/**
 * lib/yolo/marker.js — YOLO 标记文件操作
 *
 * 管理 .yolo-done 标记文件的读写，用于 YOLO 主循环的熔断检测。
 */

const fs = require('fs');
const path = require('path');

const MARKER_FILE = path.join(__dirname, '..', '..', '.yolo-done');

/**
 * 检测标记文件是否存在
 * @returns {boolean}
 */
function check() {
    return fs.existsSync(MARKER_FILE);
}

/**
 * 清理标记文件（不存在时静默忽略）
 */
function clean() {
    try { fs.unlinkSync(MARKER_FILE); } catch { /* ignore */ }
}

/**
 * 写入标记文件
 * @param {string} summary - 完成摘要
 * @returns {{ completedAt: string, summary: string }}
 */
function write(summary = '(无摘要)') {
    const marker = {
        completedAt: new Date().toISOString(),
        summary,
    };
    fs.writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2), 'utf-8');
    return marker;
}

/**
 * 读取标记文件内容
 * @returns {{ completedAt: string, summary: string } | null}
 */
function read() {
    try {
        return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

module.exports = { check, clean, write, read, MARKER_FILE };
