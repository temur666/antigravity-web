---
title: LoadTrajectory — 孤儿对话恢复机制
date: 2026-03-10
updated: 2026-03-10
tags: reverse-engineering
status: confirmed
---

# LoadTrajectory — 孤儿对话恢复机制

## 事实 (Facts)

- **F-01** ✓ LS 将对话内容持久化为 `.pb` 文件，路径为 `~/.gemini/antigravity/conversations/<cascadeId>.pb`，所有 LS 实例共用同一目录 → [E-01]
- **F-02** ✓ LS 的"对话索引"（哪些 cascadeId 属于我）是**纯内存维护**的，不持久化到磁盘。进程退出后索引丢失 → [E-02] [E-03]
- **F-03** ✓ `GetAllCascadeTrajectories` 只返回当前 LS 内存索引中的对话，不会扫描磁盘 .pb 文件 → [E-02]
- **F-04** ✓ 对未在内存索引中的 cascadeId 调用 `GetCascadeTrajectory`，LS 返回 `500 trajectory not found`，不会尝试从磁盘读取 → [E-03]
- **F-05** ✓ `.pb` 文件不是原始 Protobuf 格式，`file` 命令识别为 `OpenPGP Public Key`，无法用通用 protobuf 解码器直接解析 → [E-04]
- **F-06** ✓ **`LoadTrajectory({ cascadeId })` 可以让任意 LS 实例从磁盘 .pb 文件重新加载对话到内存索引**，调用后 `GetCascadeTrajectory` 立即可用 → [E-05]
- **F-07** ✓ `LoadTrajectory` 不受账号限制，Daemon LS 可以加载 IDE LS 创建的对话，反之亦然（同一 .gemini 目录下） → [E-05] [E-06]
- **F-08** ✓ 同一台机器上多个 LS 实例（IDE / Daemon）的对话存在 5 个重叠、其余独立的情况。当前环境：Daemon 27 个 + IDE 11 个 + 67 个无主孤儿 = 100 个 .pb 文件 → [E-06]
- **F-09** ✓ `LoadTrajectory` 返回空响应 `{}`，status=200 表示成功。它是 streaming RPC（`stream LoadTrajectoryRequest`） → [E-05]

## 结论 (Conclusions)

- **C-01** "点击对话显示为空"的根因是：`listConversations` 通过 .pb 文件扫描将所有对话列出，但 `getTrajectory` 调用 LS 时，LS 内存索引中没有该对话，直接返回 `trajectory not found`。归档降级也无数据，最终返回空 steps。（综合 F-02, F-03, F-04）
- **C-02** 修复方案：在 `getTrajectory` 检测到 `trajectory not found` 时，自动调用 `LoadTrajectory` 让 LS 从磁盘加载，然后重试 `GetCascadeTrajectory`。这是一个无副作用的幂等操作。（综合 F-06, F-09）
- **C-03** 可选优化：在 `listConversations` 阶段对所有 .pb 扫描到但 LS 不认识的对话，批量调用 `LoadTrajectory` 预加载。这样列表中的 title/stepCount 等元数据也能正确显示。（综合 F-03, F-06）
- **C-04** .pb 文件的加密/编码由 LS binary 内部处理，不在我们控制范围内。不可绕过 LS 直接读取 .pb 内容。（综合 F-05）

## 证据 (Evidence)

### E-01: .pb 文件存储位置与规模

- 类型: `script-result`
- 来源: 文件系统扫描

```
.pb 文件总数: 100
目录: ~/.gemini/antigravity/conversations/
文件大小范围: 144KB ~ 6987KB
```

复现: `ls ~/.gemini/antigravity/conversations/*.pb | wc -l`

### E-02: LS 内存索引 vs 磁盘文件差异

- 类型: `script-result`
- 来源: gRPC API 调用 + 文件系统比对

```
Daemon LS (PID=1308529, Port=42100):
  GetAllCascadeTrajectories 返回对话数: 27
  
IDE LS (PID=1402362, Port=34663):
  GetAllCascadeTrajectories 返回对话数: 11

重叠: 5
两者合并可见: 33
.pb 文件总数: 100
无主孤儿: 67
```

复现: `node /tmp/test-overlap.js`

### E-03: trajectory not found 错误

- 类型: `api-response`
- 来源: Daemon LS gRPC 调用

```
请求: GetCascadeTrajectory({ cascadeId: '3a6a1fc3-...' })
响应: { status: 500, data: { code: "unknown", message: "trajectory not found" } }
```

