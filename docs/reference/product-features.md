---
title: Antigravity Web 产品功能参考
source: 源码分析 (main.js, lib/, frontend/src/, tools/, scripts/)
updated: 2026-03-09
---

# Antigravity Web 产品功能参考

> 本文档是 antigravity-web 全部功能的深度技术参考。
> 目标: 仅凭本文档即可重写整个项目。
> 按功能域组织, 每个功能包含: 架构、数据流、核心接口、配置项、边界条件、已知问题。

---

## 0. 系统总览

### 定位

脱离 IDE 界面, 通过 Web / Telegram 远程操控 Google Language Server (LS) 的 AI Agent 系统。

### 顺叙流

```
流 1: 用户对话
  [用户] → [Web/Telegram Client] → [BFF Server] → [Controller] → [LS gRPC] → AI 回复

流 2: LS 生命周期
  [ls-daemon.sh] → LS 进程 → [Discovery File] → Controller 自动发现 → 连接

流 3: 实时更新
  [LS StreamAPI] → [StreamClient] → Controller Diff → WebSocket 推送 → 前端渲染

流 4: 命令自动批准
  [WAITING step] → Controller 检测 → HandleCascadeUserInteraction → 恢复执行

流 5: 文件预览
  [前端 file:// 链接] → [File API] → 安全校验 → FileViewer Modal
```

### 技术栈

- **后端**: Node.js (CommonJS), Express, WebSocket (ws), gRPC/Connect Protocol
- **前端**: React + TypeScript + Vite, Zustand 状态管理
- **数据**: SQLite (legacy), Protobuf (.pb 文件), LS gRPC API
- **部署**: PM2 (4 进程), Cloudflare Tunnel
- **通知**: Telegram Bot (grammY)

### 模块地图

```
antigravity-web/
├── main.js                     BFF 入口: Express + WebSocket + REST API
├── lib/
│   ├── core/
│   │   ├── controller.js       核心状态机 (846 行)
│   │   ├── ls-discovery.js     LS 发现层 (361 行)
│   │   ├── stream-client.js    gRPC Streaming 客户端 (263 行)
│   │   ├── step-normalizer.js  Step 数据规范化 (335 行)
│   │   └── ws-protocol.js      WebSocket 协议定义 (217 行)
│   ├── cdp/                    CDP 通信层 (遗留, 已被 gRPC 替代)
│   ├── data/
│   │   ├── conversations.js    SQLite + Protobuf 对话读取
│   │   └── format.js           输出格式化
│   ├── service.js              CLI 业务编排层
│   └── telegram/
│       ├── bot.js              Telegram Bot (686 行)
│       ├── config.js           Bot 配置常量
│       ├── format.js           TG HTML 格式化
│       └── utils.js            安全发送等工具
├── frontend/src/
│   ├── App.tsx                 主布局 (Sidebar + ChatPanel)
│   ├── store/
│   │   ├── app-store.ts        Zustand 全局状态 (525 行)
│   │   └── ws-client.ts        WebSocket 客户端 (379 行)
│   ├── types/
│   │   ├── protocol.ts         WS v2 协议类型 (316 行)
│   │   ├── step.ts             Step 类型定义 (261 行)
│   │   └── config.ts           配置类型 + 元数据 (89 行)
│   ├── components/
│   │   ├── ChatPanel/          对话面板 (含 16 种 Step 渲染组件)
│   │   ├── Sidebar/            侧边栏 (对话列表)
│   │   ├── FileViewer/         文件预览 Modal
│   │   ├── FileBrowser/        文件浏览器
│   │   └── ...
│   └── utils/
│       ├── metadata.ts         Token 用量解析
│       ├── markdown.ts         Markdown 渲染
│       └── format.ts           格式化工具
├── scripts/
│   ├── ls-daemon.sh            LS 守护进程启动脚本
│   ├── ext-server.js           轻量 Extension Server
│   └── ...
├── tools/
│   ├── ag.js                   CLI 统一入口
│   ├── auto-approve.js         命令自动批准守护进程
│   └── probe-*.js              逆向探测脚本
└── ecosystem.config.js         PM2 进程管理配置
```

---

## 1. LS 连接管理

### 功能描述

自动发现本机运行的 Language Server 进程, 获取其 gRPC 端口和 CSRF Token, 建立并维护长期连接。

### 核心文件

- `lib/core/ls-discovery.js` — 发现逻辑
- `lib/core/controller.js` — 连接生命周期管理
- `scripts/ls-daemon.sh` — LS 守护进程

### 发现优先级 (三层 fallback)

```
1. Discovery File (推荐)
   路径: ~/.gemini/antigravity/daemon/ls_*.json
   JSON 结构: { api_server_port, api_server_csrf_token, pid, version }
   验证: isPidAlive(pid) + Heartbeat gRPC 调用

2. 进程参数解析 (fallback)
   方式: `ps aux | grep language_server`
   提取: -csrf_token=xxx -server_port=yyy
   多进程策略: 有 --server_port 的优先, 否则 PID 最大的

3. 异步 Heartbeat 验证 (discoverLSAsync)
   对候选端口逐个调用 Heartbeat API
   超时: 30s
   协议探测: 先 HTTPS → SSL 错误则降级 HTTP (按端口缓存)
```

