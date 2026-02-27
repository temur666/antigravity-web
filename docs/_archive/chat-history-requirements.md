# 获取 Antigravity 对话历史的必要条件

> 整理于 2026-02-26，基于实际测试结果

## 数据存储架构

Antigravity 的对话数据分为两层：

| 层级 | 内容 | 存储位置 | 访问方式 |
|------|------|----------|----------|
| **元数据** | UUID、标题、步骤数、工作区、时间戳 | 本地 SQLite (`state.vscdb`) | 直接文件读取，无需 CDP |
| **消息正文** | 用户提问、AI思考、AI回复、工具调用 | **不在本地** (云端/内存) | 必须通过 CDP 从 DOM 读取 |

### 元数据位置

```
%APPDATA%\Antigravity\User\globalStorage\state.vscdb
```

SQLite key:
- `antigravityUnifiedStateSync.trajectorySummaries` — Base64 → Protobuf，包含 UUID、标题、步骤数、工作区、时间戳
- `jetskiStateSync.agentManagerInitState` — Base64 → Protobuf，包含 UUID、最后活跃时间戳（该 key 可能不存在）

### 消息正文 — 不在本地

以下位置已确认**不包含**消息正文：
- ✗ 全局 `state.vscdb`（164 个 key，无一包含消息正文）
- ✗ 各 workspace 的 `state.vscdb`（均仅有 IDE 配置数据）
- ✗ Local Storage / Session Storage / WebStorage
- ✗ 本地文件系统（按 UUID 搜索无结果）

**结论: 消息正文仅存在于 IDE 进程内存中（从云端加载），只能通过 CDP 读取 DOM 获取。**

---

## 通过 CDP 获取消息正文的必要条件

### 前置条件

| # | 条件 | 验证方法 | 首次失败原因 |
|---|------|----------|-------------|
| 1 | **Antigravity IDE 正在运行** | 检查进程 | IDE 未启动 |
| 2 | **IDE 开启了 CDP 调试端口** | `http://127.0.0.1:9000/json` | 端口 9000 `ECONNREFUSED` |
| 3 | **工作区有打开的 Chat 面板** | `#conversation` 元素存在 | — |
| 4 | **Chat 面板中有加载的对话** | `#conversation` 有子元素 | — |

### IDE 启动方式

IDE 必须以调试端口启动，才能通过 CDP 访问：
```bash
antigravity --remote-debugging-port=9000
```

### CDP 连接验证

```bash
# 快速检查 CDP 是否可用
curl http://127.0.0.1:9000/json

# 或者用项目工具
node tools/cdp-inspect.js --quick
```

成功时会返回 JSON 数组，列出所有可用的调试目标（page/worker 等）。

---

## 读取流程

### 读取当前打开的对话

```
连接 CDP → 找到工作区 Target → WebSocket 连接 → 执行 JS 提取 #conversation DOM
```

**限制**: 由于虚拟滚动 (virtual scrolling)，DOM 中只渲染当前视口附近的消息。长对话只能读到部分内容。

### 读取历史对话

```
连接 CDP → 点击 History 按钮 → 选择目标对话 → 等待加载 → 提取 DOM
```

关键 DOM 选择器：
- History 按钮: `[data-tooltip-id="history-tooltip"]`
- 历史对话列表弹窗: `.jetski-fast-pick`
- 对话项: `.cursor-pointer.flex.items-center.justify-between`

---

## 关键 DOM 选择器

| 元素 | 选择器 |
|------|--------|
| Chat 面板 | `.antigravity-agent-side-panel` |
| 对话容器 | `#conversation` |
| AI 回复文本 | `.leading-relaxed.select-text` |
| AI 回复 turn 容器 | `[class*="space-y-2"]` |
| 输入框 | `.antigravity-agent-side-panel div[role="textbox"][contenteditable="true"]` |
| 新建对话按钮 | `[data-tooltip-id="new-conversation-tooltip"]` |
| 历史按钮 | `[data-tooltip-id="history-tooltip"]` |
| 历史弹窗 | `.jetski-fast-pick` |
| 正在生成检测 | `button[aria-label*="stop" i]`, `.animate-spin` 等 |

## AI 回复结构

```
#conversation
  └─ [turn] (每个 turn 是一组对话)
       ├─ 用户消息: 简单文本块
       └─ AI 回复: .space-y-2 容器
            ├─ "Thought for Xs" — 思考过程（可折叠）
            ├─ 工具调用 — 以 Created/Edited/Analyzed/Ran command/Read/Searched/Listed 开头
            └─ .leading-relaxed.select-text — 正式回复文本
```

---

## 失败诊断清单

| 症状 | 原因 | 解决 |
|------|------|------|
| `ECONNREFUSED 127.0.0.1:9000` | IDE 未运行 或 未开启 CDP 端口 | 用 `--remote-debugging-port=9000` 启动 IDE |
| CDP 连接成功但 `#conversation` 不存在 | Chat 面板未打开 | 在 IDE 中打开 Chat 面板 |
| `#conversation` 存在但 children=0 | 没有活跃对话 | 发送消息或切换到历史对话 |
| 消息数量少于预期 | 虚拟滚动，只渲染可见区域 | 需要编程滚动来加载全部消息 |
| `httpGet` 返回解析错误 | `httpGet` 已内置 JSON 解析，不需要再 `JSON.parse` | 直接使用返回值 |
