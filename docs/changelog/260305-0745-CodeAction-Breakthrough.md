# CODE_ACTION 主路径突破 -- 文件创建完全打通

> 日期: 2026-03-05 07:45 | 源计划: `260305-0733-CodeAction-FilePermission-Plan.md`
> 状态: **已完成** -- CODE_ACTION(createFile) 全链路成功

## 一、成果

Agent 的 CODE_ACTION 主路径已完全打通。LS 通过 createFile 创建文件时，ext-server 能正确接收 proto 请求并写入磁盘。

```
PLANNER_RESPONSE → CODE_ACTION(createFile, DONE) → WriteCascadeEdit(proto) → 文件写入成功
```

**测试结果**:
- 文件路径: `/home/tiemuer/antigravity-web/tmp/antigravity-agent-test.txt`
- 文件内容: `Hello from Antigravity Agent`
- 状态: **TEST PASSED**

## 二、逆向发现

### 2.1 FilePermissionInteraction (exa.cortex_pb)

从 extension.js 逆向得到 `CascadeUserInteraction.file_permission` (field 19) 的完整结构:

```protobuf
message FilePermissionInteraction {
    bool allow = 1;                              // 是否允许
    PermissionScope scope = 2;                   // 权限范围
    string absolute_path_uri = 3;                // 文件 URI
}

enum PermissionScope {
    PERMISSION_SCOPE_UNSPECIFIED = 0;
    PERMISSION_SCOPE_ONCE = 1;
    PERMISSION_SCOPE_CONVERSATION = 2;
}
```

之前的错误: 用 `{ approve: true }` -- 字段名完全不对。
正确格式: `{ allow: true, scope: 2, absolutePathUri: "file:///..." }`

### 2.2 WriteCascadeEditRequest (exa.extension_server_pb)

```protobuf
message WriteCascadeEditRequest {
    string uri = 1;                // file:// URI
    string target_content = 2;     // 文件完整内容
}
message WriteCascadeEditResponse {} // 空
```

### 2.3 SaveDocumentRequest (exa.extension_server_pb)

```protobuf
message SaveDocumentRequest {
    string uri = 1;                // file:// URI
}
message SaveDocumentResponse {} // 空
```

### 2.4 FilePermissionInteractionSpec (exa.cortex_pb) -- 请求端

```protobuf
message FilePermissionInteractionSpec {
    string absolute_path_uri = 1;
    bool is_directory = 2;
    BlockReason block_reason = 3;
}

enum BlockReason {
    BLOCK_REASON_UNSPECIFIED = 0;
    BLOCK_REASON_OUTSIDE_WORKSPACE = 1;
    BLOCK_REASON_GITIGNORED = 2;
}
```

## 三、关键发现

1. **filePermission 审批在本次测试中没有被触发** -- CODE_ACTION 直接进入 DONE 状态
   - 可能原因: 文件在工作区内 (`/home/tiemuer/antigravity-web/tmp/`) 不是 OUTSIDE_WORKSPACE
   - 或者 `agenticMode: false` 配置下 LS 跳过了 filePermission 审批

2. **WriteCascadeEdit 是文件写入的唯一通道** -- LS 不直接写文件，而是通过 ext-server 的 WriteCascadeEdit RPC

3. **Proto 解码很简单** -- WriteCascadeEditRequest 只有 uri + target_content 两个 string 字段

## 四、修改的文件

| 文件 | 修改内容 |
|------|----------|
| [test-agent-file-ops.js](file:///home/tiemuer/antigravity-web/scripts/test-agent-file-ops.js) | filePermission 审批格式改为 `{ allow, scope, absolutePathUri }` |
| [ext-server-proto.js](file:///home/tiemuer/antigravity-web/scripts/ext-server-proto.js) | 添加 proto 解码工具 + WriteCascadeEdit/SaveDocument 实际写入逻辑 |

## 五、下一步

| 方向 | 优先级 | 说明 |
|------|--------|------|
| 测试 editFile（已存在文件的编辑） | 高 | createFile 已通，editFile 的 diff apply 可能走不同路径 |
| 测试工作区外路径 (如 /tmp/) | 中 | 验证 filePermission 审批格式是否真的正确 |
| ext-server 日志持久化 | 低 | 方便排查问题 |
