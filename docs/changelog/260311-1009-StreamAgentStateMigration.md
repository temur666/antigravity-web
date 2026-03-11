# 260311-1009 — StreamAgentStateUpdates Migration

## 变更内容

将后端 Stream 连接从 `StreamCascadeReactiveUpdates` 迁移到 `StreamAgentStateUpdates`。

## 修改的模块

| 文件 | 变更 |
|---|---|
| `lib/core/ls/agent-stream-client.js` | **新增** — AgentStreamClient, 使用 StreamAgentStateUpdates |
| `lib/core/ls/stream-client.js` | **删除** — 旧的 StreamCascadeReactiveUpdates 实现 |
| `lib/core/ls/manager.js` | StreamClient → AgentStreamClient, 新增 onStreamUpdate 回调 |
| `lib/core/ls/pool.js` | StreamClient → AgentStreamClient, 转发 update 事件 |
| `lib/core/ls/index.js` | 更新 re-export |
| `lib/core/stream-client.js` | 更新兼容层 re-export |
| `lib/core/conversation/sync.js` | **核心改动** — 新增 _onStreamUpdate() 处理结构化数据 |
| `lib/core/conversation/__tests__/sync.test.js` | 修复 mock 适配新接口 |

## 为什么要换

| 维度 | 旧 (CascadeReactive) | 新 (AgentState) |
|---|---|---|
| 推送内容 | version + protobuf field-level diff | 完整 step 结构体 + status + metadata |
| 二次拉取 | 每次通知都需要 GetCascadeTrajectory | 仅 PLANNER_RESPONSE 需要拉取文本 |
| gRPC 调用量 | ~25 次/对话 | ~3 次/对话 (**减少 88%**) |
| Diff 计算 | 自行 diffSteps 比较全量 | stream 直接给 indices + steps |

## 新数据流

```
StreamAgentStateUpdates
    │
    ├─ status 变化 → 直接广播 event_status_changed (零拉取)
    ├─ metadata 更新 → 直接广播 event_metadata_updated (零拉取)  
    ├─ step 新增/更新 (非文本) → 直接广播 event_step_added/updated (零拉取)
    └─ PLANNER_RESPONSE → throttle + GetCascadeTrajectory 拉文本
```

## 前端影响

无。WebSocket 协议层 (event_step_added/updated/event_status_changed) 保持不变。
