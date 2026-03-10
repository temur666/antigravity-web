---
description: YOLO 自动驾驶模式 — 无人值守的长时间 AI 任务执行
---

# YOLO 模式

自动驾驶模式，让 AI 根据参考文档独立工作，无需人工干预。

## 使用方法

### 1. 准备参考文档

创建一个 `.md` 文件，描述你希望 AI 完成的任务。文件内容完全自由，但建议包含：

- 任务目标
- 参考资料 / 上下文
- 约束条件
- 完成 Hook（见下方模板）

**参考文档模板：**

```markdown
# 任务: [你的任务名称]

## 目标
[描述你希望 AI 完成什么]

## 参考资料
[相关文件路径、API 文档、代码位置等]

## 约束
- [约束 1]
- [约束 2]

## 完成 Hook

当你完成所有工作后，执行以下命令通知我：

\```bash
node /home/tiemuer/antigravity-web/scripts/yolo-done.js "你的工作摘要"
\```

执行此命令后，自动回复将停止，我会收到 Telegram 通知来检阅你的成果。
```

### 2. 启动 YOLO 模式

```bash
# 基本用法
node scripts/yolo.js docs/tasks/my-task.md

# 带 agentic 模式（AI 可以执行命令、编辑文件）
node scripts/yolo.js docs/tasks/my-task.md --agentic

# 自定义超时（1 小时）
node scripts/yolo.js docs/tasks/my-task.md --timeout 3600

# 复用已有对话
node scripts/yolo.js docs/tasks/my-task.md --cascade <cascadeId>

# 完整选项
node scripts/yolo.js docs/tasks/my-task.md \
  --timeout 7200 \
  --port 42100 \
  --csrf daemon-with-ext-server \
  --cooldown 5 \
  --poll-interval 3 \
  --agentic
```

### 3. 运行中

- AI 阅读参考文档后会开始工作
- 每当 AI 完成一轮并等待回复时，系统自动发送模板消息
- 所有对话记录保存在 `logs/yolo-<timestamp>.log`

### 4. 结束条件

| 条件 | 触发方式 |
|------|---------|
| AI 主动完成 | AI 执行 `yolo-done.js` → 写标记文件 → 停止自动回复 → Telegram 通知 |
| 超时 | 达到 `--timeout` 设定的时长 → 自动停止 → Telegram 通知 |
| 连续错误 | gRPC 连续 10 次错误 → 自动停止 → Telegram 通知 |
| 手动停止 | Ctrl+C 终止脚本 |

## 自动回复模板

每轮 AI 完成后，系统自动发送的固定消息：

> 继续你的工作，自行判断所有决策。
> - 遇到错误：分析原因，尝试解决，解决不了就跳过并记录
> - 产品决策：从用户价值角度思考
> - 技术决策：从架构合理性角度思考
> - 完成所有工作后：按照参考文档中的完成 Hook 执行

## 文件结构

```
scripts/
  yolo.js        — 主循环（gRPC 对话 + 自动回复 + 日志 + 超时 + 重连）
  yolo-done.js   — Hook（写 .yolo-done 标记 + Telegram 通知）
logs/
  yolo-*.log     — 每次运行的对话日志
.yolo-done       — 完成标记文件（运行时自动清理和创建）
```

## 注意事项

- 启动前确保 LS daemon 正在运行（`scripts/ls-daemon.sh`）
- 每次启动会自动清理上一次的 `.yolo-done` 标记文件
- 日志文件按时间戳命名，不会覆盖
- Telegram 通知需要 `TG_BOT_TOKEN` 和 `TG_USER_ID` 配置正确（已在 `lib/telegram/config.js`）
