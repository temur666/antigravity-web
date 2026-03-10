# 260310-1238 — 孤儿对话恢复机制 (LoadTrajectory)

## 修改模块

- `lib/core/ls/pool.js` — LSPool
- `lib/core/conversation/state.js` — ConversationStore

## 修改内容

### 问题
多 LS 环境下，67 个"孤儿对话"（.pb 文件存在但无 LS 认领）点击后显示为空。
根因：LS 的对话索引是纯内存维护的，进程退出后丢失，`GetCascadeTrajectory` 对未索引的 cascadeId 直接返回 `trajectory not found`。

### 解决方案
利用 `LoadTrajectory` RPC 让 LS 从磁盘 .pb 文件重新加载对话到内存索引。

### 具体改动

1. **`LSPool.loadTrajectory(cascadeId)`** — 新增方法，在 primary LS 上调用 `LoadTrajectory` RPC，成功后更新路由表

2. **`ConversationStore.getTrajectory`** — 当 LS 返回空 trajectory 时，自动检查 .pb 文件是否存在，若存在则调用 `LoadTrajectory` 恢复后重试 `GetCascadeTrajectory`

3. **`ConversationStore.listConversations`** — .pb 扫描阶段发现孤儿后，批量调用 `LoadTrajectory` 预加载，然后回填 title/stepCount 等元数据

## 参考
- `docs/findings/260310-load-trajectory-orphan-recovery.md`
