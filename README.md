# Antigravity Web Chat

通过 Web 界面远程操控 Antigravity IDE 的 AI Chat 面板。

## 架构

```
antigravity-web/
├── server.js                Web 服务 + WebSocket 消息路由 + REST API
├── switch-window.js         CDP 窗口管理工具（切换/关闭）
├── lib/
│   ├── cdp.js               CDP 通信层（连接、消息发送、JS 求值）
│   ├── ide.js               IDE 操作层（Chat 面板 DOM 操控）
│   └── conversations.js     对话历史读取（SQLite 直读 + Protobuf 解码）
├── tools/
│   ├── cdp-inspect.js       CDP 窗口全景探测
│   ├── chat-panel-probe.js  Chat 面板按钮/DOM 探测
│   ├── explore-api.js       IDE 全局 API 探测
│   ├── explore-ipc.js       IPC 通道 & 文件系统探测
│   ├── explore-db.js        SQLite 数据库结构扫描
│   ├── decode-protobuf.js   Protobuf 结构解码器
│   └── decode-deep.js       深度 Protobuf 解码 (agentManagerInitState)
├── docs/
│   └── conversation-data-reverse-engineering.md  逆向解析过程文档
├── public/
│   ├── index.html           前端页面
│   ├── style.css            样式
│   └── app.js               前端逻辑
└── package.json
```

### 模块职责

| 模块 | 行数 | 职责 |
|------|------|------|
| `server.js` | ~250 | Express 静态文件服务, REST API, WebSocket 双向通信, 消息队列, 客户端路由 |
| `lib/cdp.js` | ~130 | `httpGet`, `cdpSend`, `cdpEval`, `sleep`, CDP 连接/重连/心跳管理 |
| `lib/ide.js` | ~340 | IDE Chat 面板操作: 输入/发送/读取回复/截屏/新建对话/流式等待 |
| `lib/conversations.js` | ~320 | 对话历史直读: SQLite 读取 + Protobuf 解码 + 双数据源合并 (无需 CDP) |

## 运行

```bash
npm start                    # 启动 Web 服务 (默认端口 3210)
# 或
node server.js

# 环境变量
CDP_HOST=127.0.0.1           # IDE 的 CDP 地址
CDP_PORT=9000                # IDE 的 CDP 端口
PORT=3210                    # Web 服务端口
```

启动后访问 `http://localhost:3210` 即可使用 Web Chat 界面。

## REST API

### GET /api/conversations

直接从 IDE 本地 SQLite 数据库读取对话历史，**无需 CDP 连接**。

```bash
curl http://localhost:3210/api/conversations?limit=10
```

响应:

```json
{
  "total": 296,
  "conversations": [
    {
      "id": "a4316ff4-30d1-4849-a87c-facf37f2cb6c",
      "title": "Adding Serif Font to AI Replies",
      "stepCount": 141,
      "workspace": "[SSH] tiemuer",
      "createdAt": "2025-12-19T08:35:42.000Z",
      "updatedAt": "2025-12-19T08:37:07.000Z"
    }
  ]
}
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `limit` | 50 | 返回条目数量上限 (最大 500) |

## 工具脚本

### switch-window.js — 窗口管理

```bash
# 列出所有窗口（交互模式）
node switch-window.js

# 切换窗口焦点
node switch-window.js antigravity-web    # 模糊匹配
node switch-window.js 0                  # 按编号

