# WS 自动重连

## 修改模块
- `frontend/src/store/ws-client.ts`
- `frontend/src/main.tsx`

## 改动内容
- WSClient 增加断线自动重连机制：指数退避 1s → 2s → 4s → ... → 30s
- 监听 `navigator.onLine` 事件，网络恢复时立即尝试重连（跳过退避等待）
- 主动 `disconnect()` / `destroy()` 不触发自动重连
- WS 重连后自动恢复：loadStatus + loadConversations + 重新订阅活跃对话
