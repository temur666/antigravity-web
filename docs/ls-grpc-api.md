# Antigravity LS gRPC API 完整参考

> 提取自 LS v1.19.6 二进制 (language_server_linux_x64)  
> 服务路径: `/exa.language_server_pb.LanguageServerService/{MethodName}`  
> 协议: Connect Protocol (JSON over HTTPS)  
> 认证: `x-codeium-csrf-token` header  
> 更新: 2026-02-27

---

## 1. 对话管理 (Cascade)

### 核心生命周期

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `StartCascade` | 创建新对话，返回 cascadeId | ✅ |
| `SendUserCascadeMessage` | 发送用户消息（流式） | ✅ |
| `GetCascadeTrajectory` | 获取完整对话轨迹（steps + status） | ✅ |
| `GetCascadeTrajectorySteps` | 获取对话步骤（可能支持分页） | |
| `GetCascadeTrajectoryGeneratorMetadata` | 获取生成器元数据 | |
| `GetAllCascadeTrajectories` | 获取所有对话摘要（标题等） | ✅ |
| `DeleteCascadeTrajectory` | 删除对话轨迹 | ✅ |
| `CopyTrajectory` | 复制对话 | |
| `LoadTrajectory` | 加载轨迹到内存 | ✅ |
| `ConvertTrajectoryToMarkdown` | 导出对话为 Markdown | |
| `CreateTrajectoryShare` | 创建对话分享链接 | |

### 对话控制

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `CancelCascadeInvocation` | 取消正在执行的对话 | |
| `CancelCascadeSteps` | 取消特定步骤 | |
| `RevertToCascadeStep` | 回退到某个步骤 | |
| `ResolveOutstandingSteps` | 解决待处理步骤 | |
| `DeleteQueuedUserInputStep` | 删除排队的用户输入 | |
| `SendAllQueuedMessages` | 发送所有排队消息 | |
| `HandleCascadeUserInteraction` | 处理用户交互（如确认） | |
| `AcknowledgeCascadeCodeEdit` | 确认代码编辑 | |
| `AcknowledgeCodeActionStep` | 确认代码操作步骤 | |
| `SmartFocusConversation` | 智能聚焦对话 | |

### 对话注释

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `UpdateConversationAnnotations` | 更新对话注释 | ✅ |

### 对话面板

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `InitializeCascadePanelState` | 初始化面板状态 | |
| `SendActionToChatPanel` | 发送操作到面板 | |
| `GetRevertPreview` | 获取回退预览 | |
| `GetPatchAndCodeChange` | 获取补丁和代码变更 | |
| `GetCodeValidationStates` | 获取代码验证状态 | |

---

## 2. 实时流式 API (Stream)

| 方法 | 用途 | 协议 | 已验证 |
|:-----|:-----|:-----|:------:|
| `StreamCascadeReactiveUpdates` | 订阅单个对话的实时变更 | Connect Streaming | ✅ |
| `StreamCascadeSummariesReactiveUpdates` | 订阅对话列表的实时变更 | Connect Streaming | |
| `StreamCascadePanelReactiveUpdates` | 订阅面板实时更新 | Connect Streaming | |
| `StreamAgentStateUpdates` | 订阅 Agent 状态更新 | Connect Streaming | |
| `StreamUserTrajectoryReactiveUpdates` | 订阅用户轨迹更新 | Connect Streaming | |
| `StreamTerminalShellCommand` | 终端命令流式输出 | Connect Streaming | |
| `HandleStreamingCommand` | 处理流式命令 | Connect Streaming | |

### Connect Streaming 协议

```
Content-Type: application/connect+json
Envelope: flags(1B) + length(4B big-endian) + JSON payload
flags=0x00: 数据帧
flags=0x02: end-of-stream (trailer)
```

### StreamCascadeReactiveUpdates 请求/响应

```json
// 请求 (envelope 编码)
{ "protocolVersion": 1, "id": "cascadeId", "subscriberId": "unique-id" }

// 响应 (envelope 编码, 多条)
// 第 1 条: 初始快照
{ "version": "1234", "diff": { "fieldDiffs": [...] } }

// 后续: 增量更新 (protobuf diff 格式)
{ "version": "1235", "diff": { "fieldDiffs": [...] } }
```

---

