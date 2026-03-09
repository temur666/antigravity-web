---
title: Antigravity API 总览
source: LS v1.19.5 逆向分析
updated: 2026-03-09
---

# Antigravity API 总览

> 本文档是所有 API 的索引和架构说明。各子系统的详细参考见独立文档。

---

## 架构概览

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
2. **server** 解析消息, 调用 Controller
3. **Controller** 通过 `ls-discovery.grpcCall()` 调用 LS gRPC API
4. **LS** 返回结果, Controller 计算 Diff, 通过 WebSocket 推送 `event_*`

---

## 子系统索引

- [LS gRPC API](ls-grpc-api.md) — 完整的 gRPC 方法列表和响应格式
- [Step 原始数据字段](step-raw-fields.md) — GetCascadeTrajectory 返回的 step 数据结构

---

## WebSocket v2 协议

### 连接

```
ws://localhost:3210
```

### 消息格式

所有消息都是 JSON, 必须有 `type` 字段:
- **请求**: `req_*` (客户端 → 服务端)
- **响应**: `res_*` (服务端 → 客户端, 带匹配的 `reqId`)
- **事件**: `event_*` (服务端推送)

### 请求消息

#### `req_status` — 查询状态

```json
{ "type": "req_status", "reqId": "optional-id" }
```

响应 `res_status`:
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
            "supportedMimeTypes": { "image/png": true, "image/jpeg": true },
            "quota": 1.0,
            "tag": "New"
        }
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
    "config": {
        "model": "MODEL_PLACEHOLDER_M37",
        "agenticMode": true
    },
    "mentions": [
        { "file": { "absoluteUri": "file:///path/to/file" } }
    ],
    "media": [
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

### 事件消息 (服务端推送)

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

## 模型配置

### 模型列表

- **Gemini 3.1 Pro (High)** — `MODEL_PLACEHOLDER_M37` — 图片/视频/音频/PDF ✅ — tag: New
- **Gemini 3.1 Pro (Low)** — `MODEL_PLACEHOLDER_M36` — 图片/视频/音频/PDF ✅ — tag: New
- **Gemini 3 Flash** — `MODEL_PLACEHOLDER_M18` — 图片/视频/音频/PDF ✅
- **Claude Sonnet 4.6 (Thinking)** — `MODEL_PLACEHOLDER_M35` — 仅图片 ✅
- **Claude Opus 4.6 (Thinking)** — `MODEL_PLACEHOLDER_M26` — 仅图片 ✅
- **GPT-OSS 120B (Medium)** — `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` — 无媒体支持

默认模型: `MODEL_PLACEHOLDER_M37` (Gemini 3.1 Pro High)

### Gemini 系列支持的 MIME 类型 (M37/M36/M18)

- 图片: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`
- 视频: `video/mp4`, `video/webm`, `video/jpeg2000`
- 音频: `audio/webm;codecs=opus`
- 文档: `application/pdf`, `application/json`, `text/javascript`, `text/x-python`, `text/x-typescript`, `text/css`, `text/html`, `text/markdown`, `text/csv`, `text/xml`

### Claude 系列支持的 MIME 类型 (M35/M26)

- 图片: `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/webp`

### CascadeConfig 默认值

```javascript
{
    model: 'MODEL_PLACEHOLDER_M37',
    agenticMode: true,
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
    knowledgeEnabled: true,
    ephemeralEnabled: true,
    conversationHistoryEnabled: true,
}
```

---

## 数据类型

### CascadeConfig

- `model` (string) — 模型标识 (见模型列表)
- `agenticMode` (boolean) — `true`=Planning, `false`=Fast
- `autoExecutionPolicy` (string) — 命令自动执行策略
- `artifactReviewMode` (string) — 文件修改审查模式
- `knowledgeEnabled` (boolean) — 知识库上下文
- `ephemeralEnabled` (boolean) — 临时系统消息
- `conversationHistoryEnabled` (boolean) — 跨对话历史

### ModelInfo

- `label` (string) — 显示名称
- `model` (string) — 模型标识符
- `supportsImages` (boolean) — 是否支持图片
- `supportedMimeTypes` (Record<string, boolean>) — 支持的 MIME 类型
- `quota` (number) — 剩余配额比例 (0~1)
- `tag` (string) — 标签 (如 "New")

### ConversationSummary

- `id` (string) — 对话 UUID
- `title` (string) — 对话标题
- `updatedAt` (string) — ISO 时间戳
- `sizeBytes` (number) — .pb 文件大小

---

## 快速上手

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
    const r1 = await grpcCall(ls.port, ls.csrf, 'StartCascade', {});
    const cid = r1.data.cascadeId;
    console.log('CascadeId:', cid);

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
