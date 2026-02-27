# 250227-1422 Move Selectors to Input Box

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`
- `frontend/src/components/Header/ModeSelector.tsx`
- `frontend/src/components/Header/ModelSelector.tsx`
- `frontend/src/App.tsx`
- `frontend/src/index.css`

## 修改内容

### 1. 移除 Header 上的 Selectors
- 从 `App.tsx` 中删除了 `ModeSelector` 和 `ModelSelector` 的引入和渲染。

### 2. 重构 InputBox 布局 
- 将 `InputBox.tsx` 的单行水平布局改为多行垂直布局：
  - 上方显示自适应高度多行输入区 `textarea`
  - 下方功能区 (`input-bottom-bar`) 分为两列
  - 左侧：功能增加图标 (`Plus`), `ModeSelector`, `ModelSelector`
  - 右侧：语音 (`Mic`), 发送 (`ArrowRight`) Buttons
- 使用现代化的圆角按钮样式设计 (`input-circle-btn`) 替代旧的 action button

### 3. 选择器下拉调整方向
- 为适配输入框在应用底部，修改了 `ModeSelector` 和 `ModelSelector`
- 图标由向下箭头 (`ChevronDown`) 改为向上箭头 (`ChevronUp`)
- `CSS` 中所有 `.header-dropdown-*` 类改为 `.input-dropdown-*` 
- 修改 `CSS` 使用新的 `bottom: calc(100% + 12px)` 将菜单往上弹开而不是往下弹。 