### gRPC 调用基础设施

- **服务路径**: `/exa.language_server_pb.LanguageServerService/{MethodName}`
- **协议**: Connect Protocol v1 (JSON over HTTP/HTTPS)
- **认证**: `x-codeium-csrf-token` Header
- **协议自动检测**: 首次调用先尝试 HTTPS, 如果报 SSL 错误则降级 HTTP, 结果按端口缓存到 `protocolCache` Map

```javascript
// grpcCall 核心签名
grpcCall(port, csrf, method, body, timeoutMs = 30000)
// 返回: { status: number, data: object }
```

### 健康检查

- **方式**: `Heartbeat` gRPC 调用, 请求体 `{ metadata: {} }`
- **间隔**: 30s (`HEALTH_CHECK_INTERVAL`)
- **失败处理**: 立即 `refreshLS()` 重新发现
- **状态事件**: `ls_connected` / `ls_disconnected` / `ls_reconnected`

### 工作区注册

> Controller 初始化和 LS 切换时自动调用

- `AddTrackedWorkspace({ workspace: homeDir })` — 参数是路径字符串
- `SetWorkingDirectories({ directoryUris: ["file:///home/tiemuer"] })` — 参数是 URI 格式

> 注意: 两个 API 的参数格式不一致 (路径 vs URI), 这是 LS 的设计问题

### LS Daemon 启动参数

```bash
cat ls-metadata.bin | language_server \
  -persistent_mode=true \          # 自动写 discovery file, IDE 关闭后不退出
  -csrf_token=xxx \                # CSRF Token
  -server_port=42100 \             # gRPC 端口
  -random_port=false \             # 固定端口
  -standalone=true \               # 本地 OAuth (不依赖 IDE 同步)
  -extension_server_port=42200 \   # Extension Server (文件读写代理)
  -extension_server_csrf_token=yyy \
  -workspace_id=file_home_tiemuer \
  -cloud_code_endpoint=https://daily-cloudcode-pa.googleapis.com \
  -app_data_dir=antigravity \
  -gemini_dir=.gemini \
  -enable_lsp=false
```

### 关键设计决策

- `standalone=true` + `extension_server_port` 的组合是唯一可行方案
  - 纯 standalone: 无法做文件操作 (缺 Extension Server 回调)
  - 纯 extension server: 需要 OAuth 同步 (ext-server 不支持)
  - 两者结合: Auth 走本地, 工具走 ext-server

### 边界条件

- LS 进程可能 crash 重启, PID 和端口都会变
- 多个 LS 实例可能同时运行 (IDE LS + Daemon LS)
- Discovery File 可能残留 (进程已死但文件未删), 需 `isPidAlive()` 验证
- HTTPS/HTTP 协议不确定, 需运行时探测

### 已知问题

- LS Daemon 在某些环境下频繁重启 (metadata 注入失败或内存超限)
- `protocolCache` 在 LS 重连后不会自动清除 (有 `clearProtocolCache()` 但需手动调用)

---

## 2. 对话管理

### 功能描述

创建对话、发送消息、获取轨迹、取消执行。支持模型配置、文件 @mention、图片上传。

### 核心文件

- `lib/core/controller.js` — `newChat()`, `sendMessage()`, `getTrajectory()`, `cancelCascade()`, `listConversations()`
- `lib/core/ws-protocol.js` — `buildSendBody()`, `DEFAULT_CONFIG`
- `frontend/src/store/app-store.ts` — Zustand actions

### 对话列表数据源 (三层合并)

```
优先级 1: LS API — GetAllCascadeTrajectories
  返回: { trajectorySummaries: { [cascadeId]: { summary, stepCount, status, ... } } }
  数据最全, 有标题、状态、工作区

优先级 2: .pb 文件扫描
  路径: ~/.gemini/antigravity/conversations/*.pb
  仅补充 LS 不知道的旧对话 (已有则跳过)
  只有 updatedAt 和 sizeBytes

优先级 3: SQLite fallback
  数据源: state.vscdb (IDE 本地数据库)
  主要用于补充标题 (LS 和 .pb 都没标题的情况)
  通过 lib/data/conversations.js 读取
```

### 对话生命周期 (LS gRPC 调用)

- `StartCascade({})` → `{ cascadeId }` — 创建新对话
- `SendUserCascadeMessage(body)` → 发送消息 (Body 结构见下)
- `GetCascadeTrajectory({ cascadeId })` → 完整轨迹
- `GetAllCascadeTrajectories({})` → 所有对话摘要
- `CancelCascadeInvocation({ cascadeId })` → 取消执行

### SendUserCascadeMessage 请求体结构

