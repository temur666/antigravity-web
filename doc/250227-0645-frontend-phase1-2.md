# Frontend v2 — Phase 1+2: 骨架搭建 + Store 层

**日期**: 2026-02-27  
**模块**: `frontend/`  

## 变更摘要

### Phase 1: 骨架搭建

- **技术栈**: Vite 7 + React 19 + SWC + TypeScript 5.9
- **依赖**: zustand, marked, highlight.js, vitest
- **配置**:
  - `vite.config.ts`: `@/` 路径别名, dev proxy → `ws://localhost:3210`, vitest 配置
  - `tsconfig.app.json`: `baseUrl` + `paths` 别名映射

### Phase 2: Schema-First 类型 + Store 层

#### 类型定义 (`src/types/`)

| 文件 | 内容 |
|---|---|
| `protocol.ts` | WS v2 协议完整类型: 9 种请求, 8 种响应, 4 种事件 |
| `step.ts` | 13 种 Step 类型 + payload 接口 + 工具函数 (isHiddenStep, getUserInputText) |
| `config.ts` | CascadeConfig + 枚举 + DEFAULT_CONFIG + CONFIG_META (UI 渲染元数据) |
| `index.ts` | barrel export |

#### WSClient (`src/store/ws-client.ts`)

- WebSocket 连接生命周期管理 (connect/disconnect/destroy)
- JSON 消息收发 (send / sendAndWait)
- sendAndWait: 基于 reqId 匹配请求-响应 + 超时机制
- 事件分发: onMessage/offMessage/onStateChange
- 工厂函数注入 → 可测试

#### App Store (`src/store/app-store.ts`)

- zustand vanilla store
- 状态: LS 连接, 对话列表, 当前对话 steps, 配置, 账号, debugMode
- Actions: loadConversations, selectConversation, newChat, sendMessage, loadConfig, setConfig
- 事件监听: event_step_added → 追加 step, event_step_updated → 更新 step, event_status_changed → 更新状态

#### 测试 (38 个)

- `ws-client.test.ts`: 16 个 (连接管理 × 6, 消息发送 × 4, 消息接收 × 4, 状态回调, reqId 生成)
- `app-store.test.ts`: 22 个 (初始状态 × 5, LS 事件 × 2, 对话列表 × 2, 选择对话, 新建对话 × 2, 发送消息 × 2, 增量更新 × 5, 配置 × 2, Debug 模式)

## 检查结果

- ✅ TSC: 零错误
- ✅ ESLint: 零错误
- ✅ Vitest: 38/38 通过
