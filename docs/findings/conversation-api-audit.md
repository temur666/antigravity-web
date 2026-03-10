# Conversation 模块 API 对齐审计报告

## 概要
- **审计时间**: 2026-03-10
- **审计范围**: `lib/core/conversation/` 目录下的核心文件 (`state.js`, `sync.js`, `step-normalizer.js`) 及其相关测试文件。
- **参考依据**: `docs/reference/ls-grpc-api.md`
- **发现总数**: 5项 (1重, 1中, 3低)

## 发现列表

### [严重] 发现 1: CODE_ACKNOWLEDGEMENT 缺少 normalizer
- **文件**: `lib/core/conversation/step-normalizer.js`
- **行号**: 319-336
- **描述**: `PAYLOAD_KEYS` 中定义了 `CORTEX_STEP_TYPE_CODE_ACKNOWLEDGEMENT` 映射v到 `codeAcknowledgement` 字段名，但是在下面的 `NORMALIZERS` 字典中却没有对应的处理函数。这会导致 `normalizeStep` 匹配不到 normalizer，从而按未识别的系统类型（原样透传）处理，这完全违背了将其加入 `PAYLOAD_KEYS` 尝试提取 payload 的初衷。
- **建议修复**: 在 `NORMALIZERS` 中添加 `normalizeCodeAcknowledgement` 函数；或者如果是刻意透传，则应该从 `PAYLOAD_KEYS` 中移除该键以保持逻辑自洽。

### [中等] 发现 2: 轮询失败时的循环并发重连导致雪崩效应 (Connection Refused)
- **文件**: `lib/core/conversation/sync.js`
- **行号**: 333-335
- **描述**: 在 `pollOnce` 中遍历所有的 `RUNNING` 对话。如果此时 LS 进程崩溃断开，捕获到 ECONNREFUSED/timeout 异常后，会调用 `await this._lsManager.refreshLS()`。但由于这是在一个遍历多条运行中对话的 for 循环里，这会导致它被连续盲目触发多次（重连风暴）。
- **建议修复**: 添加断路器或在 `refreshLS()` 内部增加防抖/单例锁；或者在遇到致命系统级网络错误时，直接 `break` 退出当前轮询循环。

### [低] 发现 3: 长时间运行后的轻微内存泄漏 (Map 集合清理缺失)
- **文件**: `lib/core/conversation/sync.js`
- **行号**: 41, 103, 116
- **描述**: 流式数据节流使用的 `_lastFetchTimes` 和 `_changeDebouncers` 字典在调用 `unsubscribe`（并且当前对话再无其它 subscriber 时）并没有得到同步清理。随着日积月累大量临时对话的创建与销毁，`_lastFetchTimes` 的体积会无限制地缓慢增加。
- **建议修复**: 在 `unsubscribe` 中当订阅者清零时，将其 `cascadeId` 对应的 timer 和 `_lastFetchTimes` 缓存 `delete` 掉。

### [低] 发现 4: state.js 中非必要的阻塞读取
- **文件**: `lib/core/conversation/state.js`
- **行号**: 122-126
- **描述**: `listConversations` 中使用了同步 API `fs.readdirSync(convDir)` 以及 `fs.statSync` 来扫描 `.pb` 文件。当应用中积累了较多的历史对话文件时，同步 I/O 会阻塞 Node.js 事件循环。
- **建议修复**: 替换为基于 Promise 的 `fs.promises.readdir` 和 `fs.promises.stat` 异步方法。

### [低] 发现 5: 测试覆盖率严重不足 (缺乏对 gRPC 真实路径的 mock 测试)
- **文件**: `lib/core/conversation/__tests__/state.test.js` & `sync.test.js`
- **描述**: 现有的测试主要覆盖了纯前端逻辑（如 Diff 引擎、订阅者管理、结构创建），但对于核心功能的成功路径 (`newChat`, `sendMessage`, `getTrajectory`, `pollOnce` 等) 完全缺乏测试，也没有对 `grpcCall` 实现进行打桩（Stub/Mock），导致这些代码分支形同虚设地缺乏自动化防线。
- **建议修复**: 引入 `jest.mock('../ls/grpc')` 或类似的轻量 Mock，补全 `StartCascade`，`SendUserCascadeMessage` 等关键调用的模拟成功及各种失败响应断言。

## Step 类型覆盖率矩阵

| Step 类型 | ls-grpc-api.md | step-normalizer.js | 状态 |
|-----------|:-:|:-:|------|
| CORTEX_STEP_TYPE_USER_INPUT | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_PLANNER_RESPONSE | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_VIEW_FILE | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_CODE_ACTION | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_RUN_COMMAND | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_COMMAND_STATUS | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_LIST_DIRECTORY | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_NOTIFY_USER | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_ERROR_MESSAGE | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_CHECKPOINT | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_SEARCH_WEB | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE | OK | -- | 约定透传 (正常) |
| CORTEX_STEP_TYPE_CONVERSATION_HISTORY | OK | -- | 约定透传 (正常) |
| CORTEX_STEP_TYPE_TASK_BOUNDARY | OK | -- | 约定透传 (正常) |
| CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE | -- | OK | 文档待补充 |
| CORTEX_STEP_TYPE_VIEW_CODE_ITEM | -- | OK | 文档待补充 |
| CORTEX_STEP_TYPE_GREP_SEARCH | -- | OK | 文档待补充 |
| CORTEX_STEP_TYPE_FIND | -- | OK | 文档待补充 |
| CORTEX_STEP_TYPE_CODE_ACKNOWLEDGEMENT | -- | 半覆盖 | JS Normalizer 缺失 |

> *注: `step-normalizer.js` 中存在上表中标记为“文档待补充”的 5 种 Step，这些未在 `ls-grpc-api.md` 中提及但代码中已有处理。*

## API 方法调用矩阵

| gRPC 方法 | ls-grpc-api.md | state.js | sync.js | 状态 |
|-----------|:-:|:-:|:-:|------|
| StartCascade | OK | OK | -- | 正常 |
| SendUserCascadeMessage | OK | OK | -- | 正常 |
| GetCascadeTrajectory | OK | OK | OK | 正常 |
| GetAllCascadeTrajectories | OK | OK | -- | 正常 |
| CancelCascadeInvocation | OK | OK | -- | 正常 |
| StreamCascadeReactiveUpdates | OK | -- | (Stream层) | 封装在 LSManager 中，正常 |

## 改进建议
**按优先级排列:**
1. **[紧急]** 修复 `step-normalizer.js` 中关于 `CODE_ACKNOWLEDGEMENT` 的缺失，补充 `normalizeCodeAcknowledgement` 函数避免引发报错。
2. **[高]** 补充缺失的接口文档 `VIEW_FILE_OUTLINE`, `VIEW_CODE_ITEM`, `GREP_SEARCH`, `FIND` 等到 `docs/reference/ls-grpc-api.md` 的枚举列表中去。
3. **[高]** 优化 `sync.js` 的 `pollOnce` 函数中的异常拦截机制，避免并发 `refreshLS` 的雪崩问题。
4. **[中]** 补充 `grpcCall` 拦截层相关的单元测试，将状态管理的核心代码提升覆盖率。
5. **[中]** 清理 `sync.js` 流订阅状态销毁时的剩余 Map 잔留 (内存泄漏)。
6. **[低]** 逐步重构 `state.js` 中的文件同步/查询请求改为纯异步形式。
