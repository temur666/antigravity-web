# Findings 文档规范

> 用于记录 AI 辅助开发、逆向工程、技术调研中的发现与结论。

---

## 文件约定

- **路径**: `docs/findings/YYMMDD-HHMM-TopicName.md`
- **附件**: `docs/findings/assets/` (统一存放截图、数据文件等)
- **命名**: 日期时间 + 主题英文短名, 如 `260308-1700-GrpcFieldMapping.md`

---

## 文档结构

一份 Findings 文档由以下五层组成, 从具体到综合、从原始到精炼:

```
事实 (Facts)           ← 原子发现, 可独立验证
       ↓
结论 (Conclusions)     ← 综合多条事实, 回答"所以呢"
       ↓
证据 (Evidence)        ← 支撑事实的数据, 含复现方法
       ↓
探索过程 (Exploration) ← AI 尝试路径的流式摘要
       ↓
聊天记录 (Chat)        ← 关键对话片段 + ID 溯源
```

---

## Frontmatter

```yaml
---
title: [主题名称]
date: YYYY-MM-DD
tags: [ai-dev | reverse-engineering | research | general]
status: [draft | confirmed | archived]
---
```

| 字段 | 说明 |
|------|------|
| `title` | 简短主题名 |
| `date` | 文档创建日期 |
| `tags` | 分类标签, 可多选 |
| `status` | `draft` 初稿 / `confirmed` 已验证 / `archived` 归档 |

---

## 第 1 层: 事实 (Facts)

每条事实是一个**原子发现**, 关于目标系统/对象的已确认属性。

### 规则

- 编号: `F-xx` (从 01 递增)
- 标记: ✓ 正面发现 / ✗ 负面发现 (某条路行不通的**原因**, 如果它揭示了目标的属性)
- 引用: 用 `→ [E-xx]` 指向支撑证据

### 格式

```markdown
## 1. 事实 (Facts)

- **F-01** ✓ gRPC stream 的 field_3 是 Unix timestamp → `[E-01]`
- **F-02** ✓ field_7 是嵌套 message, 包含用户元数据 → `[E-02]` `[E-03]`
- **F-03** ✓ 目标 app 启用了 certificate pinning → `[E-04]`
```

### 注意

- 事实必须是**关于目标的**, 不是关于你的方法的
- "mitmproxy 抓不到包" 不是事实; "目标启用了 cert pinning" 才是事实
- 纯方法层面的失败 (如 filter 写错) 记在探索过程, 不提升为事实

---

## 第 2 层: 结论 (Conclusions)

综合多条事实, 给出**可操作的判断**。

### 格式

```markdown
## 2. 结论 (Conclusions)

该 gRPC stream 携带用户会话数据 (F-01, F-02), 包含时间戳和用户元数据。
由于目标 app 启用了 cert pinning (F-03), 无法通过代理抓包,
需使用 Frida hook 在运行时截获明文数据。
```

### 注意

- 结论必须引用事实编号, 说明依据
- 结论回答 "所以呢" / "下一步怎么办"
- 如果事实之间存在矛盾, 在结论中明确指出

---

## 第 3 层: 证据 (Evidence)

每条证据对应一个具体的**数据点**, 支撑一条或多条事实。

### 规则

- 编号: `E-xx` (从 01 递增)
- 类型: `code` | `log` | `screenshot` | `config` | `doc-reference` | `script-result`
- 必须包含来源
- 包含 `reproduction` 字段时, 证据可被独立复现

### 格式

```markdown
## 3. 证据 (Evidence)

### E-01: field_3 解码为时间戳
- **类型**: script-result
- **来源**: scripts/parse_grpc_payload.py
- **复现方法**:
  ```bash
  python scripts/parse_grpc_payload.py --input capture.bin
  ```
- **结果**:
  ```
  field_3: 1709827200 → 2026-03-08T00:00:00Z
  ```

### E-02: field_7 递归解码输出
- **类型**: log
- **来源**: 终端输出
- **内容**:
  ```
  field_7 {
    sub_field_1: "user_abc123"
    sub_field_2: "session_xyz"
  }
  ```
```

---

## 第 4 层: 探索过程 (Exploration Summary)

AI 尝试路径的**流式摘要**, 用 YAML 风格书写。不是固定模板, 是自然的过程记录。

### 格式

```yaml
## 4. 探索过程 (Exploration Summary)

尝试解析 gRPC raw bytes:
  ↓
发现 field_3-6 疑似 varint 编码:
  ↓
用 protobuf 解码脚本跑了一遍, 大部分字段能解出:
  ↓
field_7 始终乱码, 怀疑嵌套 message:
  ↓
改用递归解析, 确认 field_7 内嵌子 message:
  ↓
尝试 mitmproxy 抓包对比 → 走不通, cert pinning:
  ↓
改用 Frida hook, 成功拿到明文数据:
```

### 注意

- 自由叙述, 不需要固定子结构
- 重点记录**转折点**和**方向变化**
- 死胡同记在这里; 如果死胡同揭示了目标属性, 同时提升为事实

---

## 第 5 层: 聊天记录 (Chat Excerpts)

仅保留**关键片段**, 完整记录通过对话 ID 溯源。

### 格式

```markdown
## 5. 聊天记录 (Chat Excerpts)

### 片段 1: 发现 field_7 嵌套结构
- **对话 ID**: `b1e7ca34-6c3c-4102-a9d7-e4053c5e2ac7`
- **上下文**: 讨论 gRPC 字段解析时发现异常字段

> **USER**: field_7 解出来全是乱码, 会不会是嵌套的?
> **AI**: 确实有可能。varint 解码后前几个字节符合 length-delimited
> 类型的特征, 我用递归解析试一下。

### 片段 2: 确认 cert pinning
- **对话 ID**: `...`
- **上下文**: 尝试 mitmproxy 抓包失败后的分析

> **USER**: 为什么一个包都抓不到?
> **AI**: 看日志是 SSL handshake 阶段就断了, 目标 app 大概率用了
> certificate pinning, 需要 Frida 绕过。
```

---

## 完整示例骨架

```markdown
---
title: gRPC Stream 字段映射
date: 2026-03-08
tags: [reverse-engineering]
status: confirmed
---

# gRPC Stream 字段映射

> 一句话: 完成了目标 app gRPC stream 的关键字段解码, 确认了用户会话数据结构。

---

## 1. 事实 (Facts)

- **F-01** ✓ field_3 是 Unix timestamp → `[E-01]`
- **F-02** ✓ field_7 是嵌套 message, 含用户元数据 → `[E-02]` `[E-03]`
- **F-03** ✓ 目标 app 启用了 certificate pinning → `[E-04]`

## 2. 结论 (Conclusions)

该 gRPC stream 携带用户会话数据 (F-01, F-02)...
需使用 Frida hook 绕过 cert pinning (F-03) 获取明文。

## 3. 证据 (Evidence)

### E-01: field_3 时间戳解码
...

## 4. 探索过程 (Exploration Summary)

尝试解析 raw bytes:
  ↓
...

## 5. 聊天记录 (Chat Excerpts)

### 片段 1: ...
```
