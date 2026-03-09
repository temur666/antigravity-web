# LS Step 原始数据字段参考

> 通过 `GetCascadeTrajectory` gRPC API 获取的原始 step 数据结构。
> 本文档记录 LS 返回的 **原始字段名**，以及前端 normalizer 的映射关系。
> 抓取时间：2026-03-03

---

## 通用结构

每个 step 对象的顶层结构一致：

```json
{
  "type": "CORTEX_STEP_TYPE_XXX",
  "status": "CORTEX_STEP_STATUS_XXX",
  "metadata": { ... },
  "<payloadKey>": { ... }
}
```

### status 枚举

| 值 | 说明 |
|----|------|
| `CORTEX_STEP_STATUS_UNSPECIFIED` | 未指定 |
| `CORTEX_STEP_STATUS_PENDING` | 等待中 |
| `CORTEX_STEP_STATUS_GENERATING` | 生成中（流式输出） |
| `CORTEX_STEP_STATUS_DONE` | 完成 |
| `CORTEX_STEP_STATUS_ERROR` | 出错 |
| `CORTEX_STEP_STATUS_WAITING` | 等待用户操作 |

---

## 1. USER_INPUT

**payloadKey**: `userInput`

```
userInput: {
  items: [                          // 消息片段数组
    { text: string }                // 文本片段
  ]
  userResponse: string              // 完整用户输入文本（合并后）
  activeUserState: {                // 用户当前 IDE 状态
    activeDocument: {
      absoluteUri: string           // file:///path/to/file
      workspaceUri: string
      editorLanguage: string        // "typescript", "markdown", ...
      language: string              // "LANGUAGE_TYPESCRIPT", ...
      cursorPosition: {}
      lineEnding: string
    }
    openDocuments: [                // 打开的其他文件
      { absoluteUri, workspaceUri, editorLanguage, language, lineEnding }
    ]
  }
  clientType: string                // "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE"
  userConfig: {                     // 用户发送时的配置快照
    plannerConfig: {
      conversational: { plannerMode, agenticMode }
      toolConfig: { runCommand: {...}, notifyUser: {...} }
      requestedModel: { model: string }
      ephemeralMessagesConfig: { enabled: boolean }
      knowledgeConfig: { enabled: boolean }
    }
    conversationHistoryConfig: { enabled: boolean }
  }
  media: [                          // 附带的图片/媒体（可选）
    {
      mimeType: string              // "image/png"
      inlineData: string            // 空字符串（通过 uri 引用）
      uri: string                   // 本地文件路径
      thumbnail: string             // base64 缩略图
    }
  ]
}
```

---

## 2. PLANNER_RESPONSE

**payloadKey**: `plannerResponse`

```
plannerResponse: {
  response: string                  // AI 回复文本（markdown）
  modifiedResponse: string          // 修改后的回复（通常同 response）
  thinking: string                  // 思考过程文本
  thinkingSignature: string         // 思考签名（base64）
  messageId: string                 // "bot-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  toolCalls: [                      // 工具调用列表
    {
      id: string                    // "toolu_vrtx_..."
      name: string                  // "grep_search", "view_file", ...
      argumentsJson: string         // JSON 字符串，工具参数
    }
  ]
  thinkingDuration: string          // "6.049546898s"
  stopReason: string                // "STOP_REASON_STOP_PATTERN"
}
```

---

## 3. VIEW_FILE

**payloadKey**: `viewFile`

| LS 原始字段 | 前端映射 | 说明 |
|-------------|---------|------|
| `absolutePathUri` | `filePath` | `file:///path/to/file` -> `/path/to/file` |
| `endLine` | `endLine` | 结束行号 |
| `content` | `content` | 文件内容 |
| `numLines` | `numLines` | 总行数 |
| `numBytes` | `numBytes` | 总字节数 |

```
viewFile: {
  absolutePathUri: string           // "file:///home/user/foo.ts"
  endLine: number                   // 135
  content: string                   // 文件内容
  numLines: number                  // 136
  numBytes: number                  // 5020
}
```

