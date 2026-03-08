# 260308-0307 Step 组件模板去重重构

## 模块
`frontend/src/components/ChatPanel/steps/`

## 变更内容

### 新增 3 个 Layout 组件

- `layouts/ToolBarLayout.tsx` — 工具条 + Modal 通用布局
- `layouts/FilePillLayout.tsx` — 文件 Pill + Modal 通用布局（内置 renderFilename）
- `layouts/FilePillLayout.css` — 从 ViewFileStep.css 迁入
- `layouts/CompactLayout.tsx` — 折叠/展开通用布局

### 重构 9 个 Step 组件

| 组件 | 使用的 Layout | 行数变化 |
|------|-------------|---------|
| GrepSearchStep | ToolBarLayout | 68 → 50 |
| FindStep | ToolBarLayout | 56 → 40 |
| ViewFileOutlineStep | ToolBarLayout | 66 → 48 |
| ViewCodeItemStep | ToolBarLayout | 72 → 55 |
| ViewFileStep | FilePillLayout | 81 → 40 |
| CodeActionStep | FilePillLayout | 73 → 38 |
| CommandStatusStep | CompactLayout | 36 → 30 |
| ListDirectoryStep | CompactLayout | 36 → 32 |
| SystemStep | CompactLayout | 53 → 48 |

### 删除
- `steps/ViewFileStep.css`（迁移至 `layouts/FilePillLayout.css`）

### 消除的重复
- `renderFilename()` 从 ViewFile、CodeAction 两处独立实现合并到 FilePillLayout 一处
- ToolBar + Modal 的 JSX 骨架从 4 份合并到 1 份
- useState + expand toggle 从 3 份合并到 1 份

## 未改动
- UserInputStep, PlannerResponseStep, RunCommandStep, NotifyUserStep,
  ErrorMessageStep, CheckpointStep, SearchWebStep（结构独特或太简单）
- Steps.css 未动（后续可进一步拆分）