对应 .pb 文件存在: `3a6a1fc3-8d6b-4a15-bb66-4b1ce5d03513.pb` (1938552 bytes)

### E-04: .pb 文件格式

- 类型: `script-result`
- 来源: file 命令 + hex 分析

```
$ file ~/.gemini/antigravity/conversations/3a6a1fc3-*.pb
→ OpenPGP Public Key

前 64 字节 (hex): c6652731c85092afb5326050...
不是标准 protobuf (预期以 0a 等 field tag 开头)
```

注: 正常可加载的对话 .pb 文件 (336a6765) 也显示相同格式，说明所有 .pb 都是加密/编码的。

### E-05: LoadTrajectory 成功恢复孤儿对话

- 类型: `api-response`
- 来源: Daemon LS gRPC 调用序列

```
Step 1 — 确认不认识:
  GetCascadeTrajectory({ cascadeId: '3a6a1fc3-...' })
  → { code: "unknown", message: "trajectory not found" }

Step 2 — 调用 LoadTrajectory:
  LoadTrajectory({ cascadeId: '3a6a1fc3-...' })
  → { status: 200, data: {} }

Step 3 — 再次获取:
  GetCascadeTrajectory({ cascadeId: '3a6a1fc3-...' })
  → { status: CASCADE_RUN_STATUS_IDLE, steps: 233 }
  *** 成功! ***
```

复现:
```javascript
const { grpcCall } = require('./lib/core/ls/grpc');
// 1. 确认 trajectory not found
await grpcCall(port, csrf, 'GetCascadeTrajectory', { cascadeId });
// 2. 加载
await grpcCall(port, csrf, 'LoadTrajectory', { cascadeId });
// 3. 验证
await grpcCall(port, csrf, 'GetCascadeTrajectory', { cascadeId });
```

### E-06: IDE LS 可访问孤儿对话

- 类型: `script-result`
- 来源: 手动端口探测 + gRPC 调用

```
IDE LS: PID=1402362, Port=34663 (random_port), CSRF=694912a6-...
GetCascadeTrajectory({ cascadeId: '3a6a1fc3-...' })
→ steps: 233
```

说明同一 .gemini 目录下的 .pb 文件可被任意 LS 实例读取，不限于创建者。

## 探索过程 (Exploration Summary)

```yaml
session: 31febf50-e850-4479-8a4d-2afecdc5e97b
duration: ~25 min
path:
  - 用户报告部分对话点击后为空 ↓
  - 检查 req_trajectory 日志，发现两类失败:
    status=undefined/steps=null 和 status=IDLE/steps=0 ↓
  - 初始假设: "不同账号的 LS 有独立加密密钥" ↓
  - 验证 .pb 文件格式 — 发现不是原始 protobuf，
    所有文件（包括可正常加载的）都是加密/编码格式 ↓
  - 统计: LS 认识 27 个，.pb 文件 100 个，73 个孤儿 ↓
  - 发现 IDE LS (PID=1402362) 也在运行，
    通过 /proc/net/tcp 找到其端口 34663 ↓
  - IDE LS 可访问 3a6a1fc3 (233 steps)，
    推翻"账号隔离"假设 → 确认是"进程隔离" ↓
  - 两个 LS 合并只覆盖 33 个，仍有 67 个无主对话 ↓
  - 用户提示检查 LoadTrajectory API ↓
  - 测试 LoadTrajectory → 成功! Daemon LS 加载了孤儿对话 ↓
  - 确认修复方案: getTrajectory 失败时自动 LoadTrajectory + 重试
```

## 聊天记录 (Chat Excerpts)

### 关键验证时刻

对话 ID: `31febf50-e850-4479-8a4d-2afecdc5e97b`

> **USER**: LoadTrajectory 这个 api 有用吗？
>
> **ASSISTANT**: (执行测试)
> ```
> Step 1: GetCascadeTrajectory → trajectory not found
> Step 2: LoadTrajectory → 200 {}
> Step 3: GetCascadeTrajectory → status=IDLE, steps=233
> *** LoadTrajectory 成功让 LS 认领了这个对话! ***
> ```

### Proto 定义

```protobuf
message LoadTrajectoryRequest {
  string cascade_id = 1;
}
message LoadTrajectoryResponse {}

// streaming RPC
rpc LoadTrajectory (stream LoadTrajectoryRequest) 
  returns (LoadTrajectoryResponse);
```