## 3. 用户与账号

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetUserStatus` | 用户信息 + 模型列表 + 配额 | ✅ |
| `GetUserSettings` | 获取用户设置 | |
| `SetUserSettings` | 修改用户设置 | |
| `GetUserAnalyticsSummary` | 用户使用分析 | |
| `GetProfileData` | 获取配置数据 | |
| `AcceptTermsOfService` | 接受服务条款 | ✅ |
| `GetTermsOfService` | 获取服务条款内容 | |
| `GetTeamOrganizationalControls` | 团队组织管控 | |
| `RegisterGdmUser` | 注册 GDM 用户 | |
| `MigrateApiKey` | 迁移 API Key | |
| `OpenUrlAuthentication` | 打开认证 URL | |
| `ResetOnboarding` | 重置新手引导 | |
| `SkipOnboarding` | 跳过新手引导 | |
| `ImportFromCursor` | 从 Cursor 导入 | |

---

## 4. 记忆系统 (Memory)

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetCascadeMemories` | 获取对话级记忆 | |
| `UpdateCascadeMemory` | 更新对话级记忆 | |
| `DeleteCascadeMemory` | 删除对话级记忆 | |
| `GetUserMemories` | 获取用户级记忆 | |
| `GetUserTrajectory` | 获取用户轨迹 | |
| `GetUserTrajectoryDebug` | 调试用户轨迹 | |
| `GetUserTrajectoryDescriptions` | 获取用户轨迹描述 | |

---

## 5. 模型管理

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetCommandModelConfigs` | 获取模型配置列表 | ✅ |
| `GetCascadeModelConfigs` | 获取 Cascade 模型配置 | |
| `GetCascadeModelConfigData` | 获取 Cascade 模型配置数据 | |
| `GetModelStatuses` | 获取模型状态 | |
| `GetModelResponse` | 获取模型响应 | |

### GetCommandModelConfigs 响应

```json
{
  "clientModelConfigs": [
    {
      "label": "Gemini 3 Flash",
      "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M18" },
      "supportsImages": true,
      "isRecommended": true,
      "allowedTiers": ["TEAMS_TIER_PRO", ...],
      "quotaInfo": { "remainingFraction": 1, "resetTime": "..." },
      "supportedMimeTypes": { "image/png": true, ... }
    }
  ]
}
```

---

## 6. 工作区与文件

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetWorkspaceInfos` | 获取工作区信息 | |
| `GetWorkspaceEditState` | 获取工作区编辑状态 | |
| `GetWorkingDirectories` | 获取工作目录 | |
| `SetWorkingDirectories` | 设置工作目录 | |
| `AddTrackedWorkspace` | 添加跟踪工作区 | |
| `RemoveTrackedWorkspace` | 移除跟踪工作区 | |
| `GetRepoInfos` | 获取 Git 仓库信息 | |
| `StatUri` | 检查 URI 状态 | |
| `CreateWorktree` | 创建 Git worktree | |
| `UpdatePRForWorktree` | 更新 worktree 的 PR | |
| `GenerateCommitMessage` | AI 生成 commit message | |

---

## 7. MCP (Model Context Protocol)

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetMcpServerStates` | 获取 MCP 服务器状态 | |
| `GetMcpServerTemplates` | 获取 MCP 服务器模板 | |
| `RefreshMcpServers` | 刷新 MCP 服务器 | |
| `ListMcpPrompts` | 列出 MCP prompts | |
| `ListMcpResources` | 列出 MCP 资源 | |

---

## 8. 插件与扩展

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetAvailableCascadePlugins` | 获取可用插件列表 | |
| `GetCascadePluginById` | 根据 ID 获取插件 | |
| `InstallCascadePlugin` | 安装插件 | |
| `GetAgentScripts` | 获取 Agent 脚本 | ✅ |
| `SaveAgentScriptCommandSpec` | 保存 Agent 脚本命令规格 | |
| `GetAllCustomAgentConfigs` | 获取所有自定义 Agent 配置 | |

---

