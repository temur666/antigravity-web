/**
 * lib/service.js — 业务编排层
 *
 * 这是前端（CLI / Web / Telegram）调用的统一接口。
 * 编排 api.js + conversations.js + format.js，返回纯数据，不做 I/O。
 *
 * 设计原则:
 *   - 所有方法返回 {data, error} 格式（不 throw）
 *   - 不做 console.log（由调用者决定如何展示）
 *   - 不做文件读写（由调用者决定如何存储）
 */

const api = require('./api');
const { getConversations } = require('./conversations');
const format = require('./format');

// ========== 状态 ==========

let initialized = false;

// ========== 初始化 ==========

/**
 * 初始化 Service 层（底层会初始化 API）
 * @param {object} [options]
 * @param {boolean} [options.processOnly] - 只用进程方式获取 CSRF
 * @param {boolean} [options.quiet] - 不打印日志
 * @returns {{ success: boolean, error?: string, endpoints?: Array }}
 */
async function init(options = {}) {
    // 临时重定向 console.log
    const originalLog = console.log;
    const logs = [];
    if (options.quiet) {
        console.log = (...args) => logs.push(args.join(' '));
    }

    try {
        await api.init({ processOnly: options.processOnly });
        initialized = true;
        const status = api.getStatus();
        return {
            success: true,
            endpoints: status.endpoints,
            activePort: status.activePort,
            logs,
        };
    } catch (e) {
        return { success: false, error: e.message, logs };
    } finally {
        if (options.quiet) console.log = originalLog;
    }
}

// ========== 对话列表 ==========

/**
 * 获取对话列表
 * @param {object} [options]
 * @param {number} [options.limit] - 最大数量
 * @param {boolean} [options.localOnly] - 只显示本地工作区
 * @param {string} [options.search] - 按标题搜索
 * @returns {{ conversations: Array, total: number, error?: string }}
 */
function listConversations(options = {}) {
    const result = getConversations();
    if (result.error) {
        return { conversations: [], total: 0, error: result.error };
    }

    let convs = result.conversations;

    // 过滤：只保留本地
    if (options.localOnly) {
        convs = convs.filter(c =>
            c.workspace && !c.workspace.includes('SSH') && !c.workspace.includes('WSL')
        );
    }

    // 搜索
    if (options.search) {
        const q = options.search.toLowerCase();
        convs = convs.filter(c =>
            (c.title || '').toLowerCase().includes(q) ||
            (c.id || '').toLowerCase().includes(q)
        );
    }

    const total = convs.length;

    // 限制数量
    if (options.limit) {
        convs = convs.slice(0, options.limit);
    }

    return { conversations: convs, total };
}

/**
 * 通过索引或 ID 找到对话
 * @param {string|number} idOrIndex - 对话 ID 或在列表中的索引
 * @param {object} [listOptions] - 传给 listConversations 的选项
 * @returns {{ conversation: object|null, error?: string }}
 */
function findConversation(idOrIndex, listOptions = {}) {
    const { conversations } = listConversations(listOptions);
    if (conversations.length === 0) {
        return { conversation: null, error: '没有找到任何对话' };
    }

    // 如果是数字（索引）
    if (typeof idOrIndex === 'number' || /^\d+$/.test(idOrIndex)) {
        const idx = Number(idOrIndex);
        if (idx < 0 || idx >= conversations.length) {
            return { conversation: null, error: `索引 ${idx} 超出范围 (0-${conversations.length - 1})` };
        }
        return { conversation: conversations[idx] };
    }

    // 如果是 UUID 格式的 ID
    const conv = conversations.find(c => c.id === idOrIndex);
    if (conv) return { conversation: conv };

    // 部分 ID 匹配
    const partial = conversations.find(c => c.id.startsWith(idOrIndex));
    if (partial) return { conversation: partial };

    // 标题匹配
    const byTitle = conversations.find(c =>
        (c.title || '').toLowerCase().includes(idOrIndex.toLowerCase())
    );
    if (byTitle) return { conversation: byTitle };

    return { conversation: null, error: `未找到匹配 "${idOrIndex}" 的对话` };
}

