# 260306-1109-InputDraftAndMobileUX

## 模块
- `frontend/src/store/app-store.ts` — 全局状态
- `frontend/src/components/ChatPanel/InputBox.tsx` — 输入框
- `frontend/src/components/BottomNav/BottomNav.tsx` — 底部导航
- `frontend/src/index.css` — 样式

## 修改内容

### 1. 输入草稿缓存 (per-conversation)
- Store 新增 `draftMap: Record<string, string>` 和 `setDraft` action
- InputBox 初始化时从 store 恢复草稿，输入变化实时写回 store
- 切换 tab（chat/notes）再切回来，之前的输入内容仍然保留
- 切换不同对话时各自的草稿独立保存
- 发送成功后自动清除对应对话的草稿

### 2. 移动端输入栏间距
- 移动端 `.input-box` 的 `bottom` 值改为 `12px`，与底部导航栏保持 12px 间距

### 3. 键盘弹出隐藏导航栏
- BottomNav 通过 `window.visualViewport` 监听视口高度变化
- 视口高度缩小超过 150px（键盘弹出）时自动隐藏导航栏
- 使用 CSS `translateY(100%)` + transition 实现平滑滑出
