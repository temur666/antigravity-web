# ConversationTags - 输入框对话标签快速切换

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`
- `frontend/src/components/ChatPanel/InputBox.css`

## 功能描述
在输入框区域增加对话标签（Conversation Tags）功能，支持快速切换最近 5 条对话。

### 交互逻辑
1. 输入框左侧新增圆形切换按钮（MessagesSquare 图标）
2. 点击按钮 → 输入框上方展开对话标签栏（从左到右动画）
3. 再次点击 → 收起标签栏
4. 用户开始输入文字时 → 按钮被输入框挤压消失（squeeze 动画）
5. 文字清空后 → 按钮恢复显示

### 标签样式
- 药丸（Pill）形态，显示对话标题（截断 12 字符）
- 当前活跃对话高亮（更亮的背景 + 边框）
- 正在运行的对话显示绿色脉冲圆点 + 绿色边框

### CSS 结构变更
- 新增 `.input-row-wrapper` 包裹切换按钮和输入框主体
- `.input-box-inner-row` 从独立居中改为 `flex: 1` 填充
- 浮动模式下自动隐藏标签和切换按钮
