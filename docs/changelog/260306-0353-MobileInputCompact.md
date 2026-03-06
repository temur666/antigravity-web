# Mobile Input Compact Mode

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`
- `frontend/src/index.css`

## 修改内容

### InputBox.tsx
- 新增 `isFocused` 状态 + `blurTimeoutRef`（150ms 延迟防止点击工具栏按钮时误收起）
- 计算 `isCollapsed`：未聚焦 + 无文字 + 无附件 + 配置面板未打开 → 折叠态
- 折叠态添加 CSS class `input-box-collapsed`
- textarea 包裹在 `.input-textarea-row` 中，内含一个 `.input-inline-send` 按钮
- textarea 添加 `onFocus` / `onBlur` 事件

### index.css
- 全局：`.input-textarea-row` 使用 `display: contents` 对桌面端零影响
- 全局：`.input-inline-send` 默认隐藏
- 移动端：隐藏 `.input-box-grip`（拖拽手柄）
- 移动端：`.input-box-inner-vertical` 减少 margin / padding
- 移动端折叠态：
  - 内容器切换 `flex-direction: row`，pill 形圆角 (24px)
  - textarea 单行高度 (min-height: 20px)
  - 显示内联发送按钮 (32x32)
  - 隐藏完整工具栏 (`.input-bottom-bar`)
  - 聚焦或输入文字后自动展开为完整布局