```javascript
{
  cascadeId: "uuid",
  items: [
    { text: "用户消息" },
    // @mention 文件:
    { item: { file: { absoluteUri: "file:///path" } } },
    { text: " " }  // IDE 行为: @mention 后跟空格
  ],
  metadata: {
    ideName: "antigravity",
    apiKey: "",
    locale: "zh",
    ideVersion: "1.19.5",
    extensionName: "antigravity",
  },
  cascadeConfig: {
    plannerConfig: {
      conversational: {
        plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        agenticMode: true/false,    // true=Planning, false=Fast
      },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
          },
        },
        notifyUser: {
          artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO",
        },
      },
      requestedModel: { model: "MODEL_PLACEHOLDER_M37" },
      ephemeralMessagesConfig: { enabled: true },
      knowledgeConfig: { enabled: true },
    },
    conversationHistoryConfig: { enabled: true },
  },
  clientType: "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE",
  // 图片: 顶层 media 字段
  media: [
    { mimeType: "image/png", inlineData: "base64..." }
  ]
}
```

> 注意: media 中的 `inlineData` 是 base64 编码。如果前端传的是 `file://` URI, `buildSendBody()` 会在服务端读取文件并转 base64。

### CascadeConfig 配置项

- `model` (string) — 模型标识符
  - `MODEL_PLACEHOLDER_M37` — Gemini 3.1 Pro (High), 默认
  - `MODEL_PLACEHOLDER_M36` — Gemini 3.1 Pro (Low)
  - `MODEL_PLACEHOLDER_M18` — Gemini 3 Flash
  - `MODEL_PLACEHOLDER_M35` — Claude Sonnet 4.6 (Thinking)
  - `MODEL_PLACEHOLDER_M26` — Claude Opus 4.6 (Thinking)
  - `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` — GPT-OSS 120B
- `agenticMode` (boolean) — `true` = Planning (先规划后执行), `false` = Fast (直接执行)
- `autoExecutionPolicy` — 命令自动执行策略
  - `EAGER` — 激进 (SafeToAutoRun=true 的命令自动执行)
  - `CAUTIOUS` — 谨慎
  - `OFF` — 关闭
- `artifactReviewMode` — 文件修改审查模式
  - `TURBO` — 自动通过
  - `NORMAL` — 普通
  - `STRICT` — 严格
- `knowledgeEnabled` (boolean) — 知识库上下文
- `ephemeralEnabled` (boolean) — 临时系统消息
- `conversationHistoryEnabled` (boolean) — 跨对话历史

> 重要: 后端 `ws-protocol.js` 的 `DEFAULT_CONFIG` 中 `agenticMode: false`, 但前端 `config.ts` 的 `DEFAULT_CONFIG` 中 `model: 'MODEL_PLACEHOLDER_M26'`。两端默认值不同步, 重构时需统一。

### 前端对话流程

```
selectConversation(id)
  → ws.sendAndWait({ type: 'req_trajectory', cascadeId })
  → 更新 store.steps / store.status
  → ws.send({ type: 'req_subscribe', cascadeId })
  
sendMessage(text)
  → ws.sendAndWait({ type: 'req_send_message', cascadeId, text })
  → 自动 subscribe (服务端在 handleMessage 中调用)
  → 等待 event_step_added / event_step_updated 推送
```

### ConversationSummary 数据结构

- `id` (string) — 对话 UUID
- `title` (string) — 对话标题 (LS 中叫 summary)
- `status` (string) — IDLE / RUNNING / UNKNOWN
- `stepCount` (number) — 总步骤数
- `updatedAt` (string) — ISO 时间戳
- `createdAt` (string) — 创建时间
- `lastUserInputTime` (string) — 最后用户输入时间
- `workspace` (string) — 工作区路径 URI
- `sizeBytes` (number) — .pb 文件大小 (仅 file 来源)
- `source` (string) — `ls` / `file` / `sqlite`

### 边界条件

- `SendUserCascadeMessage` 发送后, 对话立即标记为 RUNNING 并启动轮询
- 发送消息时如果 LS 断开, 会抛出 `LS not connected` 错误
- `listConversations()` 中三个数据源的 try-catch 是独立的, 任一失败不影响其他
- 图片上传: 前端先通过 `POST /api/upload` 上传到 `/tmp/antigravity_uploads/`, 拿到 `file://` URI 后传给 WS

---

## 3. 实时流式更新

### 功能描述

通过 LS 的 gRPC Streaming API 订阅对话变化通知, 配合 Diff 引擎计算增量, 推送给前端。

### 核心文件

- `lib/core/stream-client.js` — `StreamClient` 类
- `lib/core/controller.js` — `_onStreamChange()`, `_fetchAndDiff()`, `_broadcastWithSeq()`, `diffSteps()`

### 架构: 通知-拉取模式

