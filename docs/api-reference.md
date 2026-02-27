# Antigravity API 完整参考

> 版本: 2026-02-27 | 基于 LS v1.19.5 逆向分析

## 目录

- [一、架构概览](#一架构概览)
- [二、LS gRPC API](#二ls-grpc-api)
- [三、WebSocket v2 协议](#三websocket-v2-协议)
- [四、模型配置](#四模型配置)
- [五、数据类型](#五数据类型)
- [六、快速上手](#六快速上手)

---

## 一、架构概览

```
┌──────────────┐     WebSocket v2      ┌──────────────┐      gRPC/HTTPS      ┌────────────┐
│   Frontend   │ ◄──────────────────► │   server     │ ◄──────────────────► │  Language   │
│   (React)    │   req_*/res_*/event_* │   (BFF)      │  SendUserCascade..  │   Server   │
└──────────────┘                       └──────────────┘                      └────────────┘
                                              │
                                              │ lib/
                                       ┌──────┴──────┐
                                       │ controller  │ ← 对话管理、轮询、Diff
                                       │ ls-discovery│ ← LS 端口/CSRF 发现
                                       │ ws-protocol │ ← 协议定义、请求构造
                                       │ conversations│← SQLite/PB 数据读取
                                       │ service     │ ← CLI 高级 API
                                       │ format      │ ← 输出格式化
                                       └─────────────┘
```

### 数据流

1. **前端** 通过 WebSocket 发送 `req_*` 消息
2. **server** 解析消息，调用 Controller
3. **Controller** 通过 `ls-discovery.grpcCall()` 调用 LS gRPC API
4. **LS** 返回结果，Controller 计算 Diff，通过 WebSocket 推送 `event_*`

---

## 二、LS gRPC API

### 连接方式

```
URL:    https://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/{METHOD}
Method: POST
Headers:
  Content-Type: application/json
  x-codeium-csrf-token: {CSRF_TOKEN}
  connect-protocol-version: 1
```

### 端口发现

- **Discovery 文件**: `~/.gemini/antigravity/daemon/ls_*.json`（优先）
- **进程参数**: `ps aux | grep language_server` → `--csrf_token`，再通过 `ss -tlnp` 找端口

### CSRF Token 获取

- **Discovery 文件**: `~/.gemini/antigravity/daemon/ls_*.json` → `csrfToken` 字段
- **CDP 方式**: 通过 Chrome DevTools Protocol 从 IDE 窗口拦截 Heartbeat 请求头

---

### API 方法列表

#### 1. `StartCascade` — 创建新对话

```json
// 请求
{}

// 响应
{
    "cascadeId": "uuid-string"
}
```

#### 2. `SendUserCascadeMessage` — 发送用户消息（核心）

**完整请求体：**

```javascript
{
    // 对话 ID
    cascadeId: "uuid",

    // ======== 用户消息 ========
    items: [
        { text: "消息文本" },
        // @mention 文件引用（可选）
        { item: { file: { absoluteUri: "vscode-remote://ssh-remote%2B.../path/to/file" } } },
        { text: " " },  // @mention 后的空格分隔符
    ],

    // ======== 图片/媒体（可选） ========
    media: [
        {
            mimeType: "image/png",
            inlineData: "",  // 空 — 不内嵌数据
            uri: "/absolute/path/to/image.png",  // 通过文件路径引用
            thumbnail: "base64-jpeg-data",  // 缩略图
        },
    ],

    // ======== IDE 元数据 ========
    metadata: {
        ideName: "antigravity",
        apiKey: "",
        locale: "zh",
        ideVersion: "1.19.5",
        extensionName: "antigravity",
    },

    // ======== 对话配置 ========
    cascadeConfig: {
        plannerConfig: {
            conversational: {
                plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
                agenticMode: true,  // true=Planning, false=Fast
            },
            toolConfig: {
                runCommand: {
                    autoCommandConfig: {
                        // 命令自动执行策略
                        autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
                        // 可选值:
                        //   CASCADE_COMMANDS_AUTO_EXECUTION_EAGER    — 自动执行
                        //   CASCADE_COMMANDS_AUTO_EXECUTION_CAUTIOUS — 谨慎（需确认）
                        //   CASCADE_COMMANDS_AUTO_EXECUTION_OFF      — 关闭
                    },
                },
                notifyUser: {
                    // 文件修改审查模式
                    artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO",
                    // 可选值:
                    //   ARTIFACT_REVIEW_MODE_TURBO  — 自动通过
                    //   ARTIFACT_REVIEW_MODE_NORMAL — 需手动确认
                    //   ARTIFACT_REVIEW_MODE_STRICT — 严格审查
                },
            },
            requestedModel: {
                model: "MODEL_PLACEHOLDER_M37",  // 见模型映射表
            },
            ephemeralMessagesConfig: { enabled: true },
            knowledgeConfig: { enabled: true },
        },
        conversationHistoryConfig: { enabled: true },
    },

    // ======== 编辑器上下文（Trajectory 中观察到） ========
    // 以下字段在 IDE 发送时自动携带，我们可选
    userResponse: "消息文本",  // 与 items[0].text 相同
    activeUserState: {
        activeDocument: {
            absoluteUri: "file:///path/to/file.tsx",
            workspaceUri: "file:///home/user",
            editorLanguage: "typescriptreact",
            language: "LANGUAGE_TSX",
            cursorPosition: {},
            lineEnding: "\n",
        },
        openDocuments: [ /* 所有打开的文件 */ ],
    },
    clientType: "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE",
    userConfig: { /* 同 cascadeConfig */ },
    lastUserConfig: { /* 上一次的 cascadeConfig */ },
}
```

**Planning vs Fast 的唯一区别：**

| 字段 | Fast 模式 | Planning 模式 |
|:--|:--|:--|
| `agenticMode` | `false` | `true` |
| `plannerMode` | `CONVERSATIONAL_PLANNER_MODE_DEFAULT` | 相同 |
| 其他字段 | 相同 | 相同 |

**图片传输方式：**

1. IDE 先将图片存到 `~/.gemini/antigravity/brain/{cascadeId}/media__{timestamp}.png`
2. `media[]` 中通过 `uri` 字段传**文件绝对路径**
3. `thumbnail` 字段包含 base64 编码的 JPEG 缩略图
4. `inlineData` 为空字符串

**@Mention 文件引用：**

文件引用作为 `items[]` 数组的独立条目：
```javascript
items: [
    { text: "修复这个文件" },
    { item: { file: { absoluteUri: "vscode-remote://..." } } },
    { text: " " },  // 尾随空格
]
```

#### 3. `GetCascadeTrajectory` — 获取对话轨迹

```json
// 请求
{ "cascadeId": "uuid" }

// 响应
{
    "status": "CASCADE_RUN_STATUS_IDLE",
    "numTotalSteps": 10,
    "trajectory": {
        "steps": [ /* Step 对象数组 */ ],
        "generatorMetadata": [ /* 模型使用信息 */ ]
    }
}
```

**对话状态值：**
- `CASCADE_RUN_STATUS_IDLE` — 空闲
- `CASCADE_RUN_STATUS_RUNNING` — 运行中
- `CASCADE_RUN_STATUS_UNKNOWN` — 未知

**Step 类型 (`step.type`)：**

| 类型 | 说明 |
|:--|:--|
| `CORTEX_STEP_TYPE_USER_INPUT` | 用户输入 |
| `CORTEX_STEP_TYPE_PLANNER_RESPONSE` | AI 回复（思考 + 文本） |
| `CORTEX_STEP_TYPE_TOOL_CALL` | 工具调用（查看文件、执行命令等） |
| `CORTEX_STEP_TYPE_VIEW_FILE` | 查看文件 |
| `CORTEX_STEP_TYPE_CODE_EDIT` | 代码修改 |
| `CORTEX_STEP_TYPE_RUN_COMMAND` | 执行命令 |
| `CORTEX_STEP_TYPE_COMMAND_STATUS` | 命令执行状态 |
| `CORTEX_STEP_TYPE_LIST_DIRECTORY` | 列出目录 |
| `CORTEX_STEP_TYPE_NOTIFY_USER` | 通知用户 |
| `CORTEX_STEP_TYPE_ERROR_MESSAGE` | 错误消息 |
| `CORTEX_STEP_TYPE_CHECKPOINT` | 断点标记 |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | 临时系统消息 |
| `CORTEX_STEP_TYPE_CONVERSATION_HISTORY` | 对话历史上下文 |
| `CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS` | 知识库 |
| `CORTEX_STEP_TYPE_TASK_BOUNDARY` | 任务边界 |
| `CORTEX_STEP_TYPE_SEARCH_WEB` | 网络搜索 |

#### 4. `GetUserStatus` — 获取用户状态和模型列表

```json
// 请求
{}

// 响应
{
    "userStatus": {
        "email": "user@example.com",
        "userTier": {
            "id": "g1-ultra-tier",
            "name": "Google AI Ultra"
        },
        "cascadeModelConfigData": {
            "clientModelConfigs": [ /* ModelInfo 数组 */ ],
            "clientModelSorts": [
                {
                    "name": "Recommended",
                    "groups": [{ "modelLabels": ["Gemini 3.1 Pro (High)", ...] }]
                }
            ],
            "defaultOverrideModelConfig": {
                "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M37" }
            }
        },
        "acceptedLatestTermsOfService": true
    }
}
```

#### 5. `GetCommandModelConfigs` — 获取模型配置

```json
// 请求
{ "metadata": {} }

// 响应 — 同 GetUserStatus 中的 cascadeModelConfigData
```

#### 6. `StreamCascadeReactiveUpdates` — 流式订阅更新

```json
// 请求
{
    "protocolVersion": 1,
    "id": "uuid",
    "subscriberId": "uuid"
}
// 注: 流式 API，当前我们使用轮询替代
```

#### 7. `UpdateConversationAnnotations` — 更新对话注释

```json
// 请求
{
    "cascadeId": "uuid",
    "annotations": { /* key-value */ },
    "mergeAnnotations": true
}
```

#### 8. `GetAgentScripts` — 获取 Agent 脚本

```json
// 请求
{}
```

#### 9. `GetUnleashData` — Feature Flags

```json
// 请求
{}
// 主要用于端口验证和功能开关
```

#### 10. `Heartbeat` — 心跳保活

```json
// 请求
{ "metadata": {} }
```

---

## 三、WebSocket v2 协议

### 连接

```
ws://localhost:3210
```

### 消息格式

所有消息都是 JSON，必须有 `type` 字段：
- **请求**: `req_*` （客户端 → 服务端）
- **响应**: `res_*` （服务端 → 客户端，带匹配的 `reqId`）
- **事件**: `event_*` （服务端推送）

### 请求消息

#### `req_status` — 查询状态

```json
{ "type": "req_status", "reqId": "optional-id" }
```

**响应 `res_status`：**
```json
{
    "type": "res_status",
    "reqId": "...",
    "ls": {
        "connected": true,
        "port": 38477,
        "pid": 12345,
        "version": "1.19.5"
    },
    "config": { /* CascadeConfig */ },
    "conversations": {
        "total": 100,
        "running": 1,
        "subscribed": 1
    },
    "polling": true,
    "account": { "email": "user@example.com", "tier": "Google AI Ultra" },
    "models": [
        {
            "label": "Gemini 3.1 Pro (High)",
            "model": "MODEL_PLACEHOLDER_M37",
            "supportsImages": true,
            "supportedMimeTypes": { "image/png": true, "image/jpeg": true, ... },
            "quota": 1.0,
            "tag": "New"
        },
        // ...
    ],
    "defaultModel": "MODEL_PLACEHOLDER_M37"
}
```

#### `req_conversations` — 获取对话列表

```json
{
    "type": "req_conversations",
    "reqId": "...",
    "limit": 50,
    "search": "关键词"
}
```

#### `req_trajectory` — 获取对话轨迹

```json
{
    "type": "req_trajectory",
    "reqId": "...",
    "cascadeId": "uuid"
}
```

#### `req_new_chat` — 创建新对话

```json
{ "type": "req_new_chat", "reqId": "..." }
```

#### `req_send_message` — 发送消息

```json
{
    "type": "req_send_message",
    "reqId": "...",
    "cascadeId": "uuid",
    "text": "消息文本",
    "config": {  // 可选，覆盖默认配置
        "model": "MODEL_PLACEHOLDER_M37",
        "agenticMode": true
    },
    "mentions": [  // 可选，@mention 文件引用
        { "file": { "absoluteUri": "file:///path/to/file" } }
    ],
    "media": [  // 可选，图片/媒体
        {
            "mimeType": "image/png",
            "uri": "/absolute/path/to/image.png",
            "thumbnail": "base64-jpeg-data"
        }
    ]
}
```

#### `req_subscribe` / `req_unsubscribe` — 订阅/取消订阅

```json
{ "type": "req_subscribe", "reqId": "...", "cascadeId": "uuid" }
{ "type": "req_unsubscribe", "reqId": "...", "cascadeId": "uuid" }
```

#### `req_set_config` / `req_get_config` — 配置管理

```json
{
    "type": "req_set_config",
    "reqId": "...",
    "model": "MODEL_PLACEHOLDER_M37",
    "agenticMode": true
}
```

### 事件消息（服务端推送）

#### `event_step_added` — 新 Step
```json
{
    "type": "event_step_added",
    "cascadeId": "uuid",
    "stepIndex": 5,
    "step": { /* Step 对象 */ }
}
```

#### `event_step_updated` — Step 状态变化
```json
{
    "type": "event_step_updated",
    "cascadeId": "uuid",
    "stepIndex": 3,
    "step": { /* 更新后的 Step */ }
}
```

#### `event_status_changed` — 对话状态变化
```json
{
    "type": "event_status_changed",
    "cascadeId": "uuid",
    "from": "RUNNING",
    "to": "IDLE"
}
```

#### `event_ls_status` — LS 连接状态
```json
{
    "type": "event_ls_status",
    "connected": true,
    "port": 38477,
    "pid": 12345
}
```

---

## 四、模型配置

### 模型映射表

| 显示名称 | Model ID | 图片 | 视频 | 音频 | PDF | Tag |
|:--|:--|:--|:--|:--|:--|:--|
| **Gemini 3.1 Pro (High)** | `MODEL_PLACEHOLDER_M37` | ✅ | ✅ | ✅ | ✅ | New |
| **Gemini 3.1 Pro (Low)** | `MODEL_PLACEHOLDER_M36` | ✅ | ✅ | ✅ | ✅ | New |
| **Gemini 3 Flash** | `MODEL_PLACEHOLDER_M18` | ✅ | ✅ | ✅ | ✅ | - |
| **Claude Sonnet 4.6 (Thinking)** | `MODEL_PLACEHOLDER_M35` | ✅ | ❌ | ❌ | ❌ | - |
| **Claude Opus 4.6 (Thinking)** | `MODEL_PLACEHOLDER_M26` | ✅ | ❌ | ❌ | ❌ | - |
| **GPT-OSS 120B (Medium)** | `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` | ❌ | ❌ | ❌ | ❌ | - |

**默认模型**: `MODEL_PLACEHOLDER_M37` (Gemini 3.1 Pro High)

### 各模型支持的 MIME 类型

**Gemini 系列** (M37/M36/M18):
- 图片: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`
- 视频: `video/mp4`, `video/webm`, `video/jpeg2000`
- 音频: `audio/webm;codecs=opus`
- 文档: `application/pdf`, `application/json`, `text/javascript`, `text/x-python`, `text/x-typescript`, `text/css`, `text/html`, `text/markdown`, `text/csv`, `text/xml`

**Claude 系列** (M35/M26):
- 图片: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`

**GPT-OSS** — 不支持任何媒体类型

### CascadeConfig 默认值

```javascript
{
    model: 'MODEL_PLACEHOLDER_M37',
    agenticMode: true,                                         // Planning 模式
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
    knowledgeEnabled: true,
    ephemeralEnabled: true,
    conversationHistoryEnabled: true,
}
```

---

## 五、数据类型

### CascadeConfig

| 字段 | 类型 | 说明 |
|:--|:--|:--|
| `model` | `string` | 模型标识（见映射表） |
| `agenticMode` | `boolean` | `true`=Planning, `false`=Fast |
| `autoExecutionPolicy` | `string` | 命令自动执行策略 |
| `artifactReviewMode` | `string` | 文件修改审查模式 |
| `knowledgeEnabled` | `boolean` | 知识库上下文 |
| `ephemeralEnabled` | `boolean` | 临时系统消息 |
| `conversationHistoryEnabled` | `boolean` | 跨对话历史 |

### ModelInfo

| 字段 | 类型 | 说明 |
|:--|:--|:--|
| `label` | `string` | 显示名称 |
| `model` | `string` | 模型标识符 |
| `supportsImages` | `boolean` | 是否支持图片 |
| `supportedMimeTypes` | `Record<string, boolean>` | 支持的 MIME 类型 |
| `quota` | `number` | 剩余配额比例 (0~1) |
| `tag` | `string` | 标签（如 "New"） |

### ConversationSummary

| 字段 | 类型 | 说明 |
|:--|:--|:--|
| `id` | `string` | 对话 UUID |
| `title` | `string` | 对话标题 |
| `updatedAt` | `string` | ISO 时间戳 |
| `sizeBytes` | `number` | .pb 文件大小 |

---

## 六、快速上手

### 获取模型列表

```bash
node -e "
const { discoverLS, grpcCall } = require('./lib/core/ls-discovery');
const ls = discoverLS();
grpcCall(ls.port, ls.csrf, 'GetUserStatus', {}).then(r => {
    const configs = r.data?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    configs.forEach(c => console.log(c.label, '→', c.modelOrAlias?.model));
});
"
```

### 创建对话并发消息

```bash
node -e "
const { discoverLS, grpcCall } = require('./lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('./lib/core/ws-protocol');
const ls = discoverLS();

(async () => {
    // 创建对话
    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cid = r1.data.cascadeId;
    console.log('CascadeId:', cid);

    // 发送消息
    const body = buildSendBody(cid, '回复 OK', DEFAULT_CONFIG);
    await grpcCall(ls.port, ls.csrf, 'SendUserCascadeMessage', body);
    console.log('已发送');
})();
"
```

### CLI 工具

```bash
node tools/ag.js list              # 列出对话
node tools/ag.js export            # 导出最新对话
node tools/ag.js status            # API 状态
```
