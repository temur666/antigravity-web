# InputBox 拖拽改为可交互浮动面板

## 变更说明

将拖拽出来的缩略图模式改为 280px 宽的可交互浮动面板。
面板保持完整的输入、发送、配置功能，不再有模式切换。

## 修改模块

### 修改: `src/hooks/useDraggable.ts`
- `COMPACT_W/H (60x72)` → `FLOATING_W (280)`
- `isCompact` → `isFloating`
- 调整拖拽偏移和吸附目标坐标适配更大面板

### 修改: `src/components/ChatPanel/InputBox.tsx`
- 移除 `MessageSquare` 图标和缩略图条件渲染
- 始终渲染完整输入框（textarea + 底部功能栏）
- `onDoubleClick` 移到 grip bar 上（避免输入时误触）
- `input-box-compact` → `input-box-floating`

### 修改: `src/index.css`
- 移除所有 `.input-box-compact*` 缩略图相关样式
- 新增 `.input-box-floating` 浮动面板样式（圆角、阴影、去除内层边框）
- `.input-box` 添加 `container-type: inline-size` 启用容器查询
- 新增 `@container (max-width: 400px)` 响应式双行布局：
  - 上行：语音 + 发送按钮（order: 1, 右对齐）
  - 下行：配置按钮组（order: 2）
- 该布局在拖拽浮动（280px）和浏览器窗口变窄时均自动触发