> **注意**: 没有 `startLine` 字段，也没有 `filePath` 字段。
> normalizer 从 `absolutePathUri` 提取路径。

---

## 4. VIEW_FILE_OUTLINE

**payloadKey**: `viewFileOutline`

| LS 原始字段 | 前端映射 | 说明 |
|-------------|---------|------|
| `absolutePathUri` | `filePath` | `file:///...` -> `/...` |
| `ccis` | (normalizer 未映射到 outlineItems) | Code Context Items |
| `outlineItems` | `outlineItems` | JSON 字符串数组 |
| `numLines` | `numLines` | 总行数 |
| `numBytes` | `numBytes` | 总字节数 |

```
viewFileOutline: {
  absolutePathUri: string           // "file:///home/user/foo.ts"
  ccis: [                           // Code Context Items（结构化）
    {
      absoluteUri: string           // "file:///..."
      nodeName: string              // "(0-37)" 或函数名
      nodeLineage: [string]         // 父级路径
      startLine: number
      startCol: number
      endLine: number
      endCol: number
      contextType: string           // "CODE_CONTEXT_TYPE_FUNCTION" | "CODE_CONTEXT_TYPE_NAIVE_LINECHUNK"
      language: string              // "LANGUAGE_TYPESCRIPT"
      snippetByType: {
        "CONTEXT_SNIPPET_TYPE_RAW_SOURCE": { snippet: string }
        "CONTEXT_SNIPPET_TYPE_SIGNATURE": { snippet: string }
      }
    }
  ]
  outlineItems: [string]            // JSON 字符串数组，每项是序列化的大纲条目
  numItemsScanned: number
  totalCciCount: number
  numLines: number
  numBytes: number
  rawContent: string                // 完整文件内容
}
```

---

## 5. VIEW_CODE_ITEM

**payloadKey**: `viewCodeItem`

| LS 原始字段 | 前端映射 | 说明 |
|-------------|---------|------|
| `absoluteUri` | `filePath` | `file:///...` -> `/...` |
| `nodePaths` | `nodePaths` | 直接透传 |
| `ccis` | `items` | 转换 snippetByType -> snippet/signature |

```
viewCodeItem: {
  absoluteUri: string               // "file:///home/user/foo.ts"
  nodePaths: [string]               // ["createAppStore.selectConversation"]
  ccis: [                           // Code Context Items
    {
      absoluteUri: string
      nodeName: string              // "selectConversation"
      nodeLineage: [string]         // ["createAppStore"]
      startLine: number
      startCol: number
      endLine: number
      endCol: number
      contextType: string           // "CODE_CONTEXT_TYPE_FUNCTION"
      language: string              // "LANGUAGE_TYPESCRIPT"
      snippetByType: {
        "CONTEXT_SNIPPET_TYPE_RAW_SOURCE": { snippet: string }
        "CONTEXT_SNIPPET_TYPE_SIGNATURE": { snippet: string }
      }
    }
  ]
}
```

---

## 6. CODE_ACTION

**payloadKey**: `codeAction`

这是最复杂的 step 类型，嵌套层级最深。

| LS 原始路径 | 前端映射 | 说明 |
|-------------|---------|------|
| `actionSpec.command.file.absoluteUri` | `filePath` | 文件路径 |
| `actionSpec.command.replacementChunks` | `replacementChunks` + 生成 `diff` | 编辑内容 |
| `actionSpec.command.instruction` | fallback `description` | 编辑指令 |
| `actionResult.edit.diff.unifiedDiff.lines` | (原始结构化 diff) | 逐行类型标记 |
| `actionResult.edit.absoluteUri` | (同 filePath) | 结果文件路径 |
| `actionResult.edit.originalContent` | (未使用) | 原始文件内容 |
| `description` | `description` | 编辑描述 |
| `markdownLanguage` | `markdownLanguage` | 代码语言 |
| `acknowledgementType` | `acknowledgementType` | 确认类型 |

