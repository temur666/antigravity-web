# InputBox 拖拽移动 + 底部吸附

## 修改模块

### 新增: `src/hooks/useDraggable.ts`
- 封装拖拽逻辑的自定义 hook
- 基于原生 Pointer Events，零依赖
- 状态机: snapped → dragging → floating / animatingSnap → snapped
- 底部 120px 阈值吸附判定
- 双击紧凑形态可回位

### 修改: `src/components/ChatPanel/InputBox.tsx`
- 集成 `useDraggable` hook
- 添加顶部 grip bar 拖拽手柄
- 根据 `isCompact` 状态切换紧凑/完整模式渲染
- 紧凑模式: 60x72 圆角矩形，显示 MessageSquare 图标
- 有未发送文字时显示绿色小圆点提示

### 修改: `src/index.css`
- `.input-box-grip` / `.input-box-grip-bar`: 拖拽手柄样式
- `.input-box-compact`: 紧凑浮动状态
- `.input-box-dragging`: 拖拽中状态
- `.input-box-animating`: 吸附回弹过渡动画 (250ms ease-out)