```
LS StreamAPI (SSE-like)                   Controller
────────────────────                      ─────────────────
StreamCascadeReactiveUpdates              _onStreamChange()
  → "cascadeId changed" 通知    ────→     → 节流 (throttle with trailing)
                                          → 调用 GetCascadeTrajectory 拉取最新
                                          → diffSteps() 计算增量
                                          → _broadcastWithSeq() 推送给 WS 客户端
```

> 设计选择: LS Streaming 只发通知 (不含具体数据), Controller 收到通知后主动拉取最新数据再 diff。这比直接推送增量更可靠 (不丢 step)。

### StreamClient 实现细节

- **协议**: Connect Streaming (HTTP/HTTPS POST, Server-Sent Events 风格)
- **路径**: `/exa.language_server_pb.LanguageServerService/StreamCascadeReactiveUpdates`
- **请求体**: `{ cascadeId }` (JSON, 需 5 字节 Connect envelope 前缀)
- **响应**: 持续返回 envelope 消息, 每条固定 5 字节头 (flag + bigEndian length) + JSON payload
- **超时检测**: 60s 无数据视为僵死, 心跳每 15s 检查一次
- **断线重连**: `disconnected` 事件触发 2s 后自动重连 (如果仍有 subscriber)

### 节流策略 (throttle with trailing)

```
收到流式通知 → _onStreamChange(cascadeId)
  1. 检查距上次 fetch 的时间间隔 (elapsed)
  2. 动态节流间隔:
     - GENERATING 状态: 300ms
     - 其他状态:       150ms
  3. if elapsed >= throttleMs → 立即 fetch
  4. else → 设置尾调用 timer, 保证窗口结束后还会执行一次
```

> 为什么不用纯 debounce: 高频通知下会活锁 (每次新通知 clearTimeout 上一次, fetchAndDiff 永远不执行)

### Diff 引擎

```javascript
diffSteps(oldSteps, newSteps) → { added: [{index, step}], updated: [{index, step}] }
```

比较三个维度:
1. **新增 step**: `newSteps[i]` 超出 `oldSteps.length`
2. **状态变化**: `newSteps[i].status !== oldSteps[i].status`
3. **文本内容变化**: `plannerResponse.response` 或 `plannerResponse.thinking` 不同 (流式输出时内容持续增长)

### 事件序列号 (seq) 机制

- 每个 ConversationState 维护独立的 `nextSeq` 计数器 (从 1 开始)
- 每次广播事件时分配递增 seq: `{ ...event, seq: nextSeq++ }`
- 环形缓冲区: `eventBuffer` 最多保存 200 条 (`EVENT_BUFFER_MAX`)
- **增量恢复**: 客户端 subscribe 时可传 `lastSeq`, 服务端回放缓冲区中 `seq > lastSeq` 的事件
- 回放格式: `{ type: 'events_batch', cascadeId, events: [...] }`

### 轮询 Fallback

- **触发条件**: `sendMessage()` 后立即启动, 作为流式通知的备份
- **轮询间隔**: 
  - 主循环 tick: 500ms (`POLL_TICK_MS`)
  - 每个对话自适应: 初始 1s, 失败时退避 (*1.5), 最大 5s
  - 成功后重置为 1s
- **停止条件**: 没有 RUNNING 状态的对话时自动停止
- **错误处理**: 
  - `ECONNREFUSED` / `timeout` → 触发 `refreshLS()` 重新发现 LS
  - 其他错误 → 退避重试

### WebSocket 事件类型

- `event_step_added` — 新增 step: `{ cascadeId, stepIndex, step, seq }`
- `event_step_updated` — step 更新: `{ cascadeId, stepIndex, step, seq }`
- `event_status_changed` — 对话状态变化: `{ cascadeId, from, to, seq }`
- `event_metadata_updated` — token 用量变化: `{ cascadeId, metadata, seq }`
- `event_ls_status` — LS 连接状态: `{ connected, port, pid }`

### 前端处理

- `ws-client.ts` 的 `handleRawMessage()` 解析 JSON 后分发给 handlers
- `app-store.ts` 监听事件, 直接更新 `steps[]` 数组:
  - `event_step_added` → `steps.push(step)` 或 `steps[stepIndex] = step`
  - `event_step_updated` → `steps[stepIndex] = step`
  - `event_status_changed` → 更新 `conversationStatus`

### 边界条件

- StreamClient 和 Polling 可能同时触发同一个 cascadeId 的 fetch, 导致重复 diff。由于 diff 基于 index 的精确比较, 结果是幂等的 (重复推送不会出错, 只是浪费带宽)
- 前端断线重连时通过 `lastSeq` 恢复, 但缓冲区只有 200 条。长时间断线 (>200 条事件) 会丢失, 需要重新 `req_trajectory` 全量拉取
- Streaming 连接建立有延迟, 发送消息后的前几个 step 可能靠轮询先到达

---

## 4. 命令自动批准

### 功能描述

LS 在 Agentic Mode 下执行命令或修改文件时, 会暂停等待用户批准。自动批准系统检测 WAITING 状态的 step 并自动发送批准请求。

