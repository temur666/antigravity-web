# 260307-0856 阅读模式 (Reading Mode)

## 新增功能

### 阅读模式 (ChatPanel)
点击聊天消息区空白处进入/退出阅读模式，隐藏所有浮动 UI（Header、InputBox、BottomNav），提供沉浸式阅读体验。

### 粘性气泡 (StickyBubble)
阅读模式下顶部浮动显示当前回合的用户问题，最多两行，随滚动自动切换内容。使用 IntersectionObserver 实现零性能开销的位置追踪。

### 对话导航 (TurnNav)
- 桌面端：右侧边缘圆点导航，hover 显示预览文字，点击跳转
- 移动端：右上角浮动按钮，点击弹出目录 Modal

### 动森弹性动效
所有组件的出现/消失动画使用 Animal Crossing 风格的弹性曲线：
- 出现：`cubic-bezier(0.34, 1.56, 0.64, 1)` 350ms（弹入回弹）
- 消失：`cubic-bezier(0.5, 0, 0.75, 0)` 200ms（干脆退出）

## 修改文件

| 文件 | 变更 |
|------|------|
| `store/app-store.ts` | 新增 `readingMode` 状态和 `toggleReadingMode` action |
| `App.tsx` | 添加 `data-reading-mode` 属性 |
| `ChatPanel.tsx` | 点击切换、组件集成、键盘退出 |
| `StickyBubble.tsx` + `.css` | 新建 — 粘性气泡组件 |
| `TurnNav.tsx` + `.css` | 新建 — 右侧导航组件 |
| `index.css` | 动森弹性曲线 CSS 变量 |
| `Header.css` | 阅读模式隐藏规则 |
| `InputBox.css` | 阅读模式隐藏规则 |
| `BottomNav.css` | 阅读模式隐藏规则 |
