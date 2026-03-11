# Phase 3: 协议 Schema 清理 -- WS → SSE + REST

## 背景
项目已从 WebSocket 迁移到 SSE + REST，但类型系统和协议定义还保留着 WS 时代的遗产。

## 改动

### 前端 `types/protocol.ts`
- 删除所有 13 个 `Req*` 接口 (ReqStatus, ReqSendMessage, ...) -- 零引用
- 删除所有 13 个 `Res*` 接口 (ResStatus, ResTrajectory, ...) -- 已被 `api-client.ts` 替代
- 删除 `ClientMessage` 联合类型 -- 零引用
- 保留并完善 `Event*` 类型 (SSE 推送事件)
- 新增 `EventBatch`, `EventYoloStatus/Round/Step/Error` 类型
- 保留所有共享数据模型 (ConversationSummary, GeneratorMetadata, etc.)

### 前端 `types/index.ts`
- 移除所有 Req*/Res*/ClientMessage 的 re-export
- 只导出 Event 类型 + 共享数据模型

### 后端 `lib/core/ws-protocol.js`
- 删除 `REQ_TYPES` / `RES_TYPES` 数组
- 删除 `parseMessage` / `makeResponse` / `makeError` 函数
- 保留实际使用的: `DEFAULT_CONFIG`, `buildSendBody`, `makeEvent`, `EVENT_TYPES`
- EVENT_TYPES 新增 YOLO 事件类型

### 删除过时测试
- `tests/ws-protocol.test.js` -- 测试已删除的 WS 函数
- `tests/e2e-realtime.test.js` -- 模拟 WS 交互的端到端测试

## 协议 SoT (Single Source of Truth)

| 协议层 | 定义位置 | 职责 |
|--------|---------|------|
| REST 请求/响应 | `api-client.ts` | 前端 REST API 的完整类型定义 |
| SSE 推送事件 | `types/protocol.ts` | Event* 类型，ServerMessage 联合类型 |
| 共享数据模型 | `types/protocol.ts` | Step, ConversationSummary, Metadata 等 |
| 后端消息构造 | `ws-protocol.js` | makeEvent, buildSendBody, DEFAULT_CONFIG |
