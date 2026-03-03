# PlannerResponse Inline Usage 增强

## 模块
- `frontend/src/components/ChatPanel/steps/PlannerResponseStep.tsx`
- `frontend/src/components/ChatPanel/MetadataPopover.tsx`
- `frontend/src/utils/metadata.ts`
- `frontend/src/index.css`

## 改动

### 1. 思考过程组件宽度
- `.thinking-block` 加 `width: 100%`，使其撑满父级而非收缩到内容宽度

### 2. 模型名映射
- 之前显示 "M26" 等内部占位符编号
- 现在通过 `store.models` 查找实际 label，再用 `shortenModelLabel()` 缩短
- 缩短规则: 去括号后缀（High→H, Low→L），去 "Claude " 前缀
- MetadataPopover 的"使用模型"也做了同样映射

### 3. tok → token
- PlannerResponse inline usage 中 `tok` 改为 `token`（完整表述）

### 4. 轮次显示
- PlannerResponse inline: 每条 AI 回复后显示 `Turn N`（当前 stepIndex 之前的 USER_INPUT 数量）
- MetadataPopover: 新增"轮次"字段，显示整个对话的 USER_INPUT 总数
- 与"模型调用次数"的区别: 轮次是用户消息数，模型调用是 AI 被调用的总次数（>=轮次）

### 5. 新增工具函数
- `shortenModelLabel()` — 将完整模型 label 缩短为 inline 短名