// ========== 对话内容 ==========

/**
 * 获取对话的完整内容
 * 自动遍历所有端口：如果一个端口返回 not found，尝试下一个
 * @param {string} cascadeId
 * @param {object} [options]
 * @param {string} [options.port] - 指定端口（不指定则自动遍历）
 * @returns {{ data: object|null, port?: string, error?: string }}
 */
async function getConversation(cascadeId, options = {}) {
    if (!initialized) {
        const initResult = await init({ quiet: true });
        if (!initResult.success) {
            return { data: null, error: `API 未初始化: ${initResult.error}` };
        }
    }

    // 如果指定了端口，直接用
    if (options.port) {
        try {
            const data = await api.getTrajectory(cascadeId, options);
            if (!data || !data.trajectory) {
                return { data: null, error: 'trajectory 数据为空' };
            }
            return { data, port: options.port };
        } catch (e) {
            return { data: null, error: e.message };
        }
    }

    // 自动遍历所有端口（先试 activePort，再试其他）
    const status = api.getStatus();
    const ports = status.endpoints.map(e => e.port);
    // 把 activePort 放在最前面
    if (status.activePort) {
        const idx = ports.indexOf(status.activePort);
        if (idx > 0) { ports.splice(idx, 1); ports.unshift(status.activePort); }
    }

    const errors = [];
    for (const port of ports) {
        try {
            const data = await api.getTrajectory(cascadeId, { ...options, port });
            if (data && data.trajectory) {
                return { data, port };
            }
        } catch (e) {
            errors.push(`port ${port}: ${e.message}`);
        }
    }

    return { data: null, error: `所有端口都未找到对话 ${cascadeId.substring(0, 8)}:\n  ${errors.join('\n  ')}` };
}

/**
 * 导出对话（返回格式化数据，不写文件）
 * @param {string} cascadeId
 * @param {object} [options]
 * @param {string} [options.title] - 对话标题（用于 Markdown 标题）
 * @param {boolean} [options.includeToolCalls] - 是否包含工具调用
 * @param {boolean} [options.includeThinking] - 是否包含思考过程
 * @param {string} [options.port]
 * @returns {{ markdown: string, json: object, metadata: object, error?: string }}
 */
async function exportConversation(cascadeId, options = {}) {
    const result = await getConversation(cascadeId, options);
    if (result.error) {
        return { markdown: '', json: null, metadata: null, error: result.error };
    }

    const title = options.title || 'Untitled';
    const markdown = format.toMarkdown(result.data, title, options);
    const metadata = format.extractMetadata(result.data);

    return {
        markdown,
        json: result.data,
        metadata: { ...metadata, title, cascadeId },
    };
}

// ========== P3 预留: 消息发送 ==========

/**
 * 发送消息到对话（P3 预留）
 * @param {string} cascadeId
 * @param {string} text
 * @param {object} [options]
 * @returns {{ success: boolean, error?: string }}
 */
async function sendMessage(cascadeId, text, options = {}) {
    if (!initialized) {
        const initResult = await init({ quiet: true });
        if (!initResult.success) return { success: false, error: initResult.error };
    }

    try {
        await api.sendMessage(cascadeId, text, options);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * 创建新对话（P3 预留）
 * @param {object} [options]
 * @returns {{ cascadeId: string|null, error?: string }}
 */
async function newChat(options = {}) {
    if (!initialized) {
        const initResult = await init({ quiet: true });
        if (!initResult.success) return { cascadeId: null, error: initResult.error };
    }

    try {
        const result = await api.startCascade(options);
        return { cascadeId: result.cascadeId };
    } catch (e) {
        return { cascadeId: null, error: e.message };
    }
}

// ========== 状态 ==========

/**
 * 获取 API 状态
 * @returns {object}
 */
function getStatus() {
    return {
        initialized,
        api: api.getStatus(),
    };
}

module.exports = {
    init,
    listConversations,
    findConversation,
    getConversation,
    exportConversation,
    sendMessage,
    newChat,
    getStatus,

    // 直接导出格式化工具（方便前端使用）
    format,
};
