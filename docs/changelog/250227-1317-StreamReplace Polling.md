# 流式实时通知替代轮询

## 修改模块
- `lib/core/stream-client.js` — 新增，Connect Streaming 客户端
- `lib/core/controller.js` — 重构为流式通知驱动
- `server.js` — 简化 trajectory 处理

## 改动详情

### stream-client.js (新增)
- 使用 Connect Streaming 协议连接 LS `StreamCascadeReactiveUpdates`
- Envelope 编码/解码: flags(1B) + length(4B big-endian) + JSON
- 事件: snapshot(初始快照) / change(变更通知) / disconnected(断开)
- 支持多对话并行订阅

### controller.js — 流式通知驱动
**之前**: 500ms tick 轮询所有对话  
**之后**: 
- subscribe 时建立 LS 流式连接
- 收到 change 事件 → 100ms 防抖 → _fetchAndDiff() 拉最新数据
- pollOnce 保留为 RUNNING 状态的 fallback（流连接建立前）
- unsubscribe 时自动断开无人订阅的流

### server.js — 简化
- 移除 trajectory fallback 逻辑（GetCascadeTrajectory 能加载任何历史对话）
