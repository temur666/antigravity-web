# 260306-0901 修复前端加载卡死 Bug

## 修改模块
`frontend/src/store/app-store.ts`

## 修复内容

### BUG-1: trajectory 请求超时导致大型对话加载永久卡死
- `req_trajectory` 超时从默认 10s 增大到 30s
- `req_subscribe` 超时从默认 10s 增大到 15s
- 在 `sendAndWait` 返回后增加竞态检查：如果用户在等待期间已切换到其他对话，丢弃本次结果

### BUG-2: localStorage 死 ID + event_ls_status 重入导致启动卡循环
- 增加 `isRestoringConversation` 防重入锁
- 场景 A 和场景 C 中，`selectConversation` 仅在锁未被占用时才调用
- `.finally()` 确保锁在成功/失败后都能释放
