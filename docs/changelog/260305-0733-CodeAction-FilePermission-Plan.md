# CODE_ACTION 主路径攻克计划 — filePermission 正确格式

> 日期: 2026-03-05 | 源对话 ID: `ecd64ce4-18e3-412d-8876-b03d62c7b9fe`
> 状态: **待开发** — 本文档整理了所有已知材料，供下一个窗口继续攻克。

## 一、问题背景

### 当前状态

Agent 完整流程已跑通（无 IDE 环境），但文件编辑走的是 **RUN_COMMAND 备用路径**（命令行 `echo > file`），而非 **CODE_ACTION 主路径**（直接 diff apply）。

```
PLANNER_RESPONSE → CODE_ACTION(WAITING) → 审批 → ERROR("user denied file access")
                                                  → 退回 → RUN_COMMAND(EAGER 自动执行) → 成功
```

### 为什么需要打通 CODE_ACTION

- CODE_ACTION 是 Agent 创建/编辑文件的主力工具（支持 `createFile`、`editFile` diff apply）
- RUN_COMMAND 只能做简单的 echo，不适合复杂的代码编辑
- 打通后 Agent 的文件操作能力将与 IDE 内完全一致

## 二、已有材料

### 2.1 测试结果（关键日志）

**测试脚本**: [test-agent-file-ops.js](file:///home/tiemuer/antigravity-web/scripts/test-agent-file-ops.js)

CODE_ACTION step 的完整数据结构（从 GetCascadeTrajectory 获取）：

```json
{
  "type": "CORTEX_STEP_TYPE_CODE_ACTION",
  "status": "CORTEX_STEP_STATUS_ERROR",
  "error": {
    "userErrorMessage": "User denied permission to access to file:///tmp/antigravity-agent-test.txt.",
    "shortError": "user denied file access"
  },
  "permissions": {
    "fileAccessPermissions": [{
      "path": "file:///tmp/antigravity-agent-test.txt",
      "fromCurrentStep": true
    }]
  },
  "codeAction": {
    "actionSpec": {
      "createFile": {
        "instruction": "Hello from Antigravity Agent",
        "path": { "absoluteUri": "file:///tmp/antigravity-agent-test.txt" },
        "overwrite": true
      }
    },
    "actionResult": {},
    "useFastApply": true,
    "filePermissionRequest": {
      "absolutePathUri": "/tmp/antigravity-agent-test.txt",
      "blockReason": "BLOCK_REASON_OUTSIDE_WORKSPACE"
    },
    "description": "创建临时测试文件"
  }
}
```

关键发现：
1. `BLOCK_REASON_OUTSIDE_WORKSPACE` — `/tmp/` 不在工作区范围内
2. 改用工作区内路径后（`/home/tiemuer/antigravity-web/tmp/`），依然失败
3. 失败原因变为 `"user denied file access"` — 说明我们的审批格式不对

### 2.2 当前审批调用（不正确）

```javascript
await grpcCall(PORT, CSRF, 'HandleCascadeUserInteraction', {
    cascadeId: cid,
    interaction: {
        trajectoryId: trajectoryId,
        stepIndex: 5,
        filePermission: { approve: true }  // ← 格式不对
    }
}, 10000);
```

审批返回了 `{}`（200 OK），但 LS 内部将此解读为 **"用户拒绝"**。

### 2.3 逆向工程文档

**关键参考**: [ls-reverse-engineering.md](file:///home/tiemuer/antigravity-web/docs/ls-reverse-engineering.md)

已知的 CascadeUserInteraction 结构：

| field | 交互类型 | 说明 |
|-------|---------|------|
| 5 | `runCommand` | 已验证正确。`{ confirm: true, proposedCommandLine: "..." }` |
| **19** | **`filePermission`** | **待逆向**。代码修改批准 |
| 4 | `deploy` | 部署确认 |
| 6 | `browser_action` | 浏览器操作 |
| 18 | `mcp` | MCP 工具调用 |

`runCommand` 的正确格式已确认：
```javascript
interaction.runCommand = { confirm: true, proposedCommandLine: "npm install" }
```

## 三、攻克路线

### 3.1 逆向 filePermission 的 proto 定义

**方法**: 从 extension.js（3.8MB minified JS）中搜索 `filePermission` 或 field 19 的定义。

**搜索路径**: 
```bash
# extension.js 位置（IDE 安装目录中的某个文件）
find ~/.antigravity-server -name "extension.js" -size +1M
```

**搜索关键词**:
```bash
# 在 extension.js 中搜索
grep -o 'file_permission.*confirm\|file_permission.*approve\|field.*19.*file' extension.js
# 或搜索 proto 定义
grep -o 'newFieldList.*filePermission\|T:.*filePermission' extension.js
```

参考 `runCommand` 的逆向方式（见 [ls-reverse-engineering.md](file:///home/tiemuer/antigravity-web/docs/ls-reverse-engineering.md) Phase 4）。

### 3.2 黑盒探测

在 CODE_ACTION WAITING 的状态下，尝试不同的 `filePermission` payload：

```javascript
// 尝试 1: confirm (参考 runCommand)
interaction.filePermission = { confirm: true }

// 尝试 2: accepted
interaction.filePermission = { accepted: true }

// 尝试 3: approved
interaction.filePermission = { approved: true }

// 尝试 4: 带文件路径
interaction.filePermission = { 
  confirm: true, 
  filePath: "file:///path/to/file" 
}

// 尝试 5: 空对象 (可能"有交互就等于同意")
interaction.filePermission = {}
```

每次尝试后观察：
- LS 是否崩溃？
- CODE_ACTION 状态是否从 WAITING → DONE？
- 文件是否被创建？
- 错误消息是否变化？

### 3.3 ext-server 配合

即使审批格式对了，LS 还需要通过 extension server 实际执行文件操作。

需要实现的 ext-server-proto.js 方法（Proto 格式）：

| 方法 | 用途 | 当前状态 |
|------|------|---------|
| `WriteCascadeEdit` | 应用代码编辑（diff） | 返回空 proto |
| `SaveDocument` | 保存文件 | 返回空 proto |

需要逆向这两个方法的 proto 请求格式，解析出文件路径和编辑内容，然后实际写入磁盘。

## 四、环境准备

测试前确保以下组件运行：

```bash
# 1. 启动 proto ext-server
node scripts/ext-server-proto.js &

# 2. 启动 LS daemon (standalone + ext-server)
LS_CSRF_TOKEN=daemon-with-ext-server ./scripts/ls-daemon.sh start &

# 3. 验证
./scripts/ls-daemon.sh status
curl -s http://127.0.0.1:42200/  # ext-server OK
```

测试脚本: [test-agent-file-ops.js](file:///home/tiemuer/antigravity-web/scripts/test-agent-file-ops.js)

## 五、相关文件清单

| 文件 | 说明 |
|------|------|
| [ls-reverse-engineering.md](file:///home/tiemuer/antigravity-web/docs/ls-reverse-engineering.md) | proto 逆向方法论和已知结构 |
| [test-agent-file-ops.js](file:///home/tiemuer/antigravity-web/scripts/test-agent-file-ops.js) | Agent 文件操作测试脚本（含审批逻辑） |
| [ext-server-proto.js](file:///home/tiemuer/antigravity-web/scripts/ext-server-proto.js) | Proto 格式 Extension Server |
| [ext-server.js](file:///home/tiemuer/antigravity-web/scripts/ext-server.js) | JSON 格式 Extension Server（含完整 handler 参考） |
| [ls-daemon.sh](file:///home/tiemuer/antigravity-web/scripts/ls-daemon.sh) | LS Daemon 启动脚本 |
| [ws-protocol.js](file:///home/tiemuer/antigravity-web/lib/core/ws-protocol.js) | WebSocket 协议 + DEFAULT_CONFIG |
| [ls-grpc-api.md](file:///home/tiemuer/antigravity-web/docs/ls-grpc-api.md) | LS gRPC API 完整方法列表 |
