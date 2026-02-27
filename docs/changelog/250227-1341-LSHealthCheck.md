# LS 健康检查 + 自动重连

## 修改模块
- `lib/core/ls-discovery.js` -- 改进 discoverFromProcess
- `lib/core/controller.js` -- 添加健康检查循环
- `server.js` -- 广播 LS 状态变化
- `frontend/src/store/app-store.ts` -- LS 恢复后自动刷新数据

## 问题
LS 崩溃重启后，server.js 仍持有旧的 port/csrf，所有 gRPC 调用失败，前端空白。
且 discovery file 指向已死的旧进程，discoverFromProcess 的 `.pop()` 在多进程下不可靠。

## 改动详情

### ls-discovery.js -- 多进程选择策略
**之前**: `.pop()` 取 ps 结果最后一行，随机性强
**之后**: 解析所有候选进程，优先选有 `--server_port` 的（extension host 启动），否则取 PID 最大的

### controller.js -- 30s 心跳健康检查
- `_doHealthCheck()`: 每 30s 向 LS 发送 Heartbeat
- 心跳失败: emit `ls_disconnected` → 置空 LS → 立即调用 `refreshLS()` 重连
- `refreshLS()` 增强: 验证 Heartbeat → 重建 StreamClient → 重新订阅所有活跃对话 → emit `ls_reconnected`

### server.js -- 广播 LS 状态
- 监听 `ls_disconnected` / `ls_reconnected`，广播 `event_ls_status` 给所有 WS 客户端

### app-store.ts -- 前端自动恢复
- `event_ls_status` handler 中，检测 `!wasConnected && event.connected`
- 自动调用 `loadConversations()` + `loadStatus()` + 恢复当前对话
