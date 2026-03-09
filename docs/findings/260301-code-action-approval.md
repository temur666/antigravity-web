---
title: LS 命令批准 API 逆向
date: 2026-03-01
updated: 2026-03-01
tags: [reverse-engineering]
status: confirmed
---

# LS 命令批准 API 逆向

> 一句话: 逆向找到了 LS 中用户批准命令的 API (HandleCascadeUserInteraction), 并确定了完整的 proto 请求结构。

---

## 1. 事实 (Facts)

- **F-01** ✓ 等待用户交互的 step 状态是 `CORTEX_STEP_STATUS_WAITING`, 不是 PENDING → `[E-01]`
- **F-02** ✓ step 上出现 `requestedInteraction` 字段表示需要用户交互, `{ runCommand: {} }` 表示等待命令批准 → `[E-01]`
- **F-03** ✓ proto 定义藏在 extension.js (3.8MB) 的 protobuf-es 运行时定义中, 比 Go 二进制更干净 → `[E-02]`
- **F-04** ✓ `CascadeUserInteraction` 是完整的交互协议, 覆盖 run_command / file_permission / deploy / browser_action / mcp / send_command_input → `[E-02]`
- **F-05** ✓ protobuf field type 编码: T:8=bool, T:9=string, T:13=uint32 → `[E-02]`
- **F-06** ✗ `ResolveOutstandingSteps` 返回 200 空 body 但实际不生效, gRPC 200 不等于成功 → `[E-03]`
- **F-07** ✗ EAGER 自动执行策略无法覆盖模型设置的 `SafeToAutoRun=false` → `[E-04]`

## 2. 结论 (Conclusions)

要实现命令自动批准, 需要:
1. 检测 `CORTEX_STEP_STATUS_WAITING` + `requestedInteraction` 字段 (F-01, F-02)
2. 调用 `HandleCascadeUserInteraction`, 传入正确的 proto 结构 (F-04)
3. EAGER 策略不够, 必须主动调用 API 来批准 (F-07)

逆向 proto 结构时, 优先搜索 extension.js 中的 `proto3.util.newFieldList`, 而不是 Go 二进制 (F-03)。

## 3. 证据 (Evidence)

### E-01: WAITING 状态的 step 数据
- **类型**: log
- **来源**: `GetCascadeTrajectory` 返回的 RUNNING 对话 step 数据
- **内容**:
  ```json
  {
    "type": "CORTEX_STEP_TYPE_RUN_COMMAND",
    "status": "CORTEX_STEP_STATUS_WAITING",
    "requestedInteraction": { "runCommand": {} }
  }
  ```

### E-02: extension.js 中的 proto 定义
- **类型**: code
- **来源**: extension.js (3.8MB minified), Select-String 搜索 proto 类定义
- **内容**:
  ```
  HandleCascadeUserInteractionRequest:
    field 1: cascade_id (string)
    field 2: interaction (CascadeUserInteraction)

  CascadeUserInteraction:
    field 1: trajectory_id (string)
    field 2: step_index (uint32)
    oneof interaction:
      field 5: run_command (CascadeRunCommandInteraction)
      field 19: file_permission (...)

  CascadeRunCommandInteraction:
    field 1: confirm (bool)
    field 2: proposed_command_line (string)
  ```

### E-03: ResolveOutstandingSteps 无效响应
- **类型**: log
- **来源**: gRPC 调用
- **内容**:
  ```
  ResolveOutstandingSteps → HTTP 200, body: {}
  实际效果: 无, step 仍为 WAITING
  ```

### E-04: SafeToAutoRun 与 EAGER 策略的关系
- **类型**: script-result
- **来源**: 遍历所有 IDLE 对话的 RUN_COMMAND step
- **复现方法**:
  ```bash
  # 遍历历史对话, 对比 SafeToAutoRun 与 shouldAutoRun 的关系
  ```
- **结果**:
  ```
  SafeToAutoRun=false 时 shouldAutoRun=undefined → 需要用户批准
  EAGER 策略无法覆盖模型的 SafeToAutoRun=false
  ```

### E-05: 最终验证通过的请求格式
- **类型**: script-result
- **来源**: gRPC 调用 HandleCascadeUserInteraction
- **内容**:
  ```json
  {
    "cascadeId": "...",
    "interaction": {
      "trajectoryId": "...",
      "stepIndex": 5,
      "runCommand": { "confirm": true, "proposedCommandLine": "npm install" }
    }
  }
  ```

## 4. 探索过程 (Exploration Summary)

```yaml
从 ls-grpc-api.md 的 ~140 个方法中锁定 3 个候选: HandleCascadeUserInteraction / ResolveOutstandingSteps / AcknowledgeCodeActionStep:
  ↓
三个 API 空请求均返回 "run state not found" (无 RUNNING 对话):
  ↓
遍历历史 IDLE 对话的 RUN_COMMAND step, 发现 SafeToAutoRun / shouldAutoRun / autoRunDecision 字段:
  ↓
得出规律: EAGER 策略无法覆盖 SafeToAutoRun=false:
  ↓
写 v1 脚本, 检测 PENDING 状态 → 调用 ResolveOutstandingSteps → 实测失败:
  ↓
关键发现: 实际等待状态是 WAITING 而不是 PENDING, step 有 requestedInteraction 字段:
  ↓
ResolveOutstandingSteps 返回 200 但不生效 → 走不通:
  ↓
转向 HandleCascadeUserInteraction, 随意传参 → "input not registered for step 0":
  ↓
stepIndex 始终被读为 0 → 参数结构放错了位置, 需要知道正确的 proto 结构:
  ↓
逆向 extension.js (3.8MB), Select-String 搜索 proto 类定义:
  ↓
找到 HandleCascadeUserInteractionRequest → CascadeUserInteraction → CascadeRunCommandInteraction 完整链路:
  ↓
构造正确请求格式, 实测通过:
```

## 5. 聊天记录 (Chat Excerpts)

_(本次探索无对应的聊天记录)_

---

## 附录: CascadeUserInteraction 完整交互类型

从 extension.js 逆向得到的 oneof 结构:

- field 5: `run_command` — 命令执行批准, 含 `confirm` (bool) + `proposedCommandLine` (string)
- field 19: `file_permission` — 代码修改批准, 当 `artifactReviewMode` 非 Turbo 时触发
- field 4: `deploy` — 部署确认
- field 6: `browser_action` — 浏览器操作批准
- field 13: `open_browser_url` — 打开浏览器 URL 批准
- field 16: `send_command_input` — 向运行中的命令发送输入 (如 y/n 确认)
- field 18: `mcp` — MCP 工具调用确认

## 附录: 黑盒探测三步法

1. **空请求** → 看错误消息 (判断 API 是否存在、需要什么参数)
2. **带参请求** → 看错误消息变化 (判断参数是否被识别)
3. **错误消息中的关键词** → 反向推断正确结构

## 附录: 还可以挖掘的方向

- `file_permission` (field 19) — 代码修改批准, 结构类似 runCommand, 难度低
- `send_command_input` (field 16) — 向运行中的命令发送输入, 高价值
- `mcp` (field 18) — MCP 工具调用确认, 难度中
- `StreamCascadeReactiveUpdates` — 用 streaming 替代轮询, 延迟从 2s 降到 ~0s, 高价值
- 完整 proto schema 导出 — 从 extension.js 系统性提取所有 proto 定义, 高价值