```
codeAction: {
  actionSpec: {
    command: {
      instruction: string           // "Add viewMode state field..."
      replacementChunks: [
        {
          targetContent: string     // 要替换的原始内容
          replacementContent: string // 替换后的内容
          startLine: number
          endLine: number
        }
      ]
      isEdit: boolean               // true
      useFastApply: boolean         // true
      file: {
        absoluteUri: string         // "file:///path/to/file.ts"
        workspaceUrisToRelativePaths: {
          "file:///home/user": "project/path/to/file.ts"
        }
      }
    }
  }
  actionResult: {
    edit: {
      diff: {
        endLine: number             // 文件总行数
        unifiedDiff: {
          lines: [                  // 逐行 diff
            {
              text: string          // 行内容
              type: string          // 见下面枚举
            }
          ]
        }
      }
      absoluteUri: string           // "file:///path/to/file.ts"
      originalContent: string       // 编辑前的完整文件内容
    }
  }
  useFastApply: boolean
  acknowledgementType: string       // "ACKNOWLEDGEMENT_TYPE_ACCEPT"
  markdownLanguage: string          // "typescript"
  replacementInfos: [               // 替换结果信息
    {
      originalChunk: {
        targetContent: string
        replacementContent: string
        startLine: number
        endLine: number
      }
      numMatches: number            // 匹配到几处
    }
  ]
  description: string               // "在 store 中新增 viewMode..."
}
```

### unifiedDiff line type 枚举

| 值 | 说明 |
|----|------|
| `UNIFIED_DIFF_LINE_TYPE_UNCHANGED` | 未修改行 |
| `UNIFIED_DIFF_LINE_TYPE_INSERT` | 新增行 |
| `UNIFIED_DIFF_LINE_TYPE_DELETE` | 删除行 |

---

## 7. RUN_COMMAND

**payloadKey**: `runCommand`

```
runCommand: {
  commandLine: string               // "npx tsc --noEmit 2>&1 | head -40"
  proposedCommandLine: string       // 同 commandLine（提议的命令）
  cwd: string                       // "/home/tiemuer/antigravity-web/frontend"
  waitMsBeforeAsync: string         // "10000"（注意是字符串）
  shouldAutoRun: boolean            // true
  blocking: boolean                 // true
  exitCode: number                  // 0
  autoRunDecision: string           // "AUTO_RUN_DECISION_DEFAULT_ALLOW"
  terminalId: string                // "3401826"
  combinedOutput: {}                // 通常为空对象（输出在 COMMAND_STATUS 中）
  usedIdeTerminal: boolean          // true
  rawDebugOutput: string            // 终端控制序列
}
```

> **注意**: `combinedOutput` 通常是空对象 `{}`，实际输出在后续的 `COMMAND_STATUS` step 中。
> normalizer 将 `commandLine` 映射为 `command`。

---

## 8. COMMAND_STATUS

**payloadKey**: `commandStatus`

```
commandStatus: {
  commandId: string                 // "6e51de29-..."（关联 RUN_COMMAND 的 ID）
  outputCharacterCount: number      // 2000
  waitDurationSeconds: number       // 15
  status: string                    // "CORTEX_STEP_STATUS_DONE"
  combined: string                  // 命令的合并输出
  delta: string                     // 增量输出
  exitCode: number                  // 0
}
```

---

## 9. GREP_SEARCH

**payloadKey**: `grepSearch`

| LS 原始字段 | 前端映射 | 说明 |
|-------------|---------|------|
| `searchPathUri` | `searchPath` | `file:///...` -> `/...` |
| `results[].relativePath` | `results[].file` | 相对路径 |
| `results[].absolutePath` | `results[].file` (优先) | 绝对路径 |
| `results[].content` | `results[].lineContent` | 匹配行内容 |

