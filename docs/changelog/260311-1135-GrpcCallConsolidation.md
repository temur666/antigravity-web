# gRPC 调用收编到 Controller

## 模块
- `lib/core/controller.js`
- `main.js`

## 改动内容

将 main.js 中 4 处直接调用 `grpcCall` 的散落逻辑收编到 Controller 内部:

| Controller 新方法 | 收编的 gRPC RPC | 原 main.js 行号 |
|---|---|---|
| `getUserStatus()` | `GetUserStatus` | L220 |
| `deleteConversation(cascadeId)` | `DeleteCascadeTrajectory` | L474 |
| `exportMarkdown(cascadeId)` | `ConvertTrajectoryToMarkdown` (链式) | L500 |
| `approveStep(cascadeId, stepIndex)` | `HandleCascadeUserInteraction` | L530 |

## 设计决策

- 4 个方法直接加到 Controller，不引入新的 Service 层 (奥卡姆剃刀)
- Controller 通过 `this._lsManager.grpcCallPrimary()` / `grpcCallRouted()` 调用 gRPC
- SSE 退订逻辑留在 main.js 路由层，因为 `sseClientMap` 是路由层的关注点
- `deleteConversation` 同时清理 SQLite 索引和内存对话状态
- `exportMarkdown` 实现 LS 优先 + archive 降级
- main.js 不再需要 import `grpcCall`
