# 260310-1110 LSPool 多实例路由

## 背景
同一台机器上多个 LS 实例（IDE LS + Daemon LS）各自维护独立的对话索引，
导致 Controller 只连一个 LS 时，另一个 LS 创建的对话不可见/不可加载。

## 修改内容

### 新增
- `lib/core/ls/pool.js` — LSPool 连接池，管理多个 LS 实例 + 路由表
- `lib/core/ls/discovery.js` — 新增 `discoverAllLS()` 发现所有活跃 LS

### 修改
- `lib/core/controller.js` — 从 LSManager 切换到 LSPool
- `lib/core/conversation/state.js` — listConversations 并行查询所有 LS 并合并, CRUD 操作通过 Pool 路由
- `lib/core/conversation/sync.js` — subscribe/unsubscribe 路由到正确 LS 的 StreamClient

### 验证结果
- 成功发现 3 个 LS 实例 (Daemon + IDE + 第3个)
- 对话列表合并去重正常
- 跨 LS 对话加载路由正常 (c5841593 → 43 steps)
- 活跃对话(4aa092ce)trajectory 为空是 LS 行为限制，非 Pool bug
