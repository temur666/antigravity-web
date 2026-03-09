# LS 逆向工程复盘

> 日期: 2026-03-01 | 基于 LS v1.19.5/1.19.6

## 一、完整过程

**目标：找到 LS 中"用户批准命令"的 API，实现自动批准**

### Phase 1: 数据收集（已知 → 未知）

```
[已有文档] ls-grpc-api.md 列出了 ~140 个方法名
    ↓ 锁定候选
[候选筛选] HandleCascadeUserInteraction / ResolveOutstandingSteps / AcknowledgeCodeActionStep
    ↓ 空请求探测
[黑盒测试] 三个 API 均返回 "run state not found"（无 RUNNING 对话时）
    ↓ 需要真实场景
```

### Phase 2: 数据结构分析（从历史对话挖掘）

```
[历史轨迹] 遍历所有 IDLE 对话的 RUN_COMMAND step
    ↓ 发现关键字段
[字段发现] runCommand.shouldAutoRun / autoRunDecision / SafeToAutoRun
    ↓ 对比分析
[规律总结] SafeToAutoRun=false 时 shouldAutoRun=undefined → 需要用户批准
           EAGER 策略无法覆盖模型的 SafeToAutoRun=false
```

### Phase 3: 首版实现 + 失败

```
[v1 脚本] 检测 CORTEX_STEP_STATUS_PENDING → 调用 ResolveOutstandingSteps
    ↓ 实测失败
[关键发现] 实际等待状态是 CORTEX_STEP_STATUS_WAITING（不是 PENDING）
           step 有 requestedInteraction 字段：{ runCommand: {} }
           ResolveOutstandingSteps 返回 200 但不生效
```

### Phase 4: API 参数逆向

```
[HandleCascadeUserInteraction 探测]
  - 随意传参 → "input not registered for step 0"
  - stepIndex 始终被读为 0 → 参数放错了位置
    ↓ 需要知道正确的 proto 结构

[extension.js 逆向]（3.8MB 的 minified JS）
  - Select-String 搜索 proto 类定义
  - 找到 HandleCascadeUserInteractionRequest:
      field 1: cascade_id (string)
      field 2: interaction (CascadeUserInteraction)
  - 找到 CascadeUserInteraction:
      field 1: trajectory_id (string)
      field 2: step_index (uint32)
      oneof interaction:
        field 5: run_command (CascadeRunCommandInteraction)
        field 19: file_permission (...)
  - 找到 CascadeRunCommandInteraction:
      field 1: confirm (bool)     ← 真正的开关
      field 2: proposed_command_line (string)
    ↓

[最终请求格式]
{
  cascadeId: "...",
  interaction: {
    trajectoryId: "...",
    stepIndex: N,
    runCommand: { confirm: true, proposedCommandLine: "..." }
  }
}
    ↓ 实测通过
```

---

## 二、关键收获

| # | 收获 | 说明 |
|---|------|------|
| 1 | **WAITING 是独立状态** | 不在已有 StepStatus 枚举中。等待用户交互的 step 用的是 `CORTEX_STEP_STATUS_WAITING`，而非预期的 PENDING |
| 2 | **requestedInteraction 是信号** | step 上出现这个字段说明需要用户交互。它是一个 oneof 结构，`{ runCommand: {} }` 表示等待命令批准 |
| 3 | **proto 定义藏在 extension.js** | LS 二进制（Go 编译）的字符串搜索噪音太大。反而 extension.js 里的 protobuf-es 运行时定义更干净，`newFieldList` 直接暴露了所有字段名和类型 |
| 4 | **CascadeUserInteraction 是完整的交互协议** | 不只是命令批准。它覆盖了所有用户交互类型：run_command / file_permission / deploy / browser_action / mcp / send_command_input 等 |
| 5 | **T:8=bool, T:9=string, T:13=uint32** | protobuf 的 field type 编码，在 extension.js 里统一用 `T:N` 表示 |
| 6 | **ResolveOutstandingSteps 看似成功实则无效** | 返回 200 空 body 不代表真的做了事。这是 gRPC 探测中的常见陷阱 |

---

## 三、方法论提炼

### 黑盒探测三步法

1. **空请求** → 看错误消息（判断 API 是否存在、需要什么参数）
2. **带参请求** → 看错误消息变化（判断参数是否被识别）
3. **错误消息中的关键词** → 反向推断正确结构

### 逆向 protobuf 最佳路径

- **不推荐**: Go 二进制字符串搜索 → 噪音大，上下文碎片化
- **推荐**: extension.js 中的 `proto3.util.newFieldList` → 完整字段定义，机器可读

---

## 四、CascadeUserInteraction 完整交互类型

从 extension.js 逆向得到的 oneof 结构：

| field | 交互类型 | 说明 |
|-------|---------|------|
| 5 | `run_command` | 命令执行批准。含 `confirm` (bool) + `proposedCommandLine` (string) |
| 19 | `file_permission` | 代码修改批准。当 `artifactReviewMode` 非 Turbo 时触发 |
| 4 | `deploy` | 部署确认 |
| 6 | `browser_action` | 浏览器操作批准 |
| 13 | `open_browser_url` | 打开浏览器 URL 批准 |
| 16 | `send_command_input` | 向运行中的命令发送输入（如 y/n 确认） |
| 18 | `mcp` | MCP 工具调用确认 |

### HandleCascadeUserInteraction 请求格式

```javascript
{
    cascadeId: "uuid",
    interaction: {
        trajectoryId: "uuid",   // 从 GetCascadeTrajectory 获取
        stepIndex: 5,           // WAITING 的 step 索引
        runCommand: {           // oneof: 对应 requestedInteraction 的类型
            confirm: true,
            proposedCommandLine: "npm install"
        }
    }
}
```

---

## 五、还可以挖掘的方向

| 方向 | 价值 | 难度 |
|------|------|------|
| `file_permission` 交互 | 当 artifactReviewMode 非 Turbo 时，代码修改也需要批准。结构类似 runCommand，field 19 | 低 |
| `deploy` 交互 | field 4，可能用于部署确认 | 中 |
| `send_command_input` 交互 | field 16，可能用于向运行中的命令发送输入（比如 y/n 确认） | 高价值 |
| `mcp` 交互 | field 18，MCP 工具调用确认 | 中 |
| `browser_action` / `open_browser_url` | field 6/13，浏览器操作批准 | 中 |
| `StreamCascadeReactiveUpdates` | 用 streaming 替代轮询，实时检测 WAITING step，延迟从 2s 降到 ~0s | 高价值 |
| 完整 proto schema 导出 | 系统性地从 extension.js 提取所有 proto 定义，生成 .proto 文件 | 高价值 |
| `GetUserSettings` / `SetUserSettings` | 可能能远程修改 autoExecutionPolicy，从根源上消除批准需求 | 高价值 |
| `CancelCascadeInvocation` | 远程取消正在执行的对话 | 中 |
| `RevertToCascadeStep` | 远程回退到某个步骤 | 中 |

---

## 六、已知局限

| 局限 | 说明 | 可能的优化 |
|------|------|-----------|
| 轮询模式 | 每 2 秒一次，最大延迟 2 秒 | 使用 `StreamCascadeReactiveUpdates` 做实时检测 |
| 只处理 runCommand | file_permission 等其他交互类型还需要补充 | 逐步添加 |
| LS 重启发现延迟 | 默认等 5 分钟重新发现 | 检测到 gRPC 错误时立即触发重新发现 |