### 核心文件

- `tools/auto-approve.js` — 独立守护进程 (429 行)
- `docs/findings/260301-code-action-approval.md` — 逆向过程记录

### WAITING 检测条件

```javascript
step.status === 'CORTEX_STEP_STATUS_WAITING'   // 注意: 不是 PENDING
step.requestedInteraction 存在
```

### requestedInteraction 类型 (逆向自 extension.js proto 定义)

- `runCommand` (field 5) — 命令执行批准
  - `CascadeRunCommandInteraction`: `{ confirm: bool, proposedCommandLine: string }`
- `filePermission` (field 19) — 代码修改批准
  - 当 `artifactReviewMode` 非 TURBO 时触发
  - `FilePermissionInteraction`: `{ allow: bool, scope: string, absolutePathUri: string }`
- `deploy` (field 4) — 部署确认
- `browserAction` (field 6) — 浏览器操作批准
- `openBrowserUrl` (field 13) — 打开浏览器 URL 批准
- `sendCommandInput` (field 16) — 向运行中命令发送输入 (如 y/n)
- `mcp` (field 18) — MCP 工具调用确认

### 批准 API

```javascript
HandleCascadeUserInteraction({
  cascadeId: "uuid",
  interaction: {
    trajectoryId: "uuid",          // 从 trajectory 获取
    stepIndex: 5,                  // step 在数组中的 index (uint32)
    // oneof interaction:
    runCommand: {                  // 批准命令
      confirm: true,
      proposedCommandLine: "npm install"
    }
    // 或
    filePermission: {              // 批准文件修改
      confirm: true
    }
  }
})
```

> 关键: `stepIndex` 和 `trajectoryId` 必须嵌套在 `interaction` 内部, 不是顶层字段。早期调试时放错位置导致 stepIndex 始终被读为 0。

### auto-approve.js 运行模式

- **独立进程**: 不依赖 Controller, 自己做 LS 发现和 gRPC 调用
- **多 LS 支持**: 发现所有本机 LS 实例 (含 IDE 的), 同时监控
- **Windows/Linux 通用**: 通过 `os.platform()` 选择 PowerShell/ps 发现方式
- **命令行参数**:
  - `--interval <ms>` — 轮询间隔 (默认 2000)
  - `--dry-run` — 只检测不批准
  - `--once` — 只检查一次后退出
  - `--verbose` — 详细日志
- **去重**: `approvedKeys` Set 记录已处理的 `cascadeId:stepIndex` 组合
- **5 分钟自动重新发现 LS**: 处理 LS 重启后端口变化

### 与 EAGER 策略的关系

- EAGER 策略只对 `SafeToAutoRun=true` 的命令生效
- 模型标记 `SafeToAutoRun=false` 的命令 EAGER 也不会自动执行
- 必须通过 `HandleCascadeUserInteraction` API 手动批准

### 边界条件

- 批准失败会 fallback 到 `ResolveOutstandingSteps` (已知该 API 返回 200 但实际不生效)
- 批准失败的 step 不会标记为已处理, 下次轮询重试
- `agenticMode: false` (Fast Mode) 不需要批准, LS 自动执行所有操作

---

## 5. Step 渲染体系

### 功能描述

LS 返回的对话轨迹由 Step 序列组成, 每种 Step 类型对应不同的 UI 渲染。

### 核心文件

- **后端规范化**: `lib/core/step-normalizer.js`
- **前端类型**: `frontend/src/types/step.ts`
- **前端分发**: `frontend/src/components/ChatPanel/StepRenderer.tsx`
- **前端组件**: `frontend/src/components/ChatPanel/steps/*.tsx` (16 个)

### Step 数据流

```
LS gRPC 原始数据
  → step-normalizer.js (字段映射 + 提取)
  → WebSocket 推送 (normalized)
  → StepRenderer.tsx (type → component 映射)
  → 各 Step 组件渲染
```

### Step 类型清单

可见类型 (15 种):

- `USER_INPUT` — 用户输入
  - payload: `{ items: [{ text }] }`
  - 渲染: 蓝色气泡, 提取文本显示
- `PLANNER_RESPONSE` — AI 回复 (最重要)
  - payload: `{ thinking, response, toolCalls }`
  - 渲染: Markdown 渲染, 支持思考过程折叠, toolCalls 列表
- `VIEW_FILE` — 查看文件
  - payload: `{ filePath, content, startLine, endLine }`
  - normalizer: 从 `absolutePathUri` 提取路径
- `VIEW_FILE_OUTLINE` — 查看文件大纲
  - payload: `{ filePath, outlineItems, numLines, numBytes }`
- `VIEW_CODE_ITEM` — 查看代码项
  - payload: `{ filePath, nodePaths, items: [{ nodeName, startLine, endLine, snippet, signature }] }`
