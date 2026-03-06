# 修复前端打开时卡在旧会话的问题

## 模块
- `frontend/src/store/app-store.ts`
- `frontend/src/components/ChatPanel/ChatPanel.tsx`

## 问题
`localStorage` 持久化了一个无效的 `activeConversationId`，导致每次打开前端都自动尝试加载该会话。
`selectConversation` 加载轨迹超时后，只设置了 `error` 状态，但没有清除 `activeConversationId`，
导致刷新后依然尝试加载同一个死 ID，形成无限循环。

## 修复
1. **`selectConversation` 失败时清除死 ID**：超时或错误时，清除 `localStorage` 和 state 中的 `activeConversationId`，并提前 return 不再订阅
2. **LS 恢复连接时包裹 catch**：持久化 ID 的 `selectConversation` 调用加 `.catch()` 保护，失败自动清除
3. **ChatPanel 加载失败显示"返回首页"按钮**：用户即使遇到加载失败，也能手动退出
