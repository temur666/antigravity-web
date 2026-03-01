# StreamCascadeReactiveUpdates Payload 分析

> 日期: 2026-03-01 | 基于 LS v1.19.6

## 一、背景

`StreamCascadeReactiveUpdates` 是 LS 提供的流式 API，用于实时订阅对话的状态变化。本文记录了对该 API 实际推送数据的完整探测过程和结论。

### 动机

antigravity-web 的 `StreamClient` 已经在使用这个 API，但只读取了 `version` 字段用于判断"有没有变化"，收到变化后再通过 `GetCascadeTrajectory` 拉取全量数据。我们想知道：stream 消息里除了 `version`，是否还有别的有价值的数据（比如文本 delta）？

---

## 二、探测工具

两个探测脚本存放在 `tools/` 目录：

### `tools/probe-stream-payload.js`

**用途**: 打印每条 stream 消息的完整 JSON

```bash
node tools/probe-stream-payload.js
```

创建新对话 → 订阅 stream → 发送简单消息 → 逐条打印 stream 返回的完整 JSON 对象，包括所有字段的原始值。

### `tools/probe-stream-v2.js`

**用途**: 解析 protobuf diff 结构，提取字段路径和值

```bash
node tools/probe-stream-v2.js
```

对每条消息的 `diff.fieldDiffs` 进行递归解析，输出人类可读的字段路径格式（如 `f2.f2[5].f1=E23`），方便快速识别字段含义。

> **注意**: 两个脚本都会创建一个新对话并发送一条消息，消耗少量配额。

---

## 三、发现：消息结构

### 3.1 顶层结构

每条 stream 消息只有两个字段：

```json
{
    "version": "27",    // 递增版本号
    "diff": { ... }     // protobuf field-level diff
}
```

- `version` 是字符串类型的递增数字
- `diff` 包含 `fieldDiffs` 数组，描述了 protobuf 结构中哪些字段发生了变化

### 3.2 diff 结构

diff 使用 protobuf 的 field number 来标识字段，不使用字段名。结构示例：

```json
{
    "fieldDiffs": [
        {
            "fieldNumber": 2,
            "updateSingular": {
                "messageValue": {
                    "fieldDiffs": [
                        {
                            "fieldNumber": 2,
                            "updateRepeated": {
                                "newLength": 8,
                                "updateValues": [...]
                            }
                        }
                    ]
                }
            }
        }
    ]
}
```

### 3.3 值类型

diff 中的值用以下类型表示：

| 类型 | 对应 proto type |
|------|----------------|
| `stringValue` | string |
| `enumValue` | enum (数字) |
| `int32Value` | int32/uint32 |
| `boolValue` | bool |
| `messageValue` | 嵌套 message |
| `updateRepeated` | repeated 字段 |

---

## 四、字段映射（从探测数据推断）

通过对比 LS API 返回的 JSON 字段名和 stream 中的 field number，推断出以下映射：

### 顶层 (CascadeRunState)

| fieldNumber | 含义 | 证据 |
|-------------|------|------|
| f1 | cascadeId | 值是 UUID 字符串 |
| f2 | trajectory | 包含 steps、generatorMetadata 等 |
| f3 | status (CASCADE_RUN_STATUS_*) | E1=IDLE, E2=RUNNING |
| f4 | requestedInteraction | 包含 step 审批信息 |
| f8 | 未知状态字段 | 与 f3 同步变化 |

### trajectory (f2)

| fieldNumber | 含义 | 证据 |
|-------------|------|------|
| f2.f1 | trajectoryId | UUID 字符串 |
| f2.f2 | steps (repeated) | `newLength` 随 step 增加递增 |
| f2.f3 | generatorMetadata (repeated) | 包含系统 prompt、模型配置等 |
| f2.f9 | requestedInteractions | 包含需要审批的 step 信息 |

### step (f2.f2[N])

