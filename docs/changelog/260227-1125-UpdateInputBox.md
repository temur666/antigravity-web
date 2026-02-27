# 260227-1125-UpdateInputBox

## 修改模块
前端组件 - `ChatPanel/InputBox` & `index.css` & `App.tsx`

## 修改详情
1. **重构 InputBox**:
   - 加入了 `lucide-react` 现代化的图标组（`Settings`, `Mic`, `ArrowRight`）。
   - `textarea` 实现了基于内容的自适应高度缩放（随文本换行自动适应增高）。
   - 将原有位于全局页面的配置 (`ConfigPanel`) 移至输入框左侧按钮的“弹出式菜单 (Popover)”展示。
   - 发送按钮激活时为蓝色圆形。
2. **样式全面更新 (`index.css`)**:
   - 移除输入栏焦点四周的发光（Cyan border/shadow）效果。
   - 将弹窗交互全面下沉式底部控制（即完全贴边 `bottom: 0; padding: 0`）。
3. **App 布局清洗**:
   - 从 `App.tsx` 中卸载了独立的 `ConfigPanel` 布局。

## 测试与校验 (TDD & Build)
- 新增 `src/components/ChatPanel/__tests__/InputBox.test.tsx` 并涵盖以下断言：
  - 核心组件完整渲染与定位。
  - Popover 弹出式菜单交互验证。
  - 触发消息投递的行为。
  - 多行自动撑起 Textarea 高度逻辑。
- **校验状态**: Lint (0 warning/error), Build 成功。
