/**
 * lib/yolo/logger.js — YOLO 日志模块
 *
 * 同时输出到控制台和日志文件。支持回合记录。
 * 使用同步写入（YOLO 日志频率低，同步保证数据完整性）。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_DIR = path.join(__dirname, '..', '..', 'logs');

class Logger {
    /**
     * @param {string} [logDir] - 日志目录（默认 PROJECT_ROOT/logs）
     */
    constructor(logDir = DEFAULT_LOG_DIR) {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.logPath = path.join(logDir, `yolo-${ts}.log`);
        fs.writeFileSync(this.logPath, ''); // 创建空文件
        this.roundCount = 0;
        this._closed = false;
    }

    log(level, msg) {
        const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
        console.log(line);
        if (!this._closed) {
            fs.appendFileSync(this.logPath, line + '\n');
        }
    }

    info(msg) { this.log('INFO', msg); }
    warn(msg) { this.log('WARN', msg); }
    error(msg) { this.log('ERROR', msg); }

    logRound(roundNum, aiResponsePreview) {
        this.roundCount = roundNum;
        this.info(`--- 第 ${roundNum} 轮完成 ---`);
        if (aiResponsePreview) {
            this.info(`AI 回复:\n${aiResponsePreview}`);
        }
    }

    close() {
        this._closed = true;
    }
}

module.exports = { Logger };