```
grepSearch: {
  searchPathUri: string             // "file:///home/user/project/src"
  query: string                     // "搜索关键词"
  matchPerLine: boolean             // true
  results: [
    {
      relativePath: string          // "components/ChatPanel/steps/PlannerResponseStep.tsx"
      lineNumber: number            // 65
      content: string               // "                        <span>思考过程</span>"
      absolutePath: string          // "/home/user/project/src/components/..."
    }
  ]
  totalResults: number              // 1
  rawOutput: string                 // ripgrep 原始输出
  commandRun: string                // 实际执行的 ripgrep 命令
}
```

---

## 10. FIND

**payloadKey**: `find`

```
find: {
  searchDirectory: string           // "/home/tiemuer/antigravity-web"
  pattern: string                   // "*"
  type: string                      // "FIND_RESULT_TYPE_DIRECTORY" | "FIND_RESULT_TYPE_FILE" | ...
  maxDepth: number                  // 1
  truncatedOutput: string           // "data/\ndocs/\nfrontend/\n..."（换行分隔）
  truncatedTotalResults: number     // 9
  totalResults: number              // 9
  rawOutput: string                 // 同 truncatedOutput（完整版）
  commandRun: string                // 实际执行的 fd 命令
}
```

> **注意**: 没有结构化的结果数组，文件列表在 `truncatedOutput` / `rawOutput` 中以换行分隔。

---

## 11. LIST_DIRECTORY

**payloadKey**: `listDirectory`

| LS 原始字段 | 前端映射 | 说明 |
|-------------|---------|------|
| `directoryPathUri` | `path` | `file:///...` -> `/...` |
| `results` | `entries` | 重命名 |

```
listDirectory: {
  directoryPathUri: string          // "file:///home/user/project/src"
  results: [
    {
      name: string                  // "App.tsx"
      sizeBytes: string             // "2318"（注意是字符串）
      isDir: boolean                // （可能存在，取决于条目类型）
      numChildren: number           // （目录时可能存在）
    }
  ]
}
```

---

## 12. ERROR_MESSAGE

**payloadKey**: `errorMessage`

```
errorMessage: {
  error: {                          // 注意: 是对象，不是字符串
    userErrorMessage: string        // 面向用户的错误信息
    modelErrorMessage: string       // 模型级别的错误信息
    shortError: string              // "UNAVAILABLE (code 503): No capacity..."
    fullError: string               // 完整错误堆栈
    errorCode: number               // 503
    details: string                 // JSON 字符串，错误详情
    rpcErrorDetails: [string]       // gRPC 错误详情数组
  }
}
```

> **注意**: `error` 是嵌套对象，不是简单字符串。
> normalizer 优先取 `userErrorMessage`，fallback 到 `shortError`。

---

## 13. CHECKPOINT

**payloadKey**: `checkpoint`

```
checkpoint: {
  intentOnly: boolean               // true
  includedStepIndexEnd: number      // 8
  userIntent: string                // AI 总结的用户意图
  artifactSnapshots: [
    {
      artifactName: string
      artifactAbsoluteUri: string   // "file:///..."
      lastEdited: string            // ISO 时间
    }
  ]
  conversationLogUris: [string]     // 对话日志 URI
  userRequests: [string]            // 用户原始请求文本列表
}
```

---

## 14. CODE_ACKNOWLEDGEMENT

**payloadKey**: `codeAcknowledgement`

```
codeAcknowledgement: {
  isAccept: boolean                 // true
  acknowledgementScope: string      // "CODE_ACKNOWLEDGEMENT_SCOPE_FILE"
  codeAcknowledgementInfos: [
    {
      uriPath: string               // "/home/user/project/src/file.tsx"
      stepIndices: [number]          // 关联的 CODE_ACTION step 索引
      diff: {
        lines: [                    // 同 CODE_ACTION 的 unifiedDiff.lines
          { text: string, type: string }
        ]
      }
    }
  ]
}
```

> 前端默认隐藏此类型，仅 debug 模式展示。

---

