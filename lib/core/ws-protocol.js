/**
 * lib/ws-protocol.js — WebSocket 协议 v2 定义
 *
 * 设计原则:
 *   - 所有消息都有 type 字段
 *   - 请求-响应: 客户端 req_* → 服务端 res_*
 *   - 服务端推送: event_*
 *   - 请求带可选 reqId，响应回带同一个 reqId
 */

// ========== 消息类型常量 ==========

const REQ_TYPES = [
    'req_status',          // 查询 LS 状态
    'req_conversations',   // 获取对话列表
    'req_trajectory',      // 获取完整对话内容
    'req_new_chat',        // 创建新对话
    'req_send_message',    // 发送消息
    'req_subscribe',       // 订阅对话实时更新
    'req_unsubscribe',     // 取消订阅
    'req_set_config',      // 修改默认配置
    'req_get_config',      // 获取当前配置
];

const RES_TYPES = [
    'res_status',          // LS 状态响应
    'res_conversations',   // 对话列表
    'res_trajectory',      // 完整轨迹
    'res_new_chat',        // 新对话 ID
    'res_send_message',    // 消息已发送
    'res_subscribe',       // 订阅确认
    'res_unsubscribe',     // 取消订阅确认
    'res_config',          // 当前配置
    'res_error',           // 错误响应
];

const EVENT_TYPES = [
    'event_step_added',      // 新增 step
    'event_step_updated',    // step 状态变化
    'event_status_changed',  // 对话状态变化 (RUNNING→IDLE)
    'event_ls_status',       // LS 连接状态变化
];

// ========== 默认配置 ==========

const DEFAULT_CONFIG = {
    model: 'MODEL_PLACEHOLDER_M37',
    agenticMode: true,
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
    knowledgeEnabled: true,
    ephemeralEnabled: true,
    conversationHistoryEnabled: true,
};

// ========== 消息解析 ==========

/**
 * 解析 WebSocket 消息
 * @param {string} raw - 原始 JSON 字符串
 * @returns {object} 解析后的消息对象，失败返回 { type: 'error', message: '...' }
 */
function parseMessage(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return { type: 'error', message: 'Invalid JSON' };
    }

    if (!data.type) {
        return { type: 'error', message: 'Missing type field' };
    }

    return data;
}

// ========== 消息构造 ==========

/**
 * 构造响应消息
 * @param {string} type - 响应类型
 * @param {object} payload - 响应数据
 * @param {string} [reqId] - 关联的请求 ID
 * @returns {string} JSON 字符串
 */
function makeResponse(type, payload, reqId) {
    const msg = { type, ...payload };
    if (reqId !== undefined) msg.reqId = reqId;
    return JSON.stringify(msg);
}

/**
 * 构造错误响应
 * @param {string} code - 错误码
 * @param {string} message - 错误信息
 * @param {string} [reqId]
 * @returns {string} JSON 字符串
 */
function makeError(code, message, reqId) {
    const msg = { type: 'res_error', code, message };
    if (reqId !== undefined) msg.reqId = reqId;
    return JSON.stringify(msg);
}

/**
 * 构造事件消息
 * @param {string} type - 事件类型
 * @param {object} payload - 事件数据
 * @returns {string} JSON 字符串
 */
function makeEvent(type, payload) {
    return JSON.stringify({ type, ...payload });
}

// ========== 请求体构造 ==========

/**
 * 构造 SendUserCascadeMessage 的完整请求体
 * @param {string} cascadeId
 * @param {string} text - 消息文本
 * @param {object} config - 配置 (使用 DEFAULT_CONFIG 的字段)
 * @param {object} [extras] - 额外数据
 * @param {Array} [extras.mentions] - @mention 文件引用 [{ file: { absoluteUri } }]
 * @param {Array} [extras.media] - 图片/媒体 [{ mimeType, uri, thumbnail }]
 * @returns {object} 完整请求体
 */
function buildSendBody(cascadeId, text, config = DEFAULT_CONFIG, extras = {}) {
    // 构建 items 数组: text + mentions
    const items = [{ text }];
    if (extras.mentions && extras.mentions.length > 0) {
        for (const mention of extras.mentions) {
            items.push({ item: mention });
        }
        items.push({ text: ' ' }); // IDE 行为: @mention 后跟空格
    }

    const body = {
        cascadeId,
        items,
        metadata: {
            ideName: 'antigravity',
            apiKey: '',
            locale: 'zh',
            ideVersion: '1.19.5',
            extensionName: 'antigravity',
        },
        cascadeConfig: {
            plannerConfig: {
                conversational: {
                    plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT',
                    agenticMode: config.agenticMode,
                },
                toolConfig: {
                    runCommand: {
                        autoCommandConfig: {
                            autoExecutionPolicy: config.autoExecutionPolicy,
                        },
                    },
                    notifyUser: {
                        artifactReviewMode: config.artifactReviewMode,
                    },
                },
                requestedModel: {
                    model: config.model,
                },
                ephemeralMessagesConfig: {
                    enabled: config.ephemeralEnabled,
                },
                knowledgeConfig: {
                    enabled: config.knowledgeEnabled,
                },
            },
            conversationHistoryConfig: {
                enabled: config.conversationHistoryEnabled,
            },
        },
        clientType: 'CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE',
    };

    // 图片/媒体: 通过文件路径引用
    if (extras.media && extras.media.length > 0) {
        body.media = extras.media;
    }

    return body;
}

module.exports = {
    REQ_TYPES,
    RES_TYPES,
    EVENT_TYPES,
    DEFAULT_CONFIG,
    parseMessage,
    makeResponse,
    makeError,
    makeEvent,
    buildSendBody,
};
