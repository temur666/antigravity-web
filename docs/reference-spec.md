# Reference 文档规范

> 用于维护持续更新的技术参考手册, 如 API 文档、数据结构字典、协议说明等。

---

## 与 Findings 的区别

- **Findings** = 一次性探索快照, 回答"怎么发现的", 带时间戳, 不再修改
- **Reference** = 持续更新的活文档, 回答"这个东西是什么", 不带时间戳, 反复修改

```
Findings (探索记录)
  → 产出事实和结论
    → 沉淀为 Reference (参考手册)
```

---

## 文件约定

- **路径**: `docs/reference/topic-name.md`
- **命名规则**:
  - kebab-case, 全小写, 短横线分隔
  - 不带日期 (因为是活文档)
  - 2-4 个英文词, 描述主题
  - 示例: `ls-grpc-api.md`, `step-raw-fields.md`, `connect-streaming-protocol.md`
- **禁用表格**: 所有结构化信息用列表表达

---

## Frontmatter

```yaml
---
title: [主题名称]
source: [数据来源, 如 "LS v1.19.6 二进制逆向" 或 "官方文档"]
updated: YYYY-MM-DD
---
```

- `title` — 主题名
- `source` — 数据从哪来的, 方便追溯可信度
- `updated` — 最后修改日期

---

## 文档结构

Reference 没有固定的层级模板。根据内容选择合适的组织方式, 但需遵循以下规则:

### 规则

1. **按功能分组, 用 h2/h3 标题分层**
2. **列表格式展示条目**, 不使用表格
3. **已验证条目标记 ✅**, 未验证的不标记
4. **已验证条目链接回对应 Findings**, 格式: `[✅](../findings/YYMMDD-topic-name.md)`
5. **代码示例用 fenced code block**, 标注语言
6. **注意事项用 blockquote** (`> `)

### 条目格式

API / 方法列表:
```markdown
- `MethodName` — 简要说明 [✅](../findings/260301-topic.md)
- `AnotherMethod` — 简要说明
```

数据结构:
```markdown
### payloadKey: `fieldName`

- `subField` (string) — 说明
- `anotherField` (number) — 说明
  > 注意: 这个字段是字符串类型的数字, 需 parseInt() 转换
```

枚举值:
```markdown
### 状态枚举

- `STATUS_IDLE` — 空闲
- `STATUS_RUNNING` — 运行中
- `STATUS_UNKNOWN` — 未知
```

---

## 完整示例骨架

```markdown
---
title: LS gRPC API
source: LS v1.19.6 二进制逆向
updated: 2026-03-09
---

# LS gRPC API 参考

> 服务路径: `/exa.language_server_pb.LanguageServerService/{MethodName}`
> 协议: Connect Protocol (JSON over HTTPS)

---

## 1. 对话管理 (Cascade)

### 核心生命周期

- `StartCascade` — 创建新对话, 返回 cascadeId [✅](../findings/260227-start-cascade.md)
- `SendUserCascadeMessage` — 发送用户消息 (流式) [✅](../findings/260228-send-message.md)
- `GetCascadeTrajectory` — 获取完整对话轨迹 [✅](../findings/260228-send-message.md)
- `ConvertTrajectoryToMarkdown` — 导出对话为 Markdown

### 请求/响应示例

#### StartCascade

```json
// 请求: {}
// 响应:
{ "cascadeId": "uuid-string" }
```

---

## 注意事项

> LS 是单进程 Go 服务, 并发过高会导致崩溃
> CSRF Token 随 LS 进程变化, 每次重启后需重新获取
```