# 关闭窗口（带闭环验证: 观察→关闭→重新观察→验证）
node switch-window.js --close phantom    # 模糊匹配
node switch-window.js -c 3              # 按编号
```

关闭验证流程:
1. **Step 1**: 观察 — 记录关闭前的目标数量, 确认目标 ID 存在
2. **Step 2**: 关闭 — 发送 `Target.closeTarget` 指令
3. **Step 3**: 等待 — 最多重试 3 次 (800ms → 1.5s → 3s)
4. **Step 4**: 重新观察 — 重新查询目标列表
5. **Step 5**: 验证 — 三维度判断: ID 消失 (核心) + 页面数减少 + 总数减少

### tools/cdp-inspect.js — 窗口全景探测

```bash
node tools/cdp-inspect.js               # 完整报告 (含 DOM 探测)
node tools/cdp-inspect.js --quick       # 快速模式 (仅列表分类)
```

### tools/chat-panel-probe.js — Chat 面板探测

```bash
node tools/chat-panel-probe.js          # 探测 Chat 面板按钮和 DOM 结构
```

## CDP 窗口类型

Antigravity IDE 在 CDP 端口上暴露多种目标:

| 类型 | 说明 | 示例 title |
|------|------|-----------|
| 🖥️ IDE 工作区 | 完整的编辑器窗口, 含 Chat 面板 | `antigravity-web - Antigravity - server.js [Admin]` |
| 🤖 Agent Manager | Jetski Agent 管理窗口 | `Manager`, `Launchpad` |
| ⚙️ Worker | Extension Host 等后台进程 | (无标题) |

### 关键发现 (2026-02-25)

- 每个打开的**工作区**对应一个独立的 CDP page target
- 多个工作区可能**共享同一个 Electron BrowserWindow** (相同位置/大小), 通过标签页切换
- 关闭一个工作区 page 会连带清理其关联的 worker (总数减少 1~3)
- `Manager` / `Launchpad` URL 含 `workbench-jetski-agent.html`, 管理所有 Agent 对话
- Manager 中有 "Start conversation" 按钮和工作区列表, 存储 100+ 历史对话

## 对话数据逆向 (2026-02-25)

对话历史数据存储在本地 SQLite 数据库 `%APPDATA%\Antigravity\User\globalStorage\state.vscdb` 中，通过逆向 Protobuf 编码实现了程序化读取。

### 数据来源

| 数据源 (SQLite key) | 编码 | 内容 | 条目数 |
|-----|------|------|--------|
| `jetskiStateSync.agentManagerInitState` | Base64 → Protobuf | UUID + 最后活跃时间戳 | ~196 |
| `antigravityUnifiedStateSync.trajectorySummaries` | Base64 → Protobuf → Base64 → Protobuf | UUID + 标题 + 步骤数 + 工作区 + 时间戳 | ~100 |

两个数据源通过 UUID 关联合并，去重后共 296 条对话。

### 性能对比

| 指标 | 旧方案 (DOM 抓取) | 新方案 (SQLite 直读) |
|------|---------|--------|
| 耗时 | 3-10 秒 | **18ms** |
| 需要 CDP | ✅ | ❌ |
| 结果数量 | ~10 条 | **296 条** |
| 干扰用户 | ✅ 弹窗闪烁 | ❌ 完全无感 |

> 逆向过程的完整细节见 [`docs/conversation-data-reverse-engineering.md`](docs/conversation-data-reverse-engineering.md)

## Chat 面板按钮结构

实测日期: 2026-02-25

```
顶部工具栏 (y ≈ 42, 各 16×16):
  [new-conversation-tooltip]    新建对话 (⚠️ 旧版叫 new-chat-tooltip)
  [history-tooltip]             对话历史
  [UUID]                        设置按钮 (tooltip 为动态 UUID)
  [UUID]                        更多操作 (tooltip 为动态 UUID)

底部输入区 (y ≈ 411, 各 24×24):
  [audio-tooltip]                       语音输入
  [input-send-button-send-tooltip]      发送按钮

隐藏元素 (0×0):
  [UUID-delete-conversation]            删除对话 (hover 时显示)
```

## 通信协议

Web 前端通过 WebSocket 与 server.js 通信, 支持以下消息类型:

### 客户端 → 服务端

| type | 参数 | 说明 |
|------|------|------|
| `send_message` | `text` | 发送消息到 IDE Chat |
| `reconnect` | — | 强制重连 CDP |
| `screenshot` | — | 截取 IDE 屏幕 |
| `new_chat` | — | 新建对话 |
| `get_chats` | — | 获取对话列表 (SQLite 直读, 无需 CDP) |
| `open_chat` | `index` | 打开指定对话 |
| `read_last` | — | 读取最后一条 AI 回复 |

### 服务端 → 客户端

| type | 字段 | 说明 |
|------|------|------|
| `cdp_status` | `connected` | CDP 连接状态 |
| `status` | `message` | 操作进度提示 |
| `stream` | `thinking`, `blocks`, `reply`, `tools` | 流式回复更新 |
| `reply` | `thinking`, `blocks`, `reply`, `tools`, `timedOut` | 最终回复 |
| `screenshot` | `data` (base64) | 截屏结果 |
| `new_chat_ok` | — | 新建对话成功 |
| `chat_list` | `current`, `recent[]`, `total` | 对话列表 (recent 含 `id`, `title`, `workspace`, `updatedAt`, `stepCount`) |
| `error` | `message` | 错误信息 |
