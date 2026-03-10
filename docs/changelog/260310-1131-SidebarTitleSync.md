# 260310-1131 Sidebar Title Sync

## 修改模块
- `frontend/src/store/app-store.ts`
- `frontend/src/utils/format.ts`
- `frontend/src/components/Sidebar/Sidebar.tsx`

## 修改内容

### 1. 对话标题实时同步
`selectConversation` 完成 trajectory 拉取和 subscribe 后，静默调用 `loadConversations()` 刷新侧边栏列表。
修复：点击对话后侧边栏标题不更新，需刷新页面才能显示正确标题。

### 2. formatBytes 防御性校验
`formatBytes` 增加对 `undefined`/`NaN`/负数的防御，避免显示 NaN。

### 3. 移除 sizeBytes 显示
侧边栏对话条目移除 `sizeBytes` 显示，因 LS API 和 index 数据源不提供该字段。
