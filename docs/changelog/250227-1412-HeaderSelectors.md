# 250227-1412 Header Mode & Model Selector

## 修改模块
- `frontend/src/types/config.ts`
- `frontend/src/components/Header/ModeSelector.tsx` (新建)
- `frontend/src/components/Header/ModelSelector.tsx` (新建)
- `frontend/src/App.tsx`
- `frontend/src/index.css`

## 修改内容

### 1. 修正 agenticMode 语义
- `agenticMode: true` = **Planning** (Agentic, 先规划后执行)
- `agenticMode: false` = **Fast** (直接执行)
- 更新了 CONFIG_META 中的描述

### 2. Header 新增 Mode Selector
- 下拉菜单显示 Fast / Planning 两个选项
- 每个选项含中文描述
- 选择后通过 `setConfig({ agenticMode })` 同步到后端

### 3. Header 新增 Model Selector
- 动态从 `store.models` 获取可用模型列表
- 显示模型标签和 quota 进度条
- LS 未连接时显示 fallback 提示

### 4. CSS
- 通用 `.header-dropdown` 样式系统 (trigger + menu + option)
- 暗色主题，与现有设计系统一致
- 响应式移动端适配
