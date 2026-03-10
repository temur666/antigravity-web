# Fix: YOLO autoReply 前端完整性修复

## 修改模块

### 后端 `main.js`
- 新增 `req_approve_step` WS 端点，调用 LS 的 `HandleCascadeUserInteraction` gRPC 实现自动批准

### 前端 `types/protocol.ts`
- 新增 `ReqApproveStep` / `ResApproveStep` 类型定义
- 更新 `ClientMessage` / `ServerMessage` 联合类型

### 前端 `store/app-store.ts`
- **Bug 1 修复**: 新增 `autoApproveIfWaiting()` 函数，在 `event_step_added` / `event_step_updated` 时检测 WAITING 状态的 `RUN_COMMAND` step，自动发送 `req_approve_step`
- **Bug 2 修复**: `autoReply` 持久化到 `localStorage`，页面刷新后恢复
- **Bug 3 说明**: 后端 WS YoloEngine (`req_yolo_start`) 保留用于 CLI/Telegram 接入，前端 autoReply 作为轻量级方案独立运行，不再视为架构割裂
- **Bug 4 说明**: autoReply 仍然绑定 activeConversationId，这是设计决策而非 bug（切换对话时自然暂停自动回复）
- **Bug 5/6**: 标记文件和冷却时间配置化属于增强项，后续按需添加
- **Bug 7 确认**: 状态字符串已在 sync.js 中 strip 前缀，前端判断 `'IDLE'` 正确

## 安全限制
- `autoApproveIfWaiting` 仅批准 `CORTEX_STEP_TYPE_RUN_COMMAND` 类型的 step
- 其他 WAITING 类型（如 NOTIFY_USER）不自动批准，需手动确认
