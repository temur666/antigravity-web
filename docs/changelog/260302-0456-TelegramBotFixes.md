# Telegram Bot UX 优化与 Bug 修复

## 背景
此前在 Telegram 机器人的核心代码 `bot.js` 中存在多个影响稳定性和用户体验的问题：
1. **流式反馈卡死**：向用户私聊发送消息时使用并不存在的 API 方法 `sendMessageDraft`，导致前端假死。
2. **磁盘泄漏风险**：收到的多媒体文件在上传传递给 LS（语言服务）之后，没有进行 `unlink` 清理，导致持续积累临时图片挤占服务器的存储空间。
3. **缺少排队提示**：并发发送多个指令或任务后无法直观知道任务队列的情况，机器人显得仿佛失去响应。
4. **全局会话对象冲突（Race Condition）**：机器人的 `botState.currentCascadeId` 缺少 `chat_id` 的隔离，使得当用群聊或 Topic 和机器人沟通时，另一边的私聊也会强行切换当前使用的 CascadeId。

## 变更明细
* [x] **修复 (Bug Fix)**：重构了 `sendAndStream` 函数。去掉了 `useDraft` 判断降级分支，统一使用通用的 `safeEditText` 进行信息流编辑和展示。
* [x] **修复 (Storage Optimization)**：在 `sendAndStream` 结尾的 `finally` 添加了遍历 `extras.media` 和安全清除本地对应 `file://` 缓存在临时目录下文件的系统清道夫功能。
* [x] **增强 (UX)**：增强排队响应体验，如果判定系统正在处理先前的指令且 `isProcessing` 激活时，追加告知等待队列深度的贴心信息。
* [x] **重构 (Feature Add/Refactor)**：重写 `botState` 及 `saveState` 记录逻辑。提取了新方法 `getChatKey()` 统一化提取上下文状态和根据 `chat_id_Thread_id` 区分持久化的 `CascadeId`。使得用户私信、多群聊共存互不干涉。
