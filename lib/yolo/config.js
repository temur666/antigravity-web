/**
 * lib/yolo/config.js — YOLO 配置与参数解析
 *
 * 包含 CLI 参数解析、自动回复模板和默认配置。
 */

// ========== 自动回复模板 ==========

const AUTO_REPLY_TEMPLATE = `继续你的工作，自行判断所有决策。
- 遇到错误：分析原因，尝试解决，解决不了就跳过并记录
- 产品决策：从用户价值角度思考
- 技术决策：从架构合理性角度思考
- 完成所有工作后：按照参考文档中的完成 Hook 执行`;

// ========== 默认配置 ==========

const DEFAULTS = {
    timeout: 7200,
    cooldown: 5,
    pollInterval: 3,
    agentic: false,
    maxConsecutiveErrors: 10,
    maxPollCount: 600,
};

// ========== CLI 参数解析 ==========

/**
 * 解析命令行参数
 * @param {string[]} [argv] - 参数数组（默认 process.argv.slice(2)）
 * @returns {object} 解析后的配置
 */
function parseArgs(argv) {
    const args = argv || process.argv.slice(2);
    const config = {
        docPath: null,
        task: null,
        timeout: DEFAULTS.timeout,
        port: null,
        csrf: null,
        cascadeId: null,
        cooldown: DEFAULTS.cooldown,
        pollInterval: DEFAULTS.pollInterval,
        agentic: DEFAULTS.agentic,
    };

    let i = 0;
    while (i < args.length) {
        switch (args[i]) {
            case '--timeout':
                config.timeout = parseInt(args[++i], 10);
                break;
            case '--port':
                config.port = parseInt(args[++i], 10);
                break;
            case '--csrf':
                config.csrf = args[++i];
                break;
            case '--cascade':
                config.cascadeId = args[++i];
                break;
            case '--cooldown':
                config.cooldown = parseInt(args[++i], 10);
                break;
            case '--poll-interval':
                config.pollInterval = parseInt(args[++i], 10);
                break;
            case '--agentic':
                config.agentic = true;
                break;
            case '--task':
                config.task = args[++i];
                break;
            default:
                if (!args[i].startsWith('--') && !config.docPath) {
                    config.docPath = args[i];
                }
                break;
        }
        i++;
    }

    return config;
}

module.exports = { parseArgs, AUTO_REPLY_TEMPLATE, DEFAULTS };
