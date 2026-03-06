# Mobile Input Compact Mode

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`
- `frontend/src/index.css`

## 修改内容

### 设计理念
移动端输入栏始终是一个紧凑的条。高度完全由文字内容驱动：
- 无文字 / 一行文字 → 窄条，不增加高度
- 多行文字 → 高度随行数增长
- max-height: 120px 防止撑满屏幕

### InputBox.tsx
- 移除 `isFocused` 状态、`blurTimeoutRef`、`handleFocus`/`handleBlur` 回调
- 移除 `isCollapsed` 逻辑和 `input-box-collapsed` class
- 移除重复的 `.input-inline-send` 按钮和 `.input-textarea-row` 包裹层
- textarea 恢复为直接子元素，只保留一个发送按钮（底部工具栏中的）

### index.css
- 移除 `.input-textarea-row` / `.input-inline-send` 全局样式
- 移除所有 `.input-box-collapsed` 相关规则
- 移动端 `.input-box-grip` 隐藏（display: none）
- 移动端 `.input-box-inner-vertical` 紧凑 margin/padding（6px 12px / 8px 12px）
- 移动端 `.input-textarea-vertical`：min-height: 20px, margin-bottom: 4px, max-height: 120px
