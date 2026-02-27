# Antigravity IDE 对话数据完整逆向解析文档

> **日期**: 2026-02-25 ~ 2026-02-26  
> **目标**: 从 Antigravity IDE 中程序化读取对话历史列表及**完整对话内容**  
> **结果**: ✅ 完全成功。实现了两层数据获取：  
>   - **第一层** — 对话列表：通过 SQLite 直读，18ms 获取全部 296 条对话元数据  
>   - **第二层** — 对话内容：通过本地 gRPC API (`GetCascadeTrajectory`)，获取完整对话消息、AI 思考过程、工具调用等  

---

## 目录

1. [架构总览](#1-架构总览)
2. [第一层：对话列表获取（SQLite）](#2-第一层对话列表获取sqlite)
3. [第二层：对话内容获取（gRPC API）](#3-第二层对话内容获取grpc-api)
4. [远程服务器存储](#4-远程服务器存储)
5. [完整工具链](#5-完整工具链)
6. [附录](#6-附录)

---

## 1. 架构总览

### 1.1 Antigravity 数据架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Antigravity IDE (Electron)                       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │  Workspace    │  │   Manager    │  │    Launchpad           │    │
│  │  (编辑器窗口) │  │  (管理窗口)   │  │   (启动器窗口)         │    │
│  │              │  │              │  │                        │    │
│  │  #conversation│  │  侧边栏列表  │  │  工作区/对话选择器      │    │
│  │  (虚拟滚动)   │  │  对话管理    │  │                        │    │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────────┘    │
│         │                 │                                         │
│         ▼                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │           Language Server (gRPC over HTTPS)               │      │
│  │                                                           │      │
│  │  服务: exa.language_server_pb.LanguageServerService       │      │
│  │  端口: 动态分配 (如 33071, 63243, 59513)                  │      │
│  │  认证: x-codeium-csrf-token                               │      │
│  │  协议: ConnectRPC (connect-protocol-version: 1)           │      │
│  │                                                           │      │
│  │  关键方法:                                                 │      │
│  │  ├── GetCascadeTrajectory      → 获取完整对话内容 ⭐       │      │
│  │  ├── StreamCascadeReactiveUpdates → 流式订阅对话更新       │      │
│  │  ├── UpdateConversationAnnotations → 更新对话注释          │      │
│  │  └── GetAgentScripts            → 获取 Agent 脚本         │      │
│  └──────────────────────────────────────────────────────────┘      │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │                本地 SQLite 数据库                          │      │
│  │  路径: %APPDATA%\Antigravity\User\globalStorage\state.vscdb│     │
│  │  内容: 对话元数据（UUID、标题、时间戳、工作区）             │      │
│  └──────────────────────────────────────────────────────────┘      │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │           远程服务器 (SSH)                                  │      │
│  │  路径: ~/.gemini/antigravity/conversations/*.pb             │      │
│  │  内容: 加密的 Protobuf 文件 (AES, entropy ≈ 7.99)          │      │
│  │  状态: ❌ 无法直接解密                                     │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据获取完整链路

```
┌─────────────────────────────────────────────────────────────┐
│               完整链路: 导出任意对话到 Markdown               │
│                                                              │
│  Step 1: 获取对话列表                                        │
│  ━━━━━━━━━━━━━━━━━━━━                                       │
│  SQLite (state.vscdb)                                        │
│    ├── trajectorySummaries  → 100 条 (有标题)                │
│    └── agentManagerInitState → 196 条 (仅 UUID)              │
│    合并 → 296 条对话 (UUID + 标题 + 时间戳 + 工作区)          │
│                     │                                        │
│                     ▼                                        │
│  Step 2: 获取 CSRF Token                                     │
│  ━━━━━━━━━━━━━━━━━━━━                                       │
│  CDP 连接 Manager 窗口                                       │
│    → Network.enable                                          │
│    → 触发对话切换 (点击侧边栏)                                │
│    → 拦截 x-codeium-csrf-token header                        │
│    → 同时获取 gRPC 服务端口                                   │
│                     │                                        │
│                     ▼                                        │
│  Step 3: 调用 gRPC API                                       │
│  ━━━━━━━━━━━━━━━━━━━━                                       │
│  POST https://127.0.0.1:{port}/.../GetCascadeTrajectory     │
│  Headers:                                                    │
│    Content-Type: application/json                            │
│    x-codeium-csrf-token: {token}                             │
│    connect-protocol-version: 1                               │
│  Body: { "cascadeId": "{UUID}" }                             │
│     → 返回完整 JSON (数十 KB ~ 数 MB)                        │
│                     │                                        │
│                     ▼                                        │
│  Step 4: 格式化输出                                          │
│  ━━━━━━━━━━━━━━━━━━━━                                       │
│  trajectory.steps[] → Markdown                               │
│    ├── USER_INPUT        → 👤 用户消息                       │
│    ├── PLANNER_RESPONSE  → 🤖 AI 回复 (含思考过程)           │
│    ├── SEARCH_WEB        → 🔍 搜索结果                       │
│    ├── CHECKPOINT        → 📌 意图总结                       │
│    ├── CONVERSATION_HISTORY → (上下文, 可跳过)               │
│    ├── KNOWLEDGE_ARTIFACTS  → (知识工件, 可跳过)              │
│    └── EPHEMERAL_MESSAGE    → (系统指令, 可跳过)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 第一层：对话列表获取（SQLite）

### 2.1 背景与动机

Antigravity IDE 没有公开的对话历史 API。原有方案通过 CDP 模拟 DOM 操作获取对话列表：

| 问题 | 说明 |
|------|------|
| **速度慢** | 需要等待 UI 渲染，数秒 |
| **干扰用户** | 弹窗遮挡界面 |
| **数据不全** | 只能获取可见的几条 |
| **脆弱** | UI 变化导致选择器失效 |

### 2.2 数据存储位置

```
Windows: %APPDATA%\Antigravity\User\globalStorage\state.vscdb
```

标准 SQLite 3 数据库，单表结构：

```sql
CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT);
```

### 2.3 关键数据源

#### 数据源 1: `antigravityUnifiedStateSync.trajectorySummaries`

**编码链路**: `SQLite value → Base64 → Protobuf → 内嵌 Base64 → Protobuf`

```protobuf
message TrajectorySummaries {
    repeated TrajectoryEntry entries = 1;  // ~100 条
}

message TrajectoryEntry {
    string conversation_id = 1;  // UUID
    DetailWrapper detail   = 2;
}

message DetailWrapper {
    string base64_payload = 1;  // ⚠️ Base64 编码的 protobuf
}

// base64_payload 解码后:
message TrajectoryDetail {
    string    title          = 1;   // ⭐ 对话标题
    int32     step_count     = 2;   // 步骤数
    Timestamp created_at     = 3;   // 创建时间
    string    context_id     = 4;   // 关联 context UUID
    int32     is_active      = 5;   // 活跃标记
    Timestamp updated_at     = 7;   // 更新时间
    WorkspaceInfo workspace  = 9;   // 工作区信息
    Timestamp last_active_at = 10;  // 最后活跃时间
}
```

#### 数据源 2: `jetskiStateSync.agentManagerInitState`

**编码**: `Base64 → Protobuf`

```protobuf
message AgentManagerInitState {
    repeated ConversationEntry field10 = 10;  // ~196 条
}

message ConversationEntry {
    string    conversation_id = 1;  // UUID
    Timestamp last_active     = 2;  // 时间戳
}
```

**合并策略**:

```
trajectorySummaries (100条, 有标题)  +  agentManagerInitState (196条, 仅UUID)
                              ↓ 通过 UUID 关联合并
                    296 条完整对话列表 (去重后)
```

### 2.4 模块: `lib/conversations.js`

```javascript
const { getConversations } = require('./lib/conversations');

const result = getConversations();
// result.conversations = [
//   { id, title, stepCount, workspace, createdAt, updatedAt },
//   ...
// ]
// result.total = 296
```

### 2.5 性能对比

| 指标 | 旧 (DOM 抓取) | 新 (SQLite) |
|------|-------------|-------------|
| 耗时 | 3-10 秒 | **18ms** |
| 需要 CDP | ✅ | ❌ |
| 结果数 | ~10 条 | **296 条** |
| 有标题 | ✅ | ✅ (100/296) |
| 有时间戳 | ❌ | ✅ |
| 干扰用户 | ✅ 弹窗 | ❌ 无感 |

---

## 3. 第二层：对话内容获取（gRPC API）

### 3.1 发现过程

**关键突破**: 通过 CDP 连接 Manager 窗口，检查 `performance.getEntriesByType('resource')`，发现 Manager 在加载对话时会调用本地 gRPC 服务。

```javascript
// 在 Manager 窗口的 performance entries 中发现:
https://127.0.0.1:63243/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory
https://127.0.0.1:33071/exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations
```

### 3.2 gRPC 服务详情

| 属性 | 值 |
|------|-----|
| **服务名** | `exa.language_server_pb.LanguageServerService` |
| **协议** | ConnectRPC (`connect-protocol-version: 1`) |
| **传输** | HTTPS (自签名证书, 需 `NODE_TLS_REJECT_UNAUTHORIZED=0`) |
| **端口** | 动态分配, 每次启动不同 (如 33071, 63243, 59513) |
| **认证** | `x-codeium-csrf-token` header (UUID 格式) |
| **Content-Type** | `application/json` |

### 3.3 API 方法

#### `GetCascadeTrajectory` — 获取完整对话内容 ⭐

```
POST https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory

Headers:
  Content-Type: application/json
  x-codeium-csrf-token: {csrf-token}
  connect-protocol-version: 1

Request Body:
  { "cascadeId": "573834e1-3029-447c-9870-7021bcfd02a8" }

Response: (JSON, 数十 KB ~ 数 MB)
  {
    "trajectory": {
      "trajectoryId": "b9b09e58-...",
      "cascadeId": "573834e1-...",
      "trajectoryType": "CORTEX_TRAJECTORY_TYPE_CASCADE",
      "steps": [...],
      "generatorMetadata": [...],
      "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
      "metadata": { "createdAt": "2026-02-26T02:48:41Z" }
    },
    "status": "...",
    "numTotalSteps": 34,
    "numTotalGeneratorMetadata": 2
  }
```

#### 其他方法

| 方法 | 用途 | Request Body |
|------|------|-------------|
| `UpdateConversationAnnotations` | 更新对话注释 | `{ "cascadeId": "...", "annotations": { "lastUserViewTime": "..." }, "mergeAnnotations": true }` |
| `StreamCascadeReactiveUpdates` | 流式订阅更新 | `{ "protocolVersion": 1, "id": "...", "subscriberId": "local-agent-client-main" }` |
| `GetAgentScripts` | 获取 Agent 脚本 | `{}` |

### 3.4 Trajectory Step 类型

`GetCascadeTrajectory` 返回的 `trajectory.steps[]` 包含以下类型:

| Step Type | 对话角色 | 关键字段 | 说明 |
|-----------|---------|----------|------|
| `CORTEX_STEP_TYPE_USER_INPUT` | 👤 用户 | `userInput.userResponse` | 用户发送的消息文本 |
| `CORTEX_STEP_TYPE_PLANNER_RESPONSE` | 🤖 AI | `plannerResponse.rawThinkingText`, `plannerResponse.*` | AI 的思考过程和回复 |
| `CORTEX_STEP_TYPE_SEARCH_WEB` | 🔍 搜索 | `searchWeb.query`, `searchWeb.results[]` | 网页搜索 |
| `CORTEX_STEP_TYPE_CHECKPOINT` | 📌 检查点 | `checkpoint.userIntent` | 意图总结 |
| `CORTEX_STEP_TYPE_CONVERSATION_HISTORY` | 📜 历史 | `conversationHistory` | 对话上下文（通常很大） |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | ⚙️ 系统 | `ephemeralMessage` | 系统指令/提示词 |
| `CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS` | 📚 知识 | `knowledgeArtifacts` | 知识工件 |

#### `PLANNER_RESPONSE` 详细字段

```json
{
  "rawThinkingText": "AI 的思考过程（可能很长）",
  "thinking": "思考 (另一种字段名)",
  "reply": "回复文本",
  "text": "回复文本 (另一种字段名)",
  "content": "回复文本 (另一种字段名)",
  "messageId": "bot-555787b3-...",
  "stopReason": "STOP_REASON_STOP_PATTERN | STOP_REASON_CLIENT_CANCELED",
  "steps": [
    {
      "toolCall": { "toolName": "...", "parameters": {...} },
      "toolResult": { ... }
    }
  ]
}
```

#### `generatorMetadata` — 模型和 Token 用量

```json
{
  "stepIndices": [4, 5],
  "chatModel": {
    "model": "MODEL_PLACEHOLDER_M37",
    "usage": {
      "model": "MODEL_PLACEHOLDER_M37",
      "inputTokens": "19701",
      "outputTokens": "773",
      "thinkingOutputTokens": "754",
      "apiProvider": "API_PROVIDER_GOOGLE_GEMINI"
    }
  }
}
```

### 3.5 CSRF Token 获取方法

CSRF Token 通过 CDP 拦截 Manager 窗口的网络请求获取：

```javascript
// 1. 连接 Manager 窗口
const targets = await httpGet('http://127.0.0.1:9000/json');
const manager = targets.find(t => t.type === 'page' && t.title === 'Manager');
const ws = new WebSocket(manager.webSocketDebuggerUrl);

// 2. 开启 Network 监听
await cdpSend(ws, 'Network.enable');

// 3. 触发对话切换 (点击侧边栏中的对话)
await clickAt(ws, x, y);

// 4. 从 requestWillBeSent 事件中提取
ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Network.requestWillBeSent') {
        const headers = msg.params.request.headers;
        const csrf = headers['x-codeium-csrf-token'];  // UUID 格式
        const port = new URL(msg.params.request.url).port;
    }
});
```

**注意**: 
- CSRF Token 在 IDE 运行期间保持不变
- 端口在每次 IDE 启动时动态分配
- 也可通过 `performance.getEntriesByType('resource')` 获取历史端口

### 3.6 端口发现

多个端口对应不同的 workspace：

| 端口 | 对应 |
|------|------|
| `33071` | SSH Remote workspace 的 Language Server |
| `63243` | 本地 workspace 的 Language Server |
| `59513` | 另一个 workspace 的 Language Server |

**对话属于哪个端口**: 对话的 `cascadeId` 只在其对应 workspace 的端口上可用。如果返回 `trajectory not found`，需要尝试其他端口。

---

## 4. 远程服务器存储

### 4.1 目录结构

SSH 远程服务器上的 `~/.gemini/antigravity/` 目录：

```
~/.gemini/antigravity/
├── conversations/        # 100 个 .pb 文件 (加密!)
│   ├── 038f30bc-...-020d5da87d59.pb    (151 KB)
│   ├── c43d01af-...-9cd3ae9fe152.pb    (945 KB)
│   └── ...
├── brain/                # 113 个 UUID 子目录
│   └── {uuid}/.tempmediaStorage/dom_*.txt  (临时 DOM 快照)
├── implicit/             # 隐式数据 (.pb, 加密)
├── annotations/          # 注释数据
├── html_artifacts/       # HTML 工件
├── browser_recordings/   # 浏览器录制
├── knowledge/            # 知识库
└── user_settings.pb      # 用户设置
```

### 4.2 .pb 文件分析

| 属性 | 值 |
|------|-----|
| **格式** | 非标准 Protobuf (无法直接解码) |
| **Shannon Entropy** | **7.99 bits/byte** (理论最大值 8.0) |
| **结论** | **AES 加密** (或类似对称加密) |
| **大小范围** | 150 KB ~ 11 MB |
| **文件名** | 对话 UUID + `.pb` |
| **Magic bytes** | `2332c854` (非已知标准格式) |

**结论**: `.pb` 文件是端到端加密的，无法在本地直接解密。对话内容需要通过 gRPC API 获取（API 会自动处理解密）。

---

## 5. 完整工具链

### 5.1 一键导出脚本

```bash
# 导出指定标题的对话
node tools/export-conversation.js "AI Design Tool Development"

# 导出后格式化为干净的 Markdown
node tools/format-clean.js tools/AI_Design_Tool_Development.json "AI Design Tool Development"
```

### 5.2 手动步骤

```bash
# Step 1: 列出所有对话
node -e "const{getConversations}=require('./lib/conversations');const r=getConversations();r.conversations.slice(0,10).forEach(c=>console.log(c.id,c.title));"

# Step 2: 获取 CSRF Token (需要 CDP 连接, IDE 用 --remote-debugging-port=9000 启动)
node tools/find-csrf.js

# Step 3: 调用 API
curl -k -X POST \
  https://127.0.0.1:33071/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory \
  -H "Content-Type: application/json" \
  -H "x-codeium-csrf-token: {你的token}" \
  -H "connect-protocol-version: 1" \
  -d '{"cascadeId":"038f30bc-a7ab-4c79-8138-020d5da87d59"}' \
  -o trajectory.json

# Step 4: 格式化
node tools/format-clean.js trajectory.json "对话标题"
```

### 5.3 工具脚本清单

| 脚本 | 用途 | 阶段 |
|------|------|------|
| **核心模块** | | |
| `lib/conversations.js` | SQLite 读取对话列表 | 第一层 |
| `lib/cdp.js` | CDP 通信工具 | 基础 |
| `lib/ide.js` | IDE 交互 (DOM 操作, 历史面板) | 基础 |
| **导出工具** | | |
| `tools/export-conversation.js` | 一键导出 (标题→UUID→API→Markdown) | 完整链路 |
| `tools/format-clean.js` | JSON→Markdown 格式化 (去重/去噪) | 格式化 |
| **探测工具** | | |
| `tools/explore-manager.js` | 探测 Manager 窗口 API 和 DOM | 发现 |
| `tools/find-csrf.js` | 拦截并提取 CSRF Token | 第二层 |
| `tools/capture-grpc.js` | 捕获 gRPC 请求/响应详情 | 第二层 |
| `tools/get-trajectory.js` | 直接调用 GetCascadeTrajectory | 第二层 |
| **分析工具** | | |
| `tools/dump-auth.js` | 导出认证数据 (OAuth Token) | 分析 |
| `tools/inspect-pb.js` | 检查 .pb 文件格式 (加密分析) | 分析 |
| `tools/read-latest-chat.js` | CDP DOM 方式读取当前对话 | 备用 |

### 5.4 依赖项

```json
{
  "better-sqlite3": "^11.x",   // SQLite 读取对话列表
  "ws": "^8.x"                 // WebSocket (CDP 连接)
}
```

### 5.5 前置条件

1. **Antigravity IDE 运行中**，且用 `--remote-debugging-port=9000` 启动
2. **Node.js 18+**
3. `npm install` 完成

---

## 6. 附录

### 6.1 CDP 连接目标

Antigravity IDE 通过 `--remote-debugging-port=9000` 启动后，暴露多个 CDP 目标：

| 目标 | type | 用途 |
|------|------|------|
| **Manager** | page | Agent 管理器，侧边栏对话列表 |
| **Launchpad** | page | 启动器/窗口选择器 |
| **Workspace** | page | 编辑器窗口 (每个工作区一个) |

```javascript
const targets = await httpGet('http://127.0.0.1:9000/json');
// [{ title: "Manager", type: "page", webSocketDebuggerUrl: "ws://..." }, ...]
```

### 6.2 已知限制

1. **CSRF Token 获取**: 需要 CDP 连接 Manager 窗口并触发一次网络请求才能拦截到 Token。Token 在 IDE 运行期间有效，但 IDE 重启后会变化。

2. **端口动态分配**: gRPC 服务端口每次 IDE 启动都不同，需要通过 `performance.getEntriesByType('resource')` 或 Network 拦截来获取。

3. **跨端口对话查找**: 一个 `cascadeId` 只在其所属 workspace 的 Language Server 端口上可用。如果返回 `trajectory not found`，需要尝试其他端口。

4. **标题覆盖率**: SQLite 中的 `trajectorySummaries` 只缓存约 100 条对话摘要。更早的对话只有 UUID。

5. **远程 .pb 文件加密**: 服务器上的 `.pb` 文件是 AES 加密的，Shannon entropy ≈ 7.99，无法本地解密。

6. **Planner Response 字段不固定**: AI 回复的文本可能在 `reply`、`text`、`content`、`response` 等不同字段中，需要逐一检查。

### 6.3 错误处理

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `missing CSRF token` (401) | 未提供 `x-codeium-csrf-token` | 通过 CDP 获取 Token |
| `trajectory not found` (500) | cascadeId 不在此端口 | 尝试其他端口 |
| `connect ECONNREFUSED` | gRPC 服务未启动 | 确认 IDE 正在运行 |
| CDP 连接失败 | IDE 未用 `--remote-debugging-port` 启动 | 重启 IDE 并加参数 |

### 6.4 数据新鲜度

- **SQLite**: 由 IDE 进程实时写入，用 `readonly: true` 读取不会和 IDE 竞争锁
- **gRPC API**: 实时返回最新数据，包括正在进行的对话
- **CSRF Token**: IDE 运行期间保持不变

### 6.5 潜在改进方向

1. **自动端口发现**: 扫描所有 localhost 端口来找到 gRPC 服务，避免依赖 CDP
2. **批量导出**: 遍历所有 UUID + 所有端口，一次导出全部对话历史
3. **CSRF 缓存**: 将 CSRF Token 缓存到文件，减少 CDP 依赖
4. **Web UI**: 构建一个本地 Web 界面来浏览和导出对话
5. **增量同步**: 监控 SQLite 变化，自动导出新对话
