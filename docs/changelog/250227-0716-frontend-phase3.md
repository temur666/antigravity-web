# Frontend v2 — Phase 3: 无头组件

**日期**: 2026-02-27  
**模块**: `frontend/src/components/`, `frontend/src/utils/`, `frontend/src/store/`

## 变更摘要

### 架构

```
App.tsx
├── Sidebar          (对话列表)
├── main-area
│   ├── Header       (菜单/标题/配置按钮)
│   ├── main-content
│   │   ├── ChatPanel    (对话面板)
│   │   │   ├── StepRenderer × N   (13 类型分发)
│   │   │   └── InputBox           (消息输入)
│   │   └── ConfigPanel  (配置面板, 可切换)
│   └── StatusBar    (LS 状态/账号/Debug)
```

### 组件清单

| 组件 | 职责 |
|---|---|
| `App.tsx` | 主布局, Sidebar 可折叠, ConfigPanel 可切换 |
| `Sidebar` | 对话列表, 新建/刷新, 活跃高亮, 时间/大小显示 |
| `ChatPanel` | Steps 列表渲染, 自动滚动, 空状态, 加载/错误, RUNNING 指示器 |
| `InputBox` | textarea, Enter 发送, Shift+Enter 换行, 运行中禁用 |
| `StepRenderer` | type → component 分发, debug 模式控制隐藏类型 |
| `ConfigPanel` | CONFIG_META 驱动动态渲染, model 下拉动态列表 |
| `StatusBar` | LS 连接灯, 账号, Debug ON/OFF 开关 |

### 13 个 Step 组件

| 组件 | Step Type | 特性 |
|---|---|---|
| `UserInputStep` | USER_INPUT | 用户消息显示 |
| `PlannerResponseStep` | PLANNER_RESPONSE | thinking 折叠 + Markdown 渲染 + toolCalls 展开 |
| `ViewFileStep` | VIEW_FILE | 折叠式文件内容 |
| `CodeActionStep` | CODE_ACTION | Diff 显示 |
| `RunCommandStep` | RUN_COMMAND | 命令 + cwd 显示 |
| `CommandStatusStep` | COMMAND_STATUS | 折叠式输出 + exit code |
| `ListDirectoryStep` | LIST_DIRECTORY | 折叠式目录树 |
| `NotifyUserStep` | NOTIFY_USER | 通知消息 |
| `ErrorMessageStep` | ERROR_MESSAGE | 红色错误 |
| `CheckpointStep` | CHECKPOINT | 绿色检查点 |
| `SearchWebStep` | SEARCH_WEB | 搜索结果链接 |
| `SystemStep` | 4 种隐藏类型 | 通用折叠, debug 模式可见 |

### 工具层

| 文件 | 内容 |
|---|---|
| `utils/markdown.ts` | marked + highlight.js 代码高亮 |
| `utils/format.ts` | formatBytes, formatRelativeTime, truncate, shortId |
| `store/hooks.ts` | useAppStore — zustand → React selector hook |

## 检查结果

- ✅ TSC: 零错误
- ✅ ESLint: 零错误
- ✅ Vitest: 38/38 通过
- ✅ Build: 成功 (dist/ 生成)