## 9. Rules / Skills / Workflows

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetAllRules` | 获取所有 Rules | |
| `GetAllSkills` | 获取所有 Skills | |
| `GetAllWorkflows` | 获取所有 Workflows | |
| `CopyBuiltinWorkflowToWorkspace` | 复制内建 Workflow 到工作区 | |
| `GetMatchingContextScopeItems` | 获取匹配的上下文范围项 | |

---

## 10. Artifact 与媒体

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `GetArtifactSnapshots` | 获取 artifact 快照 | |
| `GetRevisionArtifact` | 获取修订 artifact | |
| `DeleteMediaArtifact` | 删除媒体 artifact | |
| `SaveMediaAsArtifact` | 保存媒体为 artifact | |
| `GetTranscription` | 获取转录内容 | |

---

## 11. 浏览器集成

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `SmartOpenBrowser` | 智能打开浏览器 | |
| `CaptureScreenshotURL` | 捕获截图 URL | |
| `CaptureConsoleLogs` | 捕获控制台日志 | |
| `GetBrowserOpenConversation` | 获取浏览器打开的对话 | |
| `SetBrowserOpenConversation` | 设置浏览器打开的对话 | |
| `AddToBrowserWhitelist` | 添加到浏览器白名单 | |
| `GetAllBrowserWhitelistedUrls` | 获取所有白名单 URL | |
| `GetBrowserWhitelistFilePath` | 获取白名单文件路径 | |
| `SkipBrowserSubagent` | 跳过浏览器子代理 | |
| `HandleScreenRecording` | 处理屏幕录制 | |
| `SaveScreenRecording` | 保存屏幕录制 | |

---

## 12. 自定义与配置

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `CreateCustomizationFile` | 创建自定义文件 | |
| `ListCustomizationPathsByFile` | 按文件列出自定义路径 | |
| `UpdateCustomizationPathsFile` | 更新自定义路径文件 | |
| `SetBaseExperiments` | 设置基础实验参数 | |
| `UpdateDevExperiments` | 更新开发实验参数 | |
| `GetUnleashData` | 获取 Feature Flags | ✅ |
| `GetStaticExperimentStatus` | 获取静态实验状态 | |
| `ShouldEnableUnleash` | 是否启用 Unleash | |
| `GetChangelog` | 获取变更日志 | |
| `GetWebDocsOptions` | 获取 Web 文档选项 | |
| `RefreshContextForIdeAction` | 为 IDE 操作刷新上下文 | |

---

## 13. 遥测与反馈

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `RecordEvent` | 记录遥测事件 | ✅ |
| `RecordAnalyticsEvent` | 记录分析事件 | |
| `RecordChatFeedback` | 记录聊天反馈 | |
| `RecordChatPanelSession` | 记录面板会话 | |
| `RecordCommitMessageSave` | 记录 commit message 保存 | |
| `RecordInteractiveCascadeFeedback` | 记录交互式反馈 | |
| `RecordLintsFailed` | 记录 lint 失败 | |
| `RecordSearchDocOpen` | 记录搜索文档打开 | |
| `RecordSearchResultsView` | 记录搜索结果查看 | |
| `RecordUserGrep` | 记录用户 grep | |
| `RecordUserStepSnapshot` | 记录用户步骤快照 | |
| `ProvideCompletionFeedback` | 提供补全反馈 | |

---

## 14. 系统与调试

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `Heartbeat` | 心跳保活 | ✅ |
| `GetStatus` | 获取状态 | ✅ |
| `GetDebugDiagnostics` | 获取调试诊断 | |
| `DumpFlightRecorder` | 转储飞行记录 | |
| `DumpPprof` | 转储 pprof 性能数据 | |
| `ReconnectExtensionServer` | 重连扩展服务器 | |
| `SignalExecutableIdle` | 信号可执行文件空闲 | |
| `WellSupportedLanguages` | 获取支持的编程语言 | |
| `ForceBackgroundResearchRefresh` | 强制刷新后台研究 | |

---

## 15. 回放与测试

| 方法 | 用途 | 已验证 |
|:-----|:-----|:------:|
| `CreateReplayWorkspace` | 创建回放工作区 | |
| `LoadReplayConversation` | 加载回放对话 | |
| `ReplayGroundTruthTrajectory` | 回放真实轨迹 | |
| `SetupUniversitySandbox` | 设置大学沙箱 | |

---

## 已验证 API 详细响应格式

### GetAllCascadeTrajectories

```json
// 请求: {}
// 响应:
{
  "trajectorySummaries": {
    "cascadeId": {
      "summary": "对话标题",
      "stepCount": 341,
      "lastModifiedTime": "2026-02-27T07:43:57.243Z",
      "trajectoryId": "uuid",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-02-27T06:18:48.548Z",
      "workspaces": [{ "workspaceFolderAbsoluteUri": "file:///path" }],
      "lastUserInputTime": "2026-02-27T07:30:01.464Z",
      "lastUserInputStepIndex": 319
    }
  }
}
```

### GetCascadeTrajectory

```json
// 请求: { "cascadeId": "uuid" }
// 响应:
{
  "trajectory": {
    "trajectoryId": "uuid",
    "cascadeId": "uuid",
    "trajectoryType": "...",
    "steps": [
      {
        "type": "CORTEX_STEP_TYPE_USER_INPUT",
        "status": "CORTEX_STEP_STATUS_DONE",
        "metadata": { "createdAt": "...", "source": "..." },
        "userInput": { "items": [{ "text": "用户消息" }], "userResponse": "用户消息" }
      }
    ],
    "generatorMetadata": [...],
    "executorMetadatas": [...],
    "source": "...",
    "metadata": {...}
  },
  "status": "CASCADE_RUN_STATUS_IDLE",
  "numTotalSteps": 341,
  "numTotalGeneratorMetadata": ...
}
```

### GetUserStatus

```json
// 请求: {}
// 响应:
{
  "userStatus": {
    "name": "tim",
    "email": "tiemuer2025@gmail.com",
    "planStatus": {
      "planInfo": {
        "teamsTier": "TEAMS_TIER_PRO",
        "planName": "Pro",
        "monthlyPromptCredits": 50000,
        "monthlyFlowCredits": 150000
      },
      "availablePromptCredits": 500,
      "availableFlowCredits": 100
    },
    "cascadeModelConfigData": { "clientModelConfigs": [...] }
  }
}
```

### Heartbeat

```json
// 请求: { "metadata": {} }
// 响应:
{ "lastExtensionHeartbeat": "2026-02-27T12:27:11Z" }
```

---

## Step 类型枚举

| 枚举值 | 说明 |
|:-------|:-----|
| `CORTEX_STEP_TYPE_USER_INPUT` | 用户输入 |
| `CORTEX_STEP_TYPE_PLANNER_RESPONSE` | AI 计划响应 |
| `CORTEX_STEP_TYPE_VIEW_FILE` | 查看文件 |
| `CORTEX_STEP_TYPE_CODE_ACTION` | 代码操作 |
| `CORTEX_STEP_TYPE_RUN_COMMAND` | 运行命令 |
| `CORTEX_STEP_TYPE_COMMAND_STATUS` | 命令状态 |
| `CORTEX_STEP_TYPE_LIST_DIRECTORY` | 列出目录 |
| `CORTEX_STEP_TYPE_NOTIFY_USER` | 通知用户 |
| `CORTEX_STEP_TYPE_ERROR_MESSAGE` | 错误消息 |
| `CORTEX_STEP_TYPE_CHECKPOINT` | 检查点 |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | 临时消息 |
| `CORTEX_STEP_TYPE_CONVERSATION_HISTORY` | 对话历史 |
| `CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS` | 知识 artifacts |
| `CORTEX_STEP_TYPE_TASK_BOUNDARY` | 任务边界 |
| `CORTEX_STEP_TYPE_SEARCH_WEB` | 搜索网页 |

## 对话状态枚举

| 枚举值 | 说明 |
|:-------|:-----|
| `CASCADE_RUN_STATUS_IDLE` | 空闲 |
| `CASCADE_RUN_STATUS_RUNNING` | 运行中 |
| `CASCADE_RUN_STATUS_UNKNOWN` | 未知 |

---

## 注意事项

1. **不要批量高频调用** — LS 是单进程 Go 服务，并发过高会导致崩溃
2. **流式 API 使用 Connect Streaming 协议** — 不能用普通 JSON POST
3. **CSRF Token 随 LS 进程变化** — 每次 LS 重启后需重新获取
4. **LS 端口随机分配** — 通过 daemon JSON 文件或进程参数获取
5. **部分方法名可能包含 Go 编译噪音** — 如 `ListPagesANNOYANCE`、`GetAllBrowserWhitelistedUrlsafter` 等可能需要去掉后缀
