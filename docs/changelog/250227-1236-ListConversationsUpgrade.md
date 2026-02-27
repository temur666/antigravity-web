# 对话列表数据源升级 + API 探测

## 修改模块
- `lib/core/controller.js` — `listConversations()` 方法重写
- `server.js` — `req_trajectory` 处理逻辑增强 + 导入清理
- `docs/api-reference.md` — 补充 4 个新发现的 API 文档

## 改动详情

### controller.js — listConversations 数据源优先级
**之前**: SQLite → .pb 文件扫描  
**之后**: LS API (GetAllCascadeTrajectories) → .pb 文件补充 → SQLite fallback

- 优先调 `GetAllCascadeTrajectories` 获取 LS 已知对话的完整元数据（标题、状态、步骤数、工作区等）
- .pb 文件扫描补充 LS 内存中没有的更旧历史对话
- SQLite 作为最末端 fallback 补充标题

### server.js — trajectory 兜底
- 当 `GetCascadeTrajectory` 返回 `trajectory not found`（历史对话），尝试从 `GetAllCascadeTrajectories` 获取 status 兜底
- 避免前端显示 UNKNOWN

### API 探测
新发现 4 个有效 gRPC 方法（详见探测报告）：
- `GetAllCascadeTrajectories` — 对话列表 + 标题
- `DeleteCascadeTrajectory` — 删除对话
- `AcceptTermsOfService`
- `RecordEvent`