## 15. NOTIFY_USER

**payloadKey**: `notifyUser`

```
notifyUser: {
  message: string                   // 通知文本
}
```

---

## 16. SEARCH_WEB

**payloadKey**: `searchWeb`

```
searchWeb: {
  query: string
  results: [
    { title: string, url: string, snippet: string }
  ]
}
```

---

## 系统消息类型（隐藏）

以下类型默认隐藏，debug 模式下可见：

### CONVERSATION_HISTORY
```
conversationHistory: {
  content: string                   // Markdown 格式的对话摘要
}
```

### KNOWLEDGE_ARTIFACTS
```
knowledgeArtifacts: {}              // 通常为空对象
```

### EPHEMERAL_MESSAGE
```
ephemeralMessage: {}                // 通常为空对象
```

### TASK_BOUNDARY
```
taskBoundary: { ... }              // 任务边界标记
```

---

## GeneratorMetadata（对话级元数据）

位于 `trajectory.generatorMetadata[]`，每个条目对应一次模型调用。

```
generatorMetadata: {
  stepIndices: [number]             // 关联的 step 索引 [4, 5, 6, 7]
  executionId: string               // UUID
  chatModel: {
    model: string                   // "MODEL_PLACEHOLDER_M26"
    responseModel: string           // "claude-opus-4-6-thinking"（实际模型名）
    usage: {
      model: string
      inputTokens: string           // "6303"（注意是字符串！）
      outputTokens: string          // "534"
      responseOutputTokens: string  // "534"
      cacheReadTokens: string       // "15940"
      apiProvider: string           // "API_PROVIDER_ANTHROPIC_VERTEX"
      responseHeader: {
        sessionID: string
      }
      responseId: string            // "req_vrtx_..."
    }
    lastCacheIndex: number
    toolChoice: { optionName: string }     // "auto"
    chatStartMetadata: {
      createdAt: string             // ISO 时间
      checkpointIndex: number       // -1
      latestStableMessageIndex: number
      cacheBreakpoints: [
        { index, options: { type: string }, contentChecksum: string }
      ]
      systemPromptCache: { options: { type }, contentChecksum }
      timeSinceLastInvocation: string      // "0s"
      contextWindowMetadata: {
        estimatedTokensUsed: number // 3023
      }
    }
    timeToFirstToken: string        // "2.288739440s"
    streamingDuration: string       // "9.096086294s"
    completionConfig: {
      numCompletions: string        // "1"
      maxTokens: string             // "16384"
      maxNewlines: string           // "200"
      temperature: number           // 0.4
      firstTemperature: number      // 0.4
      topK: string                  // "50"
      topP: number                  // 1
      stopPatterns: [string]
      fimEotProbThreshold: number
    }
    retryInfos: [
      {
        usage: { ... }              // 同上 usage 结构
        traceId: string
      }
    ]
  }
}
```

> **注意**: `inputTokens`、`outputTokens` 等数值字段是 **字符串** 类型，需 `parseInt()` 转换。

---

## Normalizer 映射总表

| Step Type | LS 原始 → 前端字段 |
|-----------|-------------------|
| VIEW_FILE | `absolutePathUri` -> `filePath` |
| VIEW_FILE_OUTLINE | `absolutePathUri` -> `filePath` |
| VIEW_CODE_ITEM | `absoluteUri` -> `filePath`, `ccis` -> `items` |
| CODE_ACTION | `actionSpec.command.file.absoluteUri` -> `filePath`, `replacementChunks` -> `diff` |
| LIST_DIRECTORY | `directoryPathUri` -> `path`, `results` -> `entries` |
| GREP_SEARCH | `searchPathUri` -> `searchPath`, `results[].relativePath/absolutePath` -> `file`, `content` -> `lineContent` |
| RUN_COMMAND | `commandLine` -> `command` |
| ERROR_MESSAGE | `error.userErrorMessage` -> `message` |

Normalizer 实现: `lib/core/step-normalizer.js`
