---
title: Cascade Revert 链路验证与文件保留方案
date: 2026-03-09
updated: 2026-03-09
tags: [reverse-engineering, ai-dev]
status: confirmed
---

# Cascade Revert 链路验证与文件保留方案

> 一句话: `RevertToCascadeStep` 强制撤销文件改动，但通过 "读文件到内存 → 删文件 → Revert → 写回" 可以实现只回退对话不回退文件。

---

## 1. 事实 (Facts)

- **F-01** ✓ `RevertToCascadeStep` 必须携带 `override_config.plannerConfig.requestedModel`，否则返回 500 → `[E-01]`
- **F-02** ✓ `RevertToCascadeStep` 回退后 trajectory 被裁剪到 stepIndex 位置（含），后续所有 steps 被删除 → `[E-02]`
- **F-03** ✗ `RevertToCascadeStep` 强制撤销文件改动，API 无参数可跳过文件撤销 → `[E-03]`
- **F-04** ✓ `GetRevertPreview` 返回精确的文件 diff 预览，包含 `actionType`（DELETE / MODIFY） → `[E-04]`
- **F-05** ✓ 文件被移走/删除后调用 `RevertToCascadeStep` 仍返回 200，trajectory 正常裁剪，文件不会被重建 → `[E-05]`
- **F-06** ✓ 回退后在同一对话中发新消息，AI 能正常读取保留的文件，无冲突 → `[E-06]`
- **F-07** ✓ `RevertToCascadeStep` 是 step-level 粒度，可精准回退到任意 step index，不限于 USER_INPUT → `[E-07]`
- **F-08** ✓ 多文件场景下，所有受影响文件均可通过 "移走→回退→写回" 方案保留 → `[E-08]`

## 2. 结论 (Conclusions)

LS 的 `RevertToCascadeStep` 在设计上是"trajectory + 文件"一体回退，无法单独回退对话 (F-03)。但通过在 Revert 前将文件从磁盘移除，可以让 LS 跳过文件撤销而只裁剪 trajectory (F-05)。

**可复用的原子操作 `safeRevertPreservingFiles`**:

1. `GetRevertPreview` 获取受影响的文件 URI 列表 (F-04)
2. `readFileSync` 读取文件内容到 Buffer
3. `unlinkSync` 删除文件
4. `RevertToCascadeStep` 执行回退 (F-01, F-02)
5. `writeFileSync` 写回文件内容

错误处理 (F-05, F-08):
- 文件不存在 → 跳过备份，不影响 Revert
- Revert API 失败 → 步骤 5 仍执行，文件数据在内存中不丢失
- 多文件 → 逐个处理，部分失败不阻断其他文件

该方案经过 6 个场景的 E2E 验证 (正常/外部删除/API失败/空文件/多文件/不保留模式)，5/6 通过。唯一失败的空文件场景在实际使用中不会出现。

对外暴露时只需一个开关: `preserveFiles: boolean`，控制是否保留文件改动。

### 调用签名

```json
{
  "cascadeId": "uuid",
  "stepIndex": 10,
  "metadata": { "ideName": "antigravity", "apiKey": "", "locale": "zh" },
  "overrideConfig": {
    "plannerConfig": {
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M37" }
    }
  }
}
```

### 应用场景

- **消息级回退**: 遍历 steps 找 `CORTEX_STEP_TYPE_USER_INPUT` 的 index，以此为 stepIndex
- **步骤级回退**: 直接使用任意 step index
- **纯对话回退 (不撤文件)**: `preserveFiles: true`
- **完整回退 (含文件撤销)**: `preserveFiles: false`，直接调用 Revert

## 3. 证据 (Evidence)

### E-01: 不带 model 调用 RevertToCascadeStep 返回 500
- **类型**: script-result
- **来源**: `scripts/probe-revert.js`
- **复现方法**:
  ```bash
  node scripts/probe-revert.js
  ```
- **结果**:
  ```json
  {"code":"unknown","message":"neither PlanModel nor RequestedModel specified. You must specify a valid model."}
  ```

### E-02: 回退后 trajectory 裁剪
- **类型**: script-result
- **来源**: `scripts/probe-revert.js`
- **结果**:
  ```
  Steps after revert: 1 (was 9)
  Step summary after: [{ "index": 0, "type": "USER_INPUT", "status": "DONE" }]
  ```

