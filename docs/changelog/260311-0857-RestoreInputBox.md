# 260311-0857-RestoreInputBox

## 修改内容
1. 将 `antigravity-web` 前端的 `ChatPanel.tsx` 里的输入组件恢复为原有的 `InputBox`
2. 移除了专为 `SimpleInputBox` 开发的回调函数 `handleSendToBackend` 以及不需要的 `useAppStore` hooks (`sendMessage`, `setDraft`)。
3. 删除了无用的 `SimpleInputBox.tsx` 和 `SimpleInputBox.css` 文件，保持代码库整洁。
4. 全量了运行 `npm run build` 和 `npm run lint`，确保 0 Warning / Error。

## 原因
上个对话中为了排查消息重复发送的 Bug 替换了简化的 `SimpleInputBox`，现在 Bug 根因已在服务端同步同步引擎（`sync.js`，竞态争用）中修复，所以这里还原最初的设计，使包含附件预览、拖拽定位等高级特性的输入框重新生效。
