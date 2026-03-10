# 任务: conversation 模块 vs LS gRPC API 对齐审计

## 目标

逐行阅读 `lib/core/conversation/` 目录下的 3 个文件（state.js, sync.js, step-normalizer.js）以及它们的测试文件（__tests__/），对照参考文档 `docs/reference/ls-grpc-api.md`，找出所有不合理的地方、潜在 Bug、以及需要更新的内容。

## 审计范围

### 源文件
- `lib/core/conversation/state.js` — 对话状态管理 + CRUD（ConversationStore）
- `lib/core/conversation/sync.js` — 对话数据同步（ConversationSync, Diff 引擎, 轮询）
- `lib/core/conversation/step-normalizer.js` — Step 数据规范化层（LS 原始数据 → 前端 Schema）
- `lib/core/conversation/__tests__/state.test.js`
- `lib/core/conversation/__tests__/sync.test.js`

### 参考文档
- `docs/reference/ls-grpc-api.md` — LS gRPC API 完整参考（149 个 RPC, Step 类型枚举, 请求/响应格式）

## 审计要点

### 1. API 方法名对齐
- state.js 中调用的 gRPC 方法名（如 StartCascade, SendUserCascadeMessage, GetCascadeTrajectory, GetAllCascadeTrajectories 等）是否与 ls-grpc-api.md 中记录的方法名完全一致？
- 有没有拼写错误或者使用了已废弃的方法？
- 有没有遗漏应该使用的 API？

### 2. 请求/响应字段对齐
- 构建请求 body 时的字段名、字段结构是否和文档一致？
- 解析响应数据时访问的字段路径是否正确？
- 有没有硬编码的字段名应该改为常量？

### 3. Step 类型完整性
- step-normalizer.js 中的 `PAYLOAD_KEYS` 和 `NORMALIZERS` 映射是否覆盖了 ls-grpc-api.md 中列出的所有 Step 类型？
- 有没有 LS 新增的 Step 类型但 normalizer 尚未支持？
- 各 normalizer 函数提取的字段是否与 LS 实际返回的字段路径一致？

### 4. 潜在 Bug
- 空值/边界处理是否充分？（null check, optional chaining）
- 异步操作是否有未捕获的 Promise 拒绝？
- 并发安全问题？（多个 subscriber 同时触发 diff）
- 内存泄漏风险？（EventEmitter listener, Map 清理, WebSocket）
- 轮询逻辑的退避策略是否合理？

### 5. 代码质量
- 有没有死代码或未使用的变量/函数？
- 注释与实际代码是否一致？
- 错误处理是否充分？
- 测试覆盖率是否合理？缺少哪些关键测试场景？

## 输出要求

在 `docs/findings/` 目录下创建审计报告：`conversation-api-audit.md`

报告格式：
```markdown
# Conversation 模块 API 对齐审计报告

## 概要
- 审计时间
- 审计范围
- 发现总数

## 发现列表

### [严重] 发现 1: xxx
- 文件: xxx
- 行号: xxx
- 描述: xxx
- 建议修复: xxx

### [中等] 发现 2: xxx
...

### [低] 发现 3: xxx
...

## Step 类型覆盖率矩阵

| Step 类型 | ls-grpc-api.md | step-normalizer.js | 状态 |
|-----------|:-:|:-:|------|
| CORTEX_STEP_TYPE_xxx | OK | OK | 已覆盖 |
| CORTEX_STEP_TYPE_yyy | OK | -- | 缺失 |

## API 方法调用矩阵

| gRPC 方法 | ls-grpc-api.md | state.js | sync.js | 状态 |
|-----------|:-:|:-:|:-:|------|
| StartCascade | OK | OK | -- | 正常 |
| ... | | | | |

## 改进建议
[按优先级排列]
```

## 约束

- 只做分析和报告，**不要修改源代码**
- 报告要基于实际代码内容，不要猜测
- 每个发现都要给出具体文件名和行号
- 严重程度分级：严重（会导致功能异常）/ 中等（可能引发边界问题）/ 低（代码质量/可维护性）

## 完成 Hook

当你完成所有审计工作并写好报告后，执行以下命令通知我：

```bash
node /home/tiemuer/antigravity-web/scripts/yolo-done.js "Conversation 模块 API 对齐审计完成，报告已写入 docs/findings/conversation-api-audit.md"
```

执行此命令后，自动回复将停止，我会收到 Telegram 通知来检阅你的成果。
