# RunCommand / CommandStatus 数据字段修复

## 修改模块
- `frontend/src/types/step.ts`
- `frontend/src/components/ChatPanel/steps/RunCommandStep.tsx`
- `frontend/src/components/ChatPanel/steps/CommandStatusStep.tsx`
- `frontend/src/components/ChatPanel/steps/PlannerResponseStep.tsx`
- `frontend/src/index.css`

## 修改内容

### 1. 解决 ToolCall 重复渲染问题
- 在 PlannerResponseStep 中新增 `TOOLS_WITH_DEDICATED_STEP` 白名单
- 已有专属 Step UI 的工具（run_command, view_file 等 12 种）不再在 PlannerResponse 中重复展示 JSON 参数

### 2. 修正 LS 字段映射
通过探针脚本（probe-command-status.js）发现前端类型定义与 LS 真实字段不匹配：
- **RunCommandPayload**: 新增 `commandLine`, `combinedOutput`, `shouldAutoRun`, `exitCode` 等真实字段
- **CommandStatusPayload**: 用 `combined`/`delta` 替代不存在的 `output` 字段

### 3. 增强 RunCommandStep UI
- 使用正确字段名读取命令文本（commandLine）和输出（combinedOutput.full）
- 新增可折叠的 OUTPUT 区域展示命令执行结果
- 新增 exit code 状态徽章（绿色成功/红色失败）
- AutoRun 和 Wait 元信息以 Badge 形式展示

### 4. 修复 CommandStatusStep 空白问题
- 从 `cs.combined` 读取输出内容（之前错误地从 `cs.output` 读取，该字段不存在）
