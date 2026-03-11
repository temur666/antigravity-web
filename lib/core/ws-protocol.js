/**
 * lib/core/ws-protocol.js — 协议工具
 *
 * 保留:
 *   - DEFAULT_CONFIG: Cascade 默认配置
 *   - buildSendBody: 构造 SendUserCascadeMessage 请求体
 *   - makeEvent: 构造 SSE 事件消息
 *   - EVENT_TYPES: 事件类型常量 (文档用途)
 */

// ========== 事件类型常量 ==========

const EVENT_TYPES = [
    'event_step_added',      // 新增 step
    'event_step_updated',    // step 状态变化
    'event_status_changed',  // 对话状态变化 (RUNNING->IDLE)
    'event_metadata_updated',// 对话元数据变化 (token 用量等)
    'event_ls_status',       // LS 连接状态变化
    'event_yolo_status',     // YOLO 状态变化
    'event_yolo_round',      // YOLO 轮次完成
    'event_yolo_step',       // YOLO step
    'event_yolo_error',      // YOLO 错误
];

// ========== 默认配置 ==========

const DEFAULT_CONFIG = {
    model: 'MODEL_PLACEHOLDER_M37',
    agenticMode: false,
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
    knowledgeEnabled: true,
    ephemeralEnabled: true,
    conversationHistoryEnabled: true,
};

// ========== 消息构造 ==========

/**
 * 构造 SSE 事件消息
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

    // 图片/媒体: 顶层 media 字段，使用 inlineData（LS proto oneof payload）
    if (extras.media && extras.media.length > 0) {
        body.media = [];
        for (const m of extras.media) {
            if (m.data) {
                // base64 data 直接使用
                body.media.push({ mimeType: m.mimeType, inlineData: m.data });
            } else if (m.uri && m.uri.startsWith('file://')) {
                // file:// URI: 读取文件并转 base64
                try {
                    const filePath = m.uri.replace('file://', '');
                    const fs = require('fs');
                    const buf = fs.readFileSync(filePath);
                    body.media.push({ mimeType: m.mimeType, inlineData: buf.toString('base64') });
                } catch (err) {
                    console.warn('[buildSendBody] Failed to read media file:', m.uri, err.message);
                }
            }
        }
    }

    return body;
}

module.exports = {
    EVENT_TYPES,
    DEFAULT_CONFIG,
    makeEvent,
    buildSendBody,
};
