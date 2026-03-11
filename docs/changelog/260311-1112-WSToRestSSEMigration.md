# 260311-1112 — WS to REST+SSE Migration

## 概述

将 WebSocket 通信层替换为 REST API + SSE（Server-Sent Events）架构。

## 动机

- WebSocket 的 req/res 模式是在 HTTP 之上重新实现了一套请求-响应协议（reqId 匹配、超时、重连、心跳），共 379 行代码，是历史 bug 的来源（重连 bug、消息重复 bug、心跳超时 bug）
- 实时推送需求（event_step_added/updated 等）是单向的，SSE 完全够用
- 12 个 req/res 消息类型本质上就是标准 CRUD，应当用 HTTP 表达

## 变更

### 后端 (`main.js`)

- 新增 `sseClients` Set 和 `sseAdapter(res)` 函数（包装 SSE res 为鸭子类型，与 WS 接口兼容）
- 新增 `broadcastSSE(msg)` 广播函数，所有 controller 事件（ls_disconnected、ls_reconnected）和 YOLO 事件同时向 SSE 和 WS 广播（兼容期）
- 新增 `GET /api/events/stream` SSE 端点（替代 WS 连接）
- 新增 `express.json({ limit: '50mb' })` 中间件
- 新增 REST 端点（共 11 个）：
  - `POST /api/conversations` — 新建对话
  - `GET /api/config` / `PUT /api/config` — 配置管理
  - `POST /api/yolo/start` / `POST /api/yolo/stop` / `GET /api/yolo/status`
  - `POST /api/conversations/:id/messages` — 发送消息
  - `POST /api/conversations/:id/subscribe` / `unsubscribe`
  - `POST /api/conversations/:id/cancel`
  - `DELETE /api/conversations/:id`
  - `GET /api/conversations/:id/export`
  - `POST /api/conversations/:id/approve-step`
- `GET /api/status` 从同步改为 async（含 GetUserStatus 调用）
- WS 代码暂时保留，待阶段三清理

### 后端 (`lib/core/conversation/sync.js`)

- `_broadcastWithSeq` 和 `subscribe` 中的 `ws.readyState === 1` 改为通用接口：`typeof ws.isOpen === 'function' ? ws.isOpen() : ws.readyState === 1`
- 使 SSE adapter 和原有 WS 对象都能被正确处理

### 前端 — 新建文件

- `frontend/src/store/api-client.ts`：封装所有 REST API 调用（~200 行），替代 wsClient.sendAndWait
- `frontend/src/store/sse-client.ts`：SSE 客户端（~160 行），替代 ws-client.ts（379 行）；利用浏览器原生 EventSource 自动重连能力；保留 nextReqId() 接口兼容

### 前端 — 修改文件

- `frontend/src/store/app-store.ts`：
  - `createAppStore(wsClient)` → `createAppStore(sseClient)`
  - 所有 `wsClient.sendAndWait({type:'req_*'})` → 对应 `api.*()` 调用（共 12 处）
  - 所有 `wsClient.send({type:'req_subscribe'})` → `api.subscribe()`
  - `autoApproveIfWaiting` 中的 `wsClient.send` → `api.approveStep()`
  - `wsClient.onMessage` → `sseClient.onMessage`（接口相同）
- `frontend/src/main.tsx`：`WSClient` → `SSEClient`，`wsClient.connect()` → `sseClient.connect()`
- `frontend/src/store/index.ts`：新增 SSEClient 和 api 导出

## 待办（阶段三）

- 删除 `frontend/src/store/ws-client.ts`
- 删除 `main.js` 中的 WS server 相关代码
- 更新 `app-store.test.ts`（当前 Mock WSClient → Mock SSEClient + fetch mock）
