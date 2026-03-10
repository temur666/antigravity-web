# 260310-0835 ArchiveMarkdown 状态残留修复

## 问题
- 用户点击某个对话后看不到标题和内容
- 经排查后端链路（LS API、WS 通信）完全正常
- 问题出在前端 `selectConversation` 在切换对话时未重置 `archiveMarkdown` 状态

## 根因
`app-store.ts` 的 `selectConversation` 函数有三条路径（缓存命中 / 无缓存 / 响应处理），
其中**缓存命中**和**无缓存初始 set**两条路径没有清理 `archiveMarkdown: null`。

如果用户从 archive 对话切到 live 对话，`archiveMarkdown` 残留为非 null，
导致 ChatPanel 继续渲染旧的 archive 内容而非实际的 steps 列表。

## 修改
- `frontend/src/store/app-store.ts`: selectConversation 的两处 set() 中加入 `archiveMarkdown: null`
- `main.js`: req_trajectory handler 增加诊断日志

## 排查过程
1. 直接 gRPC 调用 `GetCascadeTrajectory` → 两个 LS 实例均返回 43 步，正常
2. REST API `/api/conversations` → 对话在列表 index=47，有 title，正常
3. WebSocket 模拟 `req_trajectory` → 返回 43 步 source=live，正常
4. 检查 dist 构建时间 → 最新，正常
5. 代码审查发现 `archiveMarkdown` 未被重置 → 修复