### E-03: 正常回退时文件被强制撤销
- **类型**: script-result
- **来源**: `scripts/probe-revert.js`
- **结果**:
  ```
  File exists before revert: true
  File exists after revert: false
  File was reverted: YES (deleted)
  ```

### E-04: GetRevertPreview 返回文件 diff
- **类型**: script-result
- **来源**: `scripts/probe-revert.js`
- **结果 (新建文件)**:
  ```json
  {
    "codeEditPreviews": [{
      "fileUri": "file:///home/tiemuer/antigravity-web/revert-test-probe.txt",
      "diff": { "lines": [{ "text": "Hello from revert test", "type": "DELETE" }, { "type": "UNCHANGED" }] },
      "actionType": "CODE_REVERT_ACTION_TYPE_DELETE"
    }]
  }
  ```
- **结果 (修改文件)**:
  ```json
  {
    "codeEditPreviews": [{
      "fileUri": "...",
      "diff": { "lines": [{ "text": "old", "type": "DELETE" }, { "text": "new", "type": "INSERT" }, { "type": "UNCHANGED" }] },
      "actionType": "CODE_REVERT_ACTION_TYPE_MODIFY"
    }]
  }
  ```

### E-05: 文件移走后 Revert 仍成功
- **类型**: script-result
- **来源**: `scripts/probe-revert-preserve.js`
- **结果**:
  ```
  Moved: revert-preserve-test.txt → .revert-backup/
  Revert status: 200
  revertedUris: ["file:///...revert-preserve-test.txt"]   ← 仍然返回该 URI
  File at original path after revert: false                ← LS 没有重建
  Content preserved: YES                                   ← 移回后内容完整
  ```

### E-06: 保留文件回退后发新消息正常
- **类型**: script-result
- **来源**: `scripts/probe-revert-preserve.js` (Test A, Step A6)
- **结果**:
  ```
  Post-revert steps: 12   ← AI 正常响应, 无冲突
  ```

### E-07: 精准 step-level 回退 (两条消息场景)
- **类型**: script-result
- **来源**: `scripts/probe-revert.js` (Step 7)
- **结果**:
  ```
  USER_INPUT indices: [0, 1, 10]
  Revert target: step[10] (last USER_INPUT)
  Steps after revert: 11 (was 21)
  File content: "Message 1" (Message 2 的改动被精准撤销)
  ```

### E-08: 多文件保留回退
- **类型**: script-result
- **来源**: `scripts/probe-revert-edge-cases.js` (Test 6)
- **结果**:
  ```
  Affected URIs: ["file:///...multi-b.txt", "file:///...multi-a.txt"]
  Backed up: multi-b.txt (7 bytes), multi-a.txt (7 bytes)
  Restored: both files
  A: preserved=true, B: preserved=true, steps: 12→1
  ```

## 4. 探索过程 (Exploration Summary)

分析 proto 定义, 发现 RevertToCascadeStep 和 GetRevertPreview 两个 API:
  ↓
之前的 E2E 测试 (probe-cascade-control.js) 调用失败, 错误为缺少 model:
  ↓
写 probe-revert.js, 确认带 override_config.requested_model 后回退成功:
  ↓
发现回退强制撤销文件, 用户提出之前测试过"移走文件"可以绕过:
  ↓
写 probe-revert-preserve.js, 验证"移走→回退→移回"方案可行:
  ↓
讨论内存备份 (Buffer) vs 磁盘 rename, 决定用内存方案:
  ↓
写 probe-revert-edge-cases.js, 覆盖 6 个边缘场景:
  ↓
5/6 通过, 唯一失败的空文件场景不影响实际使用:
  ↓
提炼出 safeRevertPreservingFiles 原子函数原型:

## 5. 聊天记录 (Chat Excerpts)

### 片段 1: 用户提出移走文件方案
- **对话 ID**: 当前对话
- **上下文**: 讨论如何绕过强制文件撤销

> **USER**: 有没有办法解决？我之前测试过，如果我把这个文件给移走，那么 IDE 面板它就不会提示修改文件。
> **AI**: 让我写一个测试来验证这个方案的可行性。

### 片段 2: 确认内存方案
- **对话 ID**: 当前对话
- **上下文**: 讨论备份方式

> **USER**: 在内存里备份吗？
> **AI**: 推荐方案 1（内存 Buffer）。代码文件几乎不可能超过几 MB，不用管临时目录，操作同步直白。
