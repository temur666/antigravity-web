# 前端审计修复 -- P0/P1 批次

## 修改模块

### 1. P0 -- 修复前后端 DEFAULT_CONFIG 不一致
- **文件**: `frontend/src/types/config.ts`
- **变更**: 默认模型从 `MODEL_PLACEHOLDER_M26` 改为 `MODEL_PLACEHOLDER_M37`，与后端 `lib/core/ws-protocol.js` 保持一致

### 2. P0 -- 修复 InputBox 附件列表 key
- **文件**: `frontend/src/components/ChatPanel/InputBox.tsx`
- **变更**: `key={Math.random()}` 改为 `key={att.previewUrl}`，消除不必要的 DOM 重建

### 3. P0 -- 修复语音按钮空壳
- **文件**: `frontend/src/components/ChatPanel/InputBox.tsx`
- **变更**: 语音按钮添加 `disabled` 属性和 "即将推出" 提示

### 4. P1 -- 新增对话删除功能
- **文件**: `frontend/src/types/protocol.ts`, `types/index.ts`, `store/app-store.ts`, `main.js`
- **变更**: 新增 `req_delete_conversation` WS 消息类型，后端调用 LS `DeleteCascadeTrajectory` API，Sidebar 右键菜单可删除对话

### 5. P1 -- 新增对话导出 Markdown
- **文件**: 同上
- **变更**: 新增 `req_export_markdown` WS 消息类型，后端调用 LS `ConvertTrajectoryToMarkdown` API，Sidebar 右键菜单可导出

### 6. P1 -- Sidebar 增强
- **文件**: `frontend/src/components/Sidebar/Sidebar.tsx`, `Sidebar.css`
- **变更**: 
  - 新增搜索框（300ms 防抖，利用已有 search 参数）
  - RUNNING 状态指示（脉冲动画圆点 + "运行中" 徽章 + 左边框高亮）
  - 右键菜单（删除、导出 Markdown）

### 7. 协议类型补全
- **文件**: `frontend/src/types/protocol.ts`, `types/index.ts`
- **变更**: `ConversationSummary` 新增 `account`、`hasArchive` 字段
