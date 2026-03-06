# Metadata 最新轮次 + Header 设置按钮

## 修改模块
- `frontend/src/components/ChatPanel/MetadataPopover.tsx`
- `frontend/src/App.tsx`
- `frontend/src/index.css`

## 修改内容

### MetadataPopover — 显示最新一轮调用数据
- 不再使用 `buildConversationUsageSummary` 累加所有调用
- 从 `metadata` 数组末尾取最新一条有 `chatModel.usage` 的记录
- 显示字段: 模型名, Input Tokens, Output Tokens, Cache Read, Context (如果有), TTFT, Stream 时间, 总调用次数
- 新增 `contextTokensUsed` 显示 (来自 `contextWindowMetadata.estimatedTokensUsed`)
- 用 `useMemo` 避免重复计算

### App.tsx — Header 添加设置按钮
- 导入 `Settings` 图标 (lucide-react) 和 `ConfigPanel`
- 新增 `showConfig` state
- 在 header 右侧添加齿轮按钮, 点击展开 ConfigPanel popover
- 位置: 在翻页模式按钮之后

### index.css — 设置弹出层样式
- `.header-config-anchor`: `position: relative` 作为定位锚点
- `.header-config-popover`: 绝对定位, 从按钮下方弹出, 右对齐, 320px 宽
- `.header-config-popover .config-panel`: 去掉左侧 border, 宽度 100%
