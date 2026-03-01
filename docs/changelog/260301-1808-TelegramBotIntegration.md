# 260301-1808 Telegram Bot 集成

## 修改模块

### 新增文件
- `lib/telegram/config.js` — Bot Token、用户白名单、Emoji 配置
- `lib/telegram/utils.js` — Telegram 工具函数 (ce, esc, safeEditText)
- `lib/telegram/format.js` — Step 数据 → Telegram HTML 格式化
- `lib/telegram/bot.js` — Bot 入口 + 命令注册 + 消息处理

### 修改文件
- `main.js` — 集成 startBot(controller) 调用
- `package.json` — 新增 grammy 依赖

## 核心设计

### 架构
Bot 内嵌在 main.js 同一进程，共享 Controller 实例。
通过 MockWs 适配器 subscribe 到 Controller，像另一个 WebSocket 客户端一样接收事件。

### 对话持久化
当前 cascadeId 写入 `data/tg-state.json`，Bot 重启后自动恢复。
`/open` 和 `/new` 命令会更新此文件。

### 格式化
v2 的数据源是 gRPC trajectory 的 step 数组（非 DOM HTML）。
format.js 完全重写，按 StepType 分别格式化为 Telegram HTML 子集。

### 命令
发文字/图片、/chats、/open、/new、/read、/readall、/screenshot、/status、/reconnect、/newfeature
