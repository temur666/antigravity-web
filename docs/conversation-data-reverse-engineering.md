# Antigravity IDE 对话数据逆向解析文档

> **日期**: 2026-02-25  
> **目标**: 从 Antigravity IDE 的本地存储中程序化读取对话历史列表  
> **结果**: 成功。通过直接读取 SQLite 数据库并解码 Protobuf 序列化的数据，实现了 18ms 内获取全部 296 条对话记录  

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [探索过程](#2-探索过程)
3. [数据存储位置](#3-数据存储位置)
4. [数据库结构](#4-数据库结构)
5. [Protobuf 逆向解析](#5-protobuf-逆向解析)
6. [最终实现](#6-最终实现)
7. [附录：工具脚本](#7-附录工具脚本)

---

## 1. 背景与动机

### 原有方案的问题

Antigravity IDE（基于 VS Code 的 AI 编程助手）的对话历史没有公开的程序化 API。原有的 `lib/ide.js` 通过 **CDP（Chrome DevTools Protocol）模拟 DOM 操作** 来获取对话列表：

```
打开 History 弹窗 → 读取弹窗 DOM → 提取对话标题 → 关闭弹窗
```

这种方式的缺陷：

| 问题 | 说明 |
|------|------|
| **速度慢** | 需要等待 UI 渲染，整个流程数秒 |
| **干扰用户** | 弹窗会遮挡用户正在操作的界面 |
| **数据不全** | 只能获取弹窗可见的几条对话 |
| **脆弱** | UI 结构变化会导致选择器失效 |
| **依赖连接** | 必须有活跃的 CDP 连接 |

### 目标

找到一种 **不依赖 UI、不干扰用户、能获取全部对话** 的程序化方式。

---

## 2. 探索过程

### 2.1 第一步：探索全局 API 对象

通过 CDP 连接到 IDE 窗口，探测 `window` 上的全局对象：

```javascript
// tools/explore-api.js
Object.keys(window).filter(k => {
    const lower = k.toLowerCase();
    return lower.includes('api') || lower.includes('conversation') || 
           lower.includes('chat') || lower.includes('vscode');
})
```

**发现**: `window.vscode` 存在，包含 `ipcRenderer`、`context`、`webFrame` 等属性。

### 2.2 第二步：探索 vscode.ipcRenderer

`vscode.ipcRenderer` 暴露了 Electron 的 IPC 通道：

```javascript
// 可用方法
["send", "invoke", "on", "once", "removeListener"]
```

尝试各种 channel 名称均失败：

```
vscode:getConversations     → No handler registered
vscode:getChatHistory       → No handler registered
jetski:getConversations     → Unsupported event IPC channel
jetski:listThreads          → Unsupported event IPC channel
antigravity:getConversations → Unsupported event IPC channel
```

**结论**: IPC 没有暴露对话历史的端点。

### 2.3 第三步：探索 vscode.context

```javascript
vscode.context → { configuration: [Function], resolveConfiguration: [Function] }
vscode.webFrame → { setZoomLevel: [Function] }
```

**结论**: 功能极其有限，无法访问对话数据。

### 2.4 第四步：扫描本地文件系统

扫描 `%APPDATA%\Antigravity\` 目录结构：

```
C:\Users\Administrator\AppData\Roaming\Antigravity\
├── Cache/
├── IndexedDB/
├── Local Storage/
├── Session Storage/
└── User/
    ├── globalStorage/
    │   ├── state.vscdb          ← 1.2MB SQLite 数据库 ⭐
    │   ├── state.vscdb.backup
    │   └── storage.json
    └── workspaceStorage/
        ├── <hash>/
        │   ├── state.vscdb      ← 每个工作区一个 DB
        │   └── workspace.json   ← 工作区路径映射
        └── ...
```

**关键发现**: `state.vscdb` 是 SQLite 数据库，包含 VS Code 的所有持久化状态数据。

### 2.5 第五步：分析 SQLite 数据库

使用 `better-sqlite3` 读取 `state.vscdb`：

```
表结构: ItemTable (key TEXT, value TEXT)
总行数: 656 行
```

在 656 个 key 中，找到两个与对话相关的关键条目：

| Key | 大小 | 内容 |
|-----|------|------|
| `jetskiStateSync.agentManagerInitState` | **239,948 B** | Agent Manager 的完整初始状态 |
| `antigravityUnifiedStateSync.trajectorySummaries` | **59,244 B** | 对话轨迹摘要（含标题） |

两者的 value 都是 **Base64 编码的 Protobuf 数据**。

---

## 3. 数据存储位置

### 3.1 数据库路径

```
Windows: %APPDATA%\Antigravity\User\globalStorage\state.vscdb
macOS:   ~/.config/Antigravity/User/globalStorage/state.vscdb (推测)
Linux:   ~/.config/Antigravity/User/globalStorage/state.vscdb (推测)
```

### 3.2 数据库格式

标准 SQLite 3 数据库，只有一张表：

```sql
CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT);
```

所有数据存储为 key-value 对，value 为文本（JSON 或 Base64 编码的二进制数据）。

### 3.3 相关的 key

完整的 Antigravity 相关 key 列表（排除通知类）：

```
antigravity.agentViewContainerId.state.hidden          (103B)  - Agent 面板可见性
antigravityUnifiedStateSync.agentManagerWindow          (192B)  - Manager 窗口位置/大小
antigravityUnifiedStateSync.agentPreferences            (596B)  - Agent 偏好设置
antigravityUnifiedStateSync.artifactReview             (9596B)  - Artifact 审查状态
antigravityUnifiedStateSync.browserPreferences          (224B)  - 浏览器偏好
antigravityUnifiedStateSync.modelPreferences             (68B)  - 模型偏好
antigravityUnifiedStateSync.oauthToken                  (732B)  - OAuth 令牌
antigravityUnifiedStateSync.scratchWorkspaces           (284B)  - 临时工作区
antigravityUnifiedStateSync.sidebarWorkspaces          (1372B)  - 侧边栏工作区
antigravityUnifiedStateSync.trajectorySummaries       (59244B)  - ⭐ 对话摘要
antigravityUnifiedStateSync.userStatus                 (5180B)  - 用户状态
jetskiStateSync.agentManagerInitState                (239948B)  - ⭐ Agent Manager 状态
chat.ChatSessionStore.index                              (26B)  - VS Code Chat 索引（空）
chat.participantNameRegistry                           (1331B)  - Chat 参与者注册表
```

---

## 4. 数据库结构

### 4.1 数据编码链路

```
SQLite value (TEXT)
    ↓ Base64 decode
Protobuf binary (bytes)
    ↓ Protobuf decode
结构化数据 (fields)
    ↓ 个别字段再次 Base64 decode
嵌套 Protobuf binary
    ↓ Protobuf decode
最终可读数据 (标题、时间戳等)
```

### 4.2 Protobuf Wire Types 参考

| Wire Type | 含义 | 编码方式 |
|-----------|------|----------|
| 0 | Varint | 可变长度整数 |
| 1 | 64-bit | 固定 8 字节 |
| 2 | Length-delimited | 长度前缀 + 数据体 |
| 5 | 32-bit | 固定 4 字节 |

---

## 5. Protobuf 逆向解析

### 5.1 数据源 1: `jetskiStateSync.agentManagerInitState`

**编码**: `Base64 → Protobuf`

#### 顶层结构

```protobuf
message AgentManagerInitState {
    bytes  field1  = 1;   // 1 条, 用途未知
    bytes  field5  = 5;   // 1 条
    bytes  field6  = 6;   // 1 条
    bytes  field7  = 7;   // 1 条
    bytes  field9  = 9;   // 1 条
    repeated ConversationEntry field10 = 10;  // ⭐ 196 条 — 对话条目
    bytes  field11 = 11;  // 1 条
    bytes  field12 = 12;  // 1 条
    repeated bytes field14 = 14;  // 2 条
    bytes  field15 = 15;  // 1 条
    repeated bytes field16 = 16;  // 15 条
    repeated bytes field17 = 17;  // 15 条
    repeated bytes field18 = 18;  // 5 条
    bytes  field19 = 19;  // 1 条
}
```

#### ConversationEntry (field10) 结构

```protobuf
message ConversationEntry {
    string    conversation_id = 1;  // UUID 格式, 如 "95fec432-25db-4e85-b4a6-9ba9fa8d1398"
    Timestamp last_active     = 2;  // 最后活跃时间戳
}

message Timestamp {
    int64 seconds = 1;  // Unix 秒级时间戳, 如 1764897752
    int32 nanos   = 2;  // 纳秒部分, 如 505000000
}
```

**示例解析**:

```
field10[0]:
  f1(str 36B): "95fec432-25db-4e85-b4a6-9ba9fa8d1398"
  f2(msg 12B):
    f1(varint): 1764897752   → 2025-12-05T01:22:32Z
    f2(varint): 505000000    → .505s (纳秒部分)
```

**特点**:

- 包含 **196 条**对话条目
- 只有 UUID 和时间戳，**没有标题**
- 适合作为"完整 ID 列表 + 精确时间戳"的来源

---

### 5.2 数据源 2: `antigravityUnifiedStateSync.trajectorySummaries`

**编码**: `Base64 → Protobuf → 内嵌 Base64 → Protobuf`（双重编码！）

#### 顶层结构

```protobuf
message TrajectorySummaries {
    repeated TrajectoryEntry entries = 1;  // 100 条
}
```

#### TrajectoryEntry 结构

```protobuf
message TrajectoryEntry {
    string  conversation_id = 1;  // UUID
    DetailWrapper detail    = 2;  // 详情包装器
}

message DetailWrapper {
    string base64_payload = 1;  // ⚠️ 这是一个 Base64 编码的字符串！
                                // 解码后才是真正的 protobuf 消息
}
```

> **关键逆向发现**: `DetailWrapper.field1` 存储的不是 protobuf 子消息，而是一个 **Base64 文本字符串**。该字符串解码后得到的 bytes 才是真正的 protobuf 消息。这种"protobuf 里嵌 base64 字符串再嵌 protobuf"的模式在常规 protobuf 使用中并不常见，可能是 Antigravity 的 state sync 层对数据做了序列化封装。

#### 内嵌 Protobuf (解码 base64_payload 后)

```protobuf
message TrajectoryDetail {
    string    title           = 1;   // ⭐ 对话标题 (纯文本), 如 "Adding Serif Font to AI Replies"
    int32     step_count      = 2;   // 步骤数, 如 141
    Timestamp created_at      = 3;   // 创建时间
    string    context_id      = 4;   // 关联的 context UUID
    int32     is_active       = 5;   // 活跃标记 (1 = 活跃)
    Timestamp updated_at      = 7;   // 更新时间
    WorkspaceInfo workspace   = 9;   // 工作区信息
    Timestamp last_active_at  = 10;  // 最后活跃时间
    bytes     unknown_15      = 15;  // 用途未知
    int32     unknown_16      = 16;  // 用途未知, 如 128
}

message WorkspaceInfo {
    string folder_uri    = 1;  // 工作区 URI, 如 "vscode-remote://ssh-remote%2B.../home/tiemuer"
    string root_uri      = 2;  // 根 URI
    string label         = 3;  // 标签 (可能为空)
}

message Timestamp {
    int64 seconds = 1;  // Unix 秒级时间戳
    int32 nanos   = 2;  // 纳秒部分
}
```

**示例解析（完整链路）**:

```
Step 1: 从 SQLite 读取 value (Base64 文本)
  "CvjVCQrtAQokNjQzN..."

Step 2: Base64 解码 → 44432 bytes Protobuf
  0a c4 03 0a 24 61 34 33 ...

Step 3: 解码外层 Protobuf
  field1 (TrajectoryEntry):
    f1 (string, 36B): "a4316ff4-30d1-4849-a87c-facf37f2cb6c"
    f2 (message, 411B):
      f1 (bytes, 408B): "Ch9BZGRpbmcgU2VyaWYg..."  ← 又是 Base64！

Step 4: 对 f2.f1 做 Base64 解码 → 306 bytes Protobuf
  0a 1f 41 64 64 69 6e 67 ...

Step 5: 解码内层 Protobuf
  f1  (string, 31B): "Adding Serif Font to AI Replies"  ← ⭐ 标题！
  f2  (varint):      141                                  ← 步骤数
  f3  (message):     { seconds: 1766194542 }              ← 创建时间
  f4  (string, 36B): "28c63c12-1ca9-4a8d-803d-..."       ← context ID
  f5  (varint):      1                                    ← is_active
  f7  (message):     { seconds: 1766194627 }              ← 更新时间
  f9  (message):     { folder_uri: "vscode-remote://..." }← 工作区
  f10 (message):     { seconds: 1766194606 }              ← 最后活跃
```

**特点**:

- 包含 **100 条**对话摘要
- 有完整的标题、步骤数、时间戳、工作区
- 比 `agentManagerInitState` 条目少（可能只缓存最近的 100 条）
- 使用了罕见的"protobuf 嵌 base64 嵌 protobuf"编码

---

### 5.3 两个数据源的关系

```
agentManagerInitState (196条)    trajectorySummaries (100条)
┌──────────────────────┐        ┌──────────────────────────┐
│ UUID + 时间戳         │        │ UUID + 标题 + 步骤数      │
│                      │        │ + 工作区 + 时间戳          │
│ 较旧的对话也在里面     │        │ 只有最近的 100 条         │
└──────────┬───────────┘        └──────────┬───────────────┘
           │                               │
           └───────── 通过 UUID 关联 ───────┘
                          │
                          ▼
              ┌──────────────────────┐
              │ 合并后的完整对话列表   │
              │ 296 条 (去重后)       │
              │ 100 条有标题          │
              │ 全部有时间戳          │
              └──────────────────────┘
```

合并策略：

1. 以 `trajectorySummaries` 为主（有标题和详细信息）
2. 用 `agentManagerInitState` 补充更精确的 `lastActiveAt` 时间戳
3. 两个来源中只出现在一个的 UUID 也会被包含

---

## 6. 最终实现

### 6.1 模块: `lib/conversations.js`

```javascript
const { getConversations } = require('./lib/conversations');

const result = getConversations();
// result = {
//   conversations: [
//     {
//       id: "a4316ff4-30d1-4849-a87c-facf37f2cb6c",
//       title: "Adding Serif Font to AI Replies",
//       stepCount: 141,
//       workspace: "[SSH] tiemuer",
//       createdAt: "2025-12-19T08:35:42.000Z",
//       updatedAt: "2025-12-19T08:37:07.000Z",
//     },
//     // ... 296 条
//   ],
//   total: 296,
//   error: null,
// }
```

### 6.2 性能对比

| 指标 | 旧方案 (DOM 抓取) | 新方案 (SQLite 直读) |
|------|---------|---------|
| 耗时 | 3-10 秒 | **18ms** |
| 需要 CDP | ✅ | ❌ |
| 结果数量 | ~10 条 | **296 条** |
| 有标题 | ✅ | ✅ (100/296) |
| 有时间戳 | ❌ | ✅ |
| 有工作区 | ❌ | ✅ |
| 干扰用户 | ✅ 弹窗 | ❌ 无感 |

### 6.3 API 端点

```bash
# REST API
GET /api/conversations?limit=50

# WebSocket
ws.send(JSON.stringify({ type: "get_chats" }))
```

### 6.4 依赖项

```json
{
  "better-sqlite3": "^11.x"  // SQLite 驱动
}
```

不需要任何 protobuf 库 —— 使用手写的轻量级解码器（~80 行），仅支持解码（不需要编码）。

---

## 7. 附录：工具脚本

逆向过程中编写的工具脚本，保存在 `tools/` 目录下：

| 脚本 | 用途 |
|------|------|
| `tools/explore-api.js` | 探测 IDE 窗口中的全局 API 对象 |
| `tools/explore-vscode-api.js` | 深入探索 `vscode` 全局对象 |
| `tools/explore-ipc.js` | 探索 IPC 通道和文件系统 |
| `tools/explore-db.js` | 扫描 SQLite 数据库的表和 key |
| `tools/decode-protobuf.js` | 初版 protobuf 解码器 |
| `tools/decode-deep.js` | 深度解码 `agentManagerInitState` |
| `tools/read-trajectories.js` | 读取 `trajectorySummaries` 数据 |

### 手动验证命令

```bash
# 直接测试 conversations 模块
node -e "const { getConversations } = require('./lib/conversations'); \
  const r = getConversations(); \
  console.log('Total:', r.total); \
  r.conversations.slice(0, 5).forEach(c => console.log(c.title, c.updatedAt));"

# REST API 测试
curl http://localhost:3210/api/conversations?limit=5
```

---

## 补充说明

### 数据新鲜度

`state.vscdb` 由 Antigravity IDE 进程实时写入。每次创建新对话或切换对话时，数据库都会更新。读取模块使用 `readonly: true` 模式打开数据库，不会与 IDE 进程产生锁竞争。

### 已知限制

1. **标题覆盖率**: `trajectorySummaries` 只缓存最近的约 100 条对话摘要。更早的对话只有 UUID 和时间戳，没有标题。
2. **Protobuf schema 可能变化**: 由于是逆向得到的结构，Antigravity 版本更新后 field 编号或嵌套层级可能会变化。
3. **跨平台路径**: 目前只验证了 Windows 路径。macOS/Linux 的数据库路径需要额外验证。

### 潜在的改进方向

1. **补全无标题对话**: 可以通过 CDP 打开对应的对话来获取其标题（按需、懒加载）。
2. **实时监听变化**: 监控 `state.vscdb` 文件的修改时间，在数据变化时自动刷新缓存。
3. **读取对话内容**: 对话的具体消息内容可能存储在其他位置（IndexedDB 或远程服务器），需进一步探索。