- `CODE_ACTION` — 代码修改
  - payload: `{ filePath, diff, description }`
  - normalizer: 从 `replacementChunks` 生成 unified diff 格式
- `RUN_COMMAND` — 运行命令
  - payload: `{ command, commandLine, proposedCommandLine, cwd, blocking, exitCode, combinedOutput, shouldAutoRun, autoRunDecision }`
- `COMMAND_STATUS` — 命令状态
  - payload: `{ commandId, status, combined, delta, exitCode }`
- `LIST_DIRECTORY` — 列出目录
  - payload: `{ path, entries: [{ name, isDir, size }] }`
- `NOTIFY_USER` — 通知用户
  - payload: `{ message }`
- `ERROR_MESSAGE` — 错误消息
  - payload: `{ message, code }`
- `CHECKPOINT` — 检查点
  - payload: `{ userIntent }`
- `SEARCH_WEB` — 搜索网页
  - payload: `{ query, results: [{ title, url, snippet }] }`
- `GREP_SEARCH` — 文本搜索
  - payload: `{ searchPath, query, results: [{ file, lineNumber, lineContent }], totalResults }`
- `FIND` — 文件查找
  - payload: `{ searchDirectory, pattern, totalResults }`

隐藏类型 (5 种, debug 模式下可见):

- `EPHEMERAL_MESSAGE` — 临时系统消息
- `CONVERSATION_HISTORY` — 对话历史上下文
- `KNOWLEDGE_ARTIFACTS` — 知识库内容
- `TASK_BOUNDARY` — 任务边界
- `CODE_ACKNOWLEDGEMENT` — 代码确认

### Step 状态枚举

- `UNSPECIFIED` — 未指定
- `PENDING` — 等待执行
- `GENERATING` — 生成中 (流式输出)
- `DONE` — 完成
- `ERROR` — 错误
- `WAITING` — 等待用户交互 (批准)

### step-normalizer 规范化规则

核心原则:
- 只做字段映射 + 提取, 不做业务逻辑
- 保留原始字段 (`_raw`), 方便 debug
- 未识别的 step 类型原样透传

关键映射:
- `absolutePathUri` → `filePath` (通过 `uriToPath()` 去掉 `file://` 前缀)
- `replacementChunks` → `diff` (通过 `chunksToDiff()` 生成 unified diff)
- `commandLine` / `proposedCommandLine` → 统一为 `command`
- `payload key` 由 `PAYLOAD_KEYS` 映射表决定 (如 `CORTEX_STEP_TYPE_VIEW_FILE` → `viewFile`)

```javascript
// PAYLOAD_KEYS 映射表
const PAYLOAD_KEYS = {
  'CORTEX_STEP_TYPE_USER_INPUT': 'userInput',
  'CORTEX_STEP_TYPE_PLANNER_RESPONSE': 'plannerResponse',
  'CORTEX_STEP_TYPE_VIEW_FILE': 'viewFile',
  'CORTEX_STEP_TYPE_CODE_ACTION': 'codeAction',
  'CORTEX_STEP_TYPE_RUN_COMMAND': 'runCommand',
  // ...
};
```

### Token 用量解析

`GeneratorMetadata` 数组关联 step 和模型调用:
- `stepIndices: number[]` — 该次调用产生的 step 索引
- `chatModel.usage` — token 用量 (inputTokens/outputTokens 是字符串)
- `chatModel.timeToFirstToken` — 首 token 延迟 ("1.602s" 格式)
- `chatModel.streamingDuration` — 流式持续时间

`buildStepUsageMap()` 将 metadata 展开为 `Map<stepIndex, StepUsageInfo>`, 供 UI 按 step 显示用量。

### 边界条件

- LS 可能返回 normalizer 不认识的 step 类型 → 原样透传, 前端 StepRenderer 走 `default` 分支显示 JSON
- `plannerResponse.response` 在 GENERATING 状态下持续增长, diff 引擎通过文本比较检测变化
- `replacementChunks` 中的 `startLine/endLine` 是 0-indexed, diff 输出转为 1-indexed

---

## 6. 文件系统访问

### 功能描述

前端可以浏览服务端项目文件、预览 Markdown 和代码文件, 通过安全的 REST API 实现。

### 核心文件

- **后端**: `main.js` (260-365行) — `GET /api/file`, `GET /api/fs/list`
- **前端**: `frontend/src/components/FileViewer/FileViewer.tsx`, `frontend/src/components/FileBrowser/FileBrowser.tsx`

### REST API

#### `GET /api/file?path=<relative-path>`

读取单个文件内容。

- **安全校验**:
  1. `path.resolve(FILE_ROOT, relPath)` — 解析绝对路径
  2. `fs.realpathSync()` — 解析符号链接, 防止目录穿越
  3. `realAbs.startsWith(realRoot + path.sep)` — 确保在项目根目录内
  4. `stat.isFile()` — 确保是文件
  5. 文件大小限制: 5MB
