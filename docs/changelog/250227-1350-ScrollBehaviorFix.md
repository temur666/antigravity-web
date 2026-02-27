# 250227-1350 修复对话加载时的长滚动效果

## 模块
`frontend/src/components/ChatPanel/ChatPanel.tsx`

## 修改内容
修复切换到历史对话时，因大量 steps 一次性加载导致的长平滑滚动问题。

**根因：** `scrollIntoView({ behavior: 'smooth' })` 在批量加载大量 steps 后触发，
导致页面从顶部平滑滚动到底部，内容越多滚动时间越长。

**方案：** 利用 `loading` 状态区分两种场景：
- 批量加载完成（`loading: true → false`）→ `behavior: 'instant'`，直接跳到底部
- 实时推送新 step → `behavior: 'smooth'`，保留平滑滚动体验
