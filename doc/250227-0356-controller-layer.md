# 250227-0356 Controller 层实现

## 概述

在 `antigravity-web` 项目中新增 Controller 层，通过 gRPC API 直接与 Language Server 通信，
替代原有的 CDP DOM 操控方案。支持 WebSocket v2 协议的实时对话管理、轮询引擎、增量推送。

## 修改的模块

### 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `lib/ls-discovery.js` | ~155 | LS 发现 (discovery file + 进程 fallback) + gRPC 调用封装 |
| `lib/ws-protocol.js` | ~170 | WebSocket v2 协议定义 (消息类型、构造器、配置) |
| `lib/controller.js` | ~460 | 核心 Controller (状态管理、轮询引擎、Diff 引擎、事件广播) |
| `tests/ls-discovery.test.js` | ~170 | ls-discovery 单元测试 + 集成测试 |
| `tests/ws-protocol.test.js` | ~150 | ws-protocol 单元测试 |
| `tests/controller.test.js` | ~200 | controller 单元测试 + 集成测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server.js` | 重写：v2 Controller 路由 (req_*) + v1 CDP 兼容 |

## 架构

```
客户端 (curl/WS)
      │
      ▼
server.js ─── req_* ──→ controller.js ──→ ls-discovery.js ──→ LS gRPC API
    │                        │
    │  v1 兼容               ├── 轮询引擎 (自适应 1~5s)
    └── CDP DOM              ├── Diff 引擎 (步骤增量)
                             └── 事件广播 (WebSocket push)
```

## WebSocket v2 协议

请求-响应:
- `req_status` → `res_status` (LS 状态 + 账户 + 模型)
- `req_conversations` → `res_conversations` (对话列表)
- `req_trajectory` → `res_trajectory` (完整对话内容)
- `req_new_chat` → `res_new_chat` (创建对话)
- `req_send_message` → `res_send_message` (发送消息 + 自动订阅)
- `req_subscribe / req_unsubscribe` → `res_subscribe`
- `req_set_config / req_get_config` → `res_config`

事件推送:
- `event_step_added` (新增步骤)
- `event_step_updated` (步骤状态变化)
- `event_status_changed` (对话 RUNNING→IDLE)
- `event_ls_status` (LS 连接状态)

## 测试

```bash
# 单元测试
node tests/ls-discovery.test.js
node tests/ws-protocol.test.js
node tests/controller.test.js

# 集成测试 (需要 LS 运行)
node tests/ls-discovery.test.js --integration
node tests/controller.test.js --integration
```

总计: 43 个单元测试 + 7 个集成测试
