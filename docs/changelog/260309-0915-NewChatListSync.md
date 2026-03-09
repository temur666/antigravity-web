# NewChat 对话列表同步修复

## 模块
`store/app-store.ts` — `newChat` action

## 问题
创建新对话后，侧边栏对话列表和 InputBox 标签栏不显示新对话。
根因：`newChat()` 只调用了 `selectConversation()` 跳转，未更新 `conversations` 数组。

## 修复
采用 Optimistic Update + Background Sync：
1. 创建成功后立即插入占位 `ConversationSummary`（去重保护）
2. `selectConversation` 完成后，后台静默 `loadConversations()` 同步服务端完整数据