| fieldNumber | 含义 | 证据 |
|-------------|------|------|
| f1 | type (CORTEX_STEP_TYPE_*) | E14=USER_INPUT, E23=PLANNER_RESPONSE, E17=ERROR_MESSAGE 等 |
| f4 | status (CORTEX_STEP_STATUS_*) | E2=GENERATING, E3=DONE |
| f5 | timestamps/metadata | 包含时间戳 (int32)、生成器 ID 等 |
| f19 | userInput payload | 包含用户消息文本 |
| f20 | 代码引用 | 对话 ID、trajectory ID |
| f24 | error info | 包含错误消息（如 503 重试） |

---

## 五、核心结论

### Stream 不提供 token-level 文本流

**关键发现**: `StreamCascadeReactiveUpdates` 推送的是 protobuf 级别的结构 diff，不包含 AI 回复的实际文字增量。

在 AI 生成回复的过程中，stream 推送的是：
- step 的新增/删除（`updateRepeated` 的 `newLength` 变化）
- step 的 status 变化（`enumValue` 从 GENERATING 变为 DONE）
- metadata 更新（生成器信息、时间戳等）

**但 `plannerResponse.response` 的文字增量没有出现在 diff 中。**

可能的原因：
1. LS 只在 step 完成时（DONE）才写入 response 文本
2. 或者文本存储在 diff 没有覆盖到的某个深层字段中

### 典型消息流

一次简单对话（"1+1等于几"）产生的 stream 消息序列：

```
#1  v2   [初始快照] cascadeId, trajectory 初始化
#2  v3   status → RUNNING (E2)
#3  v4   未知状态同步
#4  v5   [EMPTY]
#5  v6   [EMPTY]
#6  v7   step[0] 新增 (USER_INPUT, E14)，包含用户消息文本
#7  v8   step[1] 新增 (系统 step)
#8  v9   step[2] 新增 (系统 step)
#9  v10  step[3] 新增 (系统 step)
...
#14 v15  generatorMetadata 大块更新 (系统 prompt、模型配置)
#15 v16  step[4] 更新 (时间戳)
#16 v17  step[5] 新增 (PLANNER_RESPONSE, E23, status=GENERATING)
#17 v18  status → IDLE (E1)
#18 v19  step[7] 更新 (PLANNER_RESPONSE, DONE)
#19-25   cleanup: requestedInteraction、metadata 更新
#26 v27  step[7] 最终更新 (包含生成器统计信息)
```

### 每次对话约产生 25-30 条 stream 消息

---

## 六、实际采用的流式方案

既然 stream 不提供文本 delta，我们采用了以下方案实现逐字流式输出：

### 架构

```
StreamCascadeReactiveUpdates (通知有变化)
    ↓
Controller._onStreamChange()  (动态防抖: GENERATING=200ms, 其他=100ms)
    ↓
GetCascadeTrajectory  (拉取完整 steps)
    ↓
diffSteps()  (比较: status变化 + plannerResponse.response 文本变化)
    ↓
event_step_updated  (推送完整 step 给前端, 含最新文字)
    ↓
前端 React 重渲染  (PlannerResponseStep 显示更新后的文字)
```

### 核心改动 (controller.js)

**增强 `diffSteps()`**: 除了比较 `status`，还比较 `plannerResponse.response` 和 `plannerResponse.thinking` 的文本内容。当文字增长时触发 `event_step_updated`。

**动态防抖 `_onStreamChange()`**: 当有 GENERATING 状态的 step 时，防抖缩短到 200ms（更频繁拉取）；其他情况 100ms。

### 效果

- 原来：AI 回复完成后一次性蹦出全文
- 现在：每 ~200ms 推送一次文字更新，前端逐步显示

---

## 七、后续优化方向

| 方向 | 说明 |
|------|------|
| 进一步降低防抖 | 200ms 是保守值，可以尝试 100ms 看 LS 是否能承受 |
| 文本 delta 替代全量推送 | 当前每次推完整 step 对象。可改为只推文字增量（`event_step_text_delta`），减少带宽 |
| 前端打字机效果 | 收到更新后不直接替换文字，而是用动画逐字显示 |
| 研究 stream diff 的未映射字段 | 部分 fieldNumber 含义未知，可能隐藏了有价值的数据 |
| 从 extension.js 系统性导出 proto schema | 用正则批量提取 `newFieldList` 定义，建立完整的 fieldNumber → 字段名映射表 |
