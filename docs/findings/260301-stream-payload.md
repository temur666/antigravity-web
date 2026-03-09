---
title: Stream Payload 分析
date: 2026-03-01
updated: 2026-03-01
tags: [reverse-engineering]
status: confirmed
---

# Stream Payload 分析

> 一句话: StreamCascadeReactiveUpdates 推送 protobuf 结构 diff, 不含文本增量, 需要 stream 通知 + 轮询实现逐字输出。

---

## 1. 事实 (Facts)

- **F-01** ✓ stream 消息只有 `version` (递增数字字符串) + `diff` (protobuf field-level diff) 两个字段 → `[E-01]`
- **F-02** ✓ diff 使用 protobuf field number 标识字段, 不使用字段名 → `[E-01]`
- **F-03** ✗ stream 不提供 token-level 文本流, `plannerResponse.response` 的文字增量没有出现在 diff 中 → `[E-02]`
- **F-04** ✓ 一次简单对话约产生 25-30 条 stream 消息 → `[E-03]`
- **F-05** ✓ diff 值类型: stringValue / enumValue / int32Value / boolValue / messageValue / updateRepeated → `[E-01]`
- **F-06** ✓ 顶层 field number 映射: f1=cascadeId, f2=trajectory, f3=status, f4=requestedInteraction → `[E-04]`
- **F-07** ✓ step type 枚举映射: E14=USER_INPUT, E23=PLANNER_RESPONSE, E17=ERROR_MESSAGE → `[E-04]`

## 2. 结论 (Conclusions)

`StreamCascadeReactiveUpdates` 无法直接实现逐字输出 (F-03), 因为 AI 回复文本不在 diff 中。

最终采用 stream 通知 + 动态防抖轮询方案:
- stream 通知"有变化" → 触发 `GetCascadeTrajectory` 拉取全量 (F-01)
- GENERATING 状态时防抖 200ms, 其他 100ms
- `diffSteps()` 比较 `plannerResponse.response` 文本变化, 有增长时推送 `event_step_updated`
- 效果: 从"完成后一次性蹦出全文"变为"每 ~200ms 推送一次文字更新"

stream 的 protobuf diff 格式 (F-02, F-06) 还有未映射字段, 后续可深入挖掘。

## 3. 证据 (Evidence)

### E-01: stream 消息结构示例
- **类型**: script-result
- **来源**: tools/probe-stream-payload.js
- **复现方法**:
  ```bash
  node tools/probe-stream-payload.js
  ```
- **结果**:
  ```json
  {
    "version": "27",
    "diff": {
      "fieldDiffs": [{
        "fieldNumber": 2,
        "updateSingular": {
          "messageValue": {
            "fieldDiffs": [{
              "fieldNumber": 2,
              "updateRepeated": {
                "newLength": 8,
                "updateValues": [...]
              }
            }]
          }
        }
      }]
    }
  }
  ```

### E-02: AI 回复过程的 stream 输出
- **类型**: script-result
- **来源**: tools/probe-stream-v2.js
- **复现方法**:
  ```bash
  node tools/probe-stream-v2.js
  ```
- **结果**:
  ```
  AI 生成回复期间, stream 推送:
  - step 的新增/删除 (updateRepeated 的 newLength 变化)
  - step 的 status 变化 (enumValue 从 GENERATING 变为 DONE)
  - metadata 更新
  但 plannerResponse.response 的文字增量没有出现在 diff 中。
  ```

### E-03: 典型消息序列
- **类型**: log
- **来源**: tools/probe-stream-payload.js, 发送 "1+1等于几"
- **内容**:
  ```
  #1  v2   [初始快照] cascadeId, trajectory 初始化
  #2  v3   status → RUNNING (E2)
  #6  v7   step[0] 新增 (USER_INPUT, E14)
  #16 v17  step[5] 新增 (PLANNER_RESPONSE, E23, status=GENERATING)
  #17 v18  status → IDLE (E1)
  #18 v19  step[7] 更新 (PLANNER_RESPONSE, DONE)
  #26 v27  最终更新 (生成器统计信息)
  共 ~25 条消息
  ```

### E-04: field number 映射推断
- **类型**: script-result
- **来源**: 对比 LS JSON 字段名和 stream field number
- **内容**:
  ```
  顶层 (CascadeRunState):
  - f1 = cascadeId (值是 UUID 字符串)
  - f2 = trajectory (含 steps, generatorMetadata)
  - f3 = status (E1=IDLE, E2=RUNNING)
  - f4 = requestedInteraction

  step (f2.f2[N]):
  - f1 = type (E14=USER_INPUT, E23=PLANNER_RESPONSE)
  - f4 = status (E2=GENERATING, E3=DONE)
  - f19 = userInput payload
  - f24 = error info
  ```

## 4. 探索过程 (Exploration Summary)

```yaml
antigravity-web 的 StreamClient 已使用 StreamCascadeReactiveUpdates, 但只读 version 字段:
  ↓
想知道 stream 消息里是否有文本 delta, 能否直接用于逐字输出:
  ↓
写 probe-stream-payload.js, 打印每条 stream 消息的完整 JSON:
  ↓
发现消息只有 version + diff, diff 是 protobuf field number 格式:
  ↓
写 probe-stream-v2.js, 递归解析 fieldDiffs, 输出人类可读的字段路径:
  ↓
对比 LS API 的 JSON 字段名和 stream field number, 推断出映射关系:
  ↓
关键发现: plannerResponse.response 的文字增量不在 diff 中 → stream 无法直接用于逐字输出:
  ↓
设计替代方案: stream 通知 + 动态防抖 + GetCascadeTrajectory 轮询 + diffSteps 文本比较:
  ↓
实现并验证, 效果从"一次性蹦出"变为"每 ~200ms 更新":
```

## 5. 聊天记录 (Chat Excerpts)

_(本次探索无对应的聊天记录)_

---

## 附录: 探测脚本

两个探测脚本存放在 `tools/` 目录:

- `tools/probe-stream-payload.js` — 打印每条 stream 消息的完整 JSON
- `tools/probe-stream-v2.js` — 递归解析 fieldDiffs, 输出人类可读的字段路径

> 注意: 两个脚本都会创建新对话并发送消息, 消耗少量配额。

## 附录: 最终采用的流式架构

```
StreamCascadeReactiveUpdates (通知有变化)
  ↓
Controller._onStreamChange() (动态防抖: GENERATING=200ms, 其他=100ms)
  ↓
GetCascadeTrajectory (拉取完整 steps)
  ↓
diffSteps() (比较: status 变化 + plannerResponse.response 文本变化)
  ↓
event_step_updated (推送完整 step 给前端, 含最新文字)
  ↓
前端 React 重渲染
```

## 附录: 后续优化方向

- 进一步降低防抖 — 200ms 是保守值, 可尝试 100ms
- 文本 delta 替代全量推送 — 只推文字增量 (`event_step_text_delta`)
- 前端打字机效果 — 收到更新后动画逐字显示
- 研究 stream diff 未映射字段 — 可能隐藏了有价值的数据
- 从 extension.js 系统性导出 proto schema — 建立完整 fieldNumber → 字段名映射
