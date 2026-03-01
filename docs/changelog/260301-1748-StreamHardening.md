# 流式更新链路加固

## 改动模块

### 1. lib/core/controller.js
- ConversationState 新增 `nextSeq` 和 `eventBuffer` 字段
- `_broadcast` 改为 `_broadcastWithSeq`：每个事件分配递增 seq，缓存到环形缓冲区（最多 200 条）
- `subscribe(cascadeId, ws, lastSeq)` 支持 lastSeq 参数：如果客户端提供了 lastSeq，自动发送缓冲区中比它新的事件（`events_batch`）
- 新增 `getCurrentSeq(cascadeId)` 方法
- 删除所有诊断 console.log

### 2. lib/core/stream-client.js
- 新增 `_lastActivity` Map: 记录每个流最后收到数据的时间
- 新增心跳检测：每 15s 检查一次，超过 60s 无数据的流视为僵死，自动销毁并 emit 'disconnected' 触发重连
- 删除所有诊断 console.log

### 3. main.js
- `res_trajectory` 响应新增 `seq` 字段
- `req_subscribe` 透传 `lastSeq` 给 controller
- `res_subscribe` 响应新增 `seq` 字段
- `req_send_message` 透传 `lastSeq`

### 4. frontend/src/store/app-store.ts
- AppState 新增 `lastSeq` 字段
- `event_step_added` 改为按 `stepIndex` 定位，而不是盲目 append（杜绝重复 step）
- 所有事件处理更新 `lastSeq`（来自服务端事件中的 seq 字段）
- `selectConversation` 从 `res_trajectory` 中保存 seq，并在 `req_subscribe` 时发送 lastSeq
- 新增 `events_batch` 处理：断线重连时接收服务端缓冲区的批量事件
- 删除所有诊断 console.log
