# InputBox: Enter/Config/Mode 清理

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`

## 修改内容

### 1. 手机端 Enter = 换行
- 桌面端保持不变: Enter 发送, Shift+Enter 换行
- 移动端 (<=768px): Enter 直接换行, 只能通过发送按钮发送
- 使用 `window.innerWidth <= 768` 判断 (与 App.tsx 的 isMobile 逻辑一致)

### 2. 移除 + 按钮和 ConfigPanel
- 从 InputBox 移除 Plus 图标导入
- 移除 `showConfigOptions` state
- 移除 ConfigPanel 组件引用和弹出层
- 输入栏左侧只保留附件按钮 (Paperclip)
- ConfigPanel 入口后续需移至 Header 右上角

### 3. 移除 ModeSelector
- 从 InputBox 移除 ModeSelector 组件引用
- 移除 `.input-selectors` 包裹层
- `agenticMode` 默认值为 `false` (Fast 模式), 已在 `types/config.ts` 的 `DEFAULT_CONFIG` 中设定
- ModeSelector 组件文件保留但不再被引用 (可后续清理)