- **FILE_ROOT**: 环境变量 `FILE_ROOT` 或 `__dirname` (项目根目录)
- **响应**: `{ content, filename, path, extension, size, mtime }`

#### `GET /api/fs/list?path=<relative-path>`

列出目录内容。

- **安全校验**: 同 `/api/file`
- **过滤**: 忽略隐藏文件 (`.` 开头) 和 `node_modules`
- **排序**: 文件夹在前, 文件在后, 各自按 a-z 排序
- **响应**: `{ path, items: [{ name, path, isDir }] }`

#### `POST /api/upload`

上传文件 (图片等)。

- **存储**: `/tmp/antigravity_uploads/` (multer diskStorage)
- **文件名**: `upload-{timestamp}-{random}.{ext}`
- **MIME 修正**: `image/jpg` → `image/jpeg`
- **响应**: `{ uri: "file:///tmp/...", mimeType, originalName, size }`

### 前端集成

- AI 回复中的 `file://` 链接被拦截, 点击后打开 FileViewer Modal
- FileViewer 支持:
  - Markdown: 渲染为富文本
  - 代码文件: 语法高亮显示
  - 其他: 纯文本

### 边界条件

- `FILE_ROOT` 默认是项目根目录而非 HOME, 只能访问项目内文件
- 符号链接指向 `FILE_ROOT` 外部的文件会被拒绝 (403)
- 大于 5MB 的文件返回 413
- 二进制文件会被 `utf-8` 读取导致乱码 (未做二进制检测)

---

## 7. WebSocket v2 协议

### 功能描述

前端与 BFF 之间的双向通信协议, 基于 JSON over WebSocket。

### 核心文件

- **后端**: `lib/core/ws-protocol.js` — 协议定义
- **后端**: `main.js` — handleMessage 路由
- **前端**: `frontend/src/types/protocol.ts` — TypeScript 类型
- **前端**: `frontend/src/store/ws-client.ts` — WebSocket 客户端

### 消息约定

- 所有消息必须有 `type` 字段
- **请求**: `req_*` (客户端 → 服务端), 带可选 `reqId`
- **响应**: `res_*` (服务端 → 客户端), 回带相同 `reqId`
- **事件**: `event_*` (服务端主动推送, 无 `reqId`)
- **心跳**: 原始字符串 `ping` → `pong` (不走 JSON 路径)

### 请求-响应清单

- `req_status` → `res_status` — 查询 LS/账户/模型/配额状态
- `req_conversations` → `res_conversations` — 获取对话列表 (支持 limit/search)
- `req_trajectory` → `res_trajectory` — 获取完整对话轨迹
- `req_new_chat` → `res_new_chat` — 创建新对话 (返回 cascadeId)
- `req_send_message` → `res_send_message` — 发送消息 (自动 subscribe)
- `req_subscribe` → `res_subscribe` — 订阅对话实时更新 (支持 lastSeq)
- `req_unsubscribe` → `res_unsubscribe` — 取消订阅
- `req_set_config` → `res_config` — 修改默认配置
- `req_get_config` → `res_config` — 获取当前配置
- `req_cancel` → `res_cancel` — 取消正在执行的对话

### 前端 WSClient 实现

- **自动重连**: 指数退避 (1s → 2s → 4s → ..., 最大 30s)
- **心跳**: 每 25s 发送 `ping`, 超时 10s 未收到 `pong` 视为断线
- **可见性感知**: 页面隐藏时暂停心跳, 恢复可见时立即 ping
- **请求-响应匹配**: `sendAndWait()` 通过 `reqId` 匹配, 10s 超时
- **reqId 生成**: 递增计数器 `r-1`, `r-2`, ...
- **网络恢复**: 监听 `window.addEventListener('online')`, 立即重连

### 边界条件

- `req_send_message` 的响应只表示消息已发送, 不表示 AI 已开始处理
- 多个客户端可以同时连接, subscribe 同一个对话
- 客户端断开时 `unsubscribeAll()` 自动清理所有订阅
- 无 subscriber 时 StreamClient 自动断开流连接, 避免僵尸流

---

## 8. Telegram Bot

### 功能描述

通过 Telegram 客户端与 AI 对话, 支持命令管理、流式回复、图片上传。

### 核心文件

- `lib/telegram/bot.js` — Bot 主体 (686 行)
- `lib/telegram/config.js` — 常量配置
- `lib/telegram/format.js` — TG HTML 格式化
- `lib/telegram/utils.js` — 安全发送工具

### 架构

- 内嵌在 `main.js` 中, 共享 Controller 实例
- 通过 `createMockWs()` 适配器将 Controller 的 subscribe 系统接入 Bot
- `MockWs` 模拟 WebSocket 接口: `{ readyState: 1, send(msg), close() }`

### 命令体系

- `/start` — 起始 / 用户验证 (白名单 CHAT_ID 过滤)
- `/new` — 创建新对话
- `/list [n]` — 列出最近 n 个对话
- `/switch <index|id>` — 切换对话
- `/status` — 显示 LS / 对话 / 配置状态
- `/model <name>` — 切换模型
- `/mode` — 切换 Planning / Fast 模式
- `/cancel` — 取消当前对话

