# 内存级对话缓存 — 切换秒开

## 模块
- `frontend/src/store/app-store.ts`

## 改动内容

新增 `conversationCache` (Map) 实现对话数据的内存级缓存：

### 机制

1. **切走时缓存**：`selectConversation` 和 `setActiveConversation` 在切换对话时，自动将当前对话的 steps / metadata / status / lastSeq 保存到 Map
2. **切入时秒开**：`selectConversation` 优先检查 Map 缓存，命中则直接渲染，跳过服务端拉取
3. **增量同步**：缓存命中后仍重订阅 WS 事件，确保后续实时更新不丢失
4. **首次加载写缓存**：从服务端拉取 trajectory 后同步写入缓存

### 效果

- 对话 A → 切换到 B → 切换回 A：**秒开**（从缓存恢复）
- 首次加载某对话：仍从服务端拉取（缓存为空）
- 缓存生命周期：页面生命周期内有效，刷新后重新拉取
