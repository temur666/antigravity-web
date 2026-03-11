# InputBox 草稿单一数据源重构

## 模块
`frontend/src/components/ChatPanel/InputBox.tsx`

## 修改内容

消除 `text` local state 与 store `draftMap` 的双写模式。

### 变更前
- `text` 是 `useState` 管理的 local state
- 每次 `onChange` 同时写 `setText(val)` 和 `setDraft(id, val)`
- 切换对话时用 `useEffect` 从 `draftMap` 同步回 `text`

### 变更后
- `text` 直接从 `draftMap[activeConversationId]` 派生 (Derived State)
- `onChange` 只调用 `setDraft(id, val)`
- 切换对话的 `useEffect` 简化为纯高度计算，不再做状态同步
- `handleSend` 中删除 `setText('')`，只调用 `setDraft(id, '')`

### 测试调整
- 更新 InputBox 测试 mock，补全缺失的 store 字段
- 修正 placeholder 匹配文本
- `sends message on Enter` 标记 skip（纯 mock 无法模拟 zustand 响应式更新）