### 流式回复机制

```
sendAndStream(ctx, controller, cascadeId, text, extras)
  1. controller.sendMessage() — 发送消息到 LS
  2. createMockWs(onMessage) — 创建 Mock WS
  3. controller.subscribe(cascadeId, mockWs) — 订阅更新
  4. 监听事件:
     - event_step_added (PLANNER_RESPONSE) → 发送初始消息
     - event_step_updated → 编辑消息 (safeEditText, 节流)
     - event_status_changed (→ IDLE) → 发送最终回复
  5. 最终: controller.unsubscribe + mockWs.close()
```

### 消息格式化

- TG 使用 HTML 格式 (不是 Markdown)
- `format.js` 将 Step 数据转为 TG HTML (加粗/斜体/代码块)
- `safeSendChunks()`: HTML 失败时降级纯文本, 超长自动拆分 (TG 限制 4096 字符)
- 编辑消息 vs 发送新消息: PLANNER_RESPONSE 更新时编辑已发消息, 其他 step 发新消息

### 状态持久化

- 文件: `data/telegram-state.json`
- 内容: 每个 chatId 对应的 currentCascadeId
- 作用: 重启后恢复对话上下文

### 图片上传

- 用户发送图片 → Bot 下载到临时文件
- 读取文件为 Base64 → 传入 controller.sendMessage 的 extras.media
- 支持压缩图和文档

### 边界条件

- TG Bot 启动失败不影响 Web 服务 (非阻塞, `.catch()` 兜底)
- 消息队列: 串行处理, 避免并发修改同一对话
- 编辑消息间隔: `STREAM_UPDATE_MS` 节流, 避免 TG API 限频
- 白名单验证: `CHAT_ID` 环境变量, 未授权用户无法使用

---

## 9. 部署与运维

### 功能描述

PM2 管理 4 个进程, Cloudflare Tunnel 暴露到公网。

### PM2 进程配置 (ecosystem.config.js)

- `antigravity-web` — BFF 服务 (main.js)
  - 端口: 3210
  - watch: `main.js`, `lib/`
  - 内存限制: 300M
- `vite-dev` — Vite 开发服务器
  - 端口: 5173
  - `--host 0.0.0.0`
- `cloudflared` — Cloudflare Tunnel
  - `cloudflared tunnel run antigravity-web`
- `ls-daemon` — LS 守护进程
  - 端口: 42100
  - 自动重启, 最多 3 次, 间隔 5s

### 静态文件策略

- Vite hashed assets (`/assets/*`): 1 年不可变缓存 (`immutable`)
- HTML / SW: no-cache (每次验证)
- 其他静态文件: 1 小时
- SPA fallback: 非 `/api/` 路径全部返回 `index.html`

### CLI 工具 (tools/ag.js)

- `ag list [--limit n] [--search keyword] [--local]` — 列出对话
- `ag export [id|index|title] [--all]` — 导出对话为 Markdown + JSON
- `ag status` — API 状态

---

## 10. 已知架构问题与重构建议

### 数据结构不一致

- 后端 `DEFAULT_CONFIG` 和前端 `DEFAULT_CONFIG` 有差异 (agenticMode, model 默认值)
- LS 返回的字段名 (camelCase) 与前端约定不完全一致, 依赖 step-normalizer 桥接
- `ConversationSummary` 的字段在不同数据源 (ls/file/sqlite) 中可选性不同

### 架构分层问题

- `main.js` 同时承担 HTTP 服务、WebSocket 路由、REST API、文件上传, 职责过多
- `controller.js` 846 行, 混合了: 连接管理、对话状态机、Diff 引擎、轮询、事件广播
- `service.js` 和 `controller.js` 存在功能重叠 (都能 listConversations), service.js 走 CDP/SQLite, controller 走 gRPC
- `lib/cdp/` 是遗留代码, 已被 gRPC 替代但仍被 service.js 引用

### 稳定性风险

- LS Daemon 频繁重启 (2170+ 次观测记录)
- StreamClient 无指数退避重连 (固定 2s)
- `protocolCache` 不自动失效
- 前端 `sendAndWait` 10s 超时, LS 慢时可能误判

### 重构方向

1. **拆分 Controller**: 连接管理、对话管理、Diff/广播 可拆为独立模块
2. **统一配置源**: 前后端共享一份 CascadeConfig 定义
3. **清理遗留**: 移除 `lib/cdp/`, `lib/service.js`, `lib/data/` (除非需要 SQLite fallback)
4. **TypeScript 化**: 后端改用 TypeScript, 与前端共享类型
5. **协议升级**: WebSocket 协议加版本号, 支持协商
6. **LS Daemon 健康检查**: 实现专用 Health Endpoint, 区分"进程存在"和"服务可用"
