# Minified JS Protobuf 逆向工程手册

> 适用场景: 从 webpack 打包的 minified JS (如 VSCode extension.js) 中提取 protobuf 定义、API 调用链和业务逻辑。
> 基于: Antigravity LS extension.js (3MB) 的多次实战经验。

---

## 一、入口定位

### 1.1 找到目标文件

```bash
# 按大小找 (extension.js 通常 > 1MB)
find ~/.antigravity-server -name "extension.js" -size +1M

# 按版本找
ls ~/.antigravity-server/bin/*/extensions/antigravity/dist/
```

### 1.2 确认文件可用

```bash
# 查看大小和行数
wc -l -c extension.js
# 典型值: 1 行, 3MB+ (webpack 打包的单行文件)
```

---

## 二、Proto 定义提取

### 2.1 核心原理

protobuf-es 运行时会在 JS 中生成 `fileDesc()` 调用，包含 **base64 编码的 proto FileDescriptorProto**。这比 Go 二进制中的字符串搜索干净得多。

### 2.2 定位 proto 描述符

```bash
# 找到所有 proto 文件的 fileDesc 注册
grep -oP 'file_exa_\w+=\(0,i\.fileDesc\)\("[^"]{20}' extension.js
```

输出示例:
```
file_exa_language_server_pb_language_server=(0,i.fileDesc)("CixleGEvbGFuZ3VhZ2V...
file_exa_extension_server_pb_extension_server=(0,i.fileDesc)("CjRleGEvZXh0ZW5z...
file_exa_cortex_pb_cortex=(0,i.fileDesc)("Chxl...
```

### 2.3 提取 base64 并解码

```python
import re, base64

with open('extension.js', 'r') as f:
    content = f.read()

# 提取指定 proto 文件的 base64
pattern = r'file_exa_language_server_pb_language_server=\(0,i\.fileDesc\)\("([^"]+)"'
match = re.search(pattern, content)
b64 = match.group(1)

# 解码 (可能需要补 padding)
for padding in ['==', '=', '']:
    try:
        data = base64.b64decode(b64 + padding)
        break
    except:
        continue

print(f'Decoded {len(data)} bytes')
```

### 2.4 从解码数据中读取消息定义

解码后的是 protobuf 的 `FileDescriptorProto` 二进制格式。可以直接搜索可读字符串:

```python
# 搜索消息名
keyword = b'AddTrackedWorkspace'
idx = data.find(keyword)
if idx >= 0:
    start = max(0, idx - 100)
    end = min(len(data), idx + 300)
    chunk = data[start:end]
    # 打印可读字符 + 字段编号
    printable = ''.join(
        chr(b) if 32 <= b < 127 else f'[{b}]'
        for b in chunk
    )
    print(printable)
```

### 2.5 解读字段定义

解码后的文本中，字段定义遵循固定模式:

```
[field_number_tag][10][name_length]field_name[24][field_number] [1]([type])
```

类型编码 (protobuf wire types):

| 编码 | proto 类型 |
|------|-----------|
| `([8]` | bool |
| `([9]` | string |
| `([4]` | uint64 |
| `([5]` | int32 |
| `([13]` | uint32 |
| `([14]` | enum |
| `([11]` | message (后跟类型引用) |

示例解读:
```
"i[10][26]AddTrackedWorkspaceRequest
 [18][17][10][9]workspace[24][1] [1]([9]        → field 1: workspace (string)
 [18][26][10][18]do_not_watch_files[24][2] [1]([8]  → field 2: do_not_watch_files (bool)
 [18][28][10][20]is_passive_workspace[24][3] [1]([8] → field 3: is_passive_workspace (bool)
```

### 2.6 Message 编号与 Schema 映射

extension.js 中的 `messageDesc()` 调用将消息名映射到编号:

```bash
grep -oP 't\.\w+Schema=\(0,i\.messageDesc\)\(t\.file_exa_\w+,\d+\)' extension.js
```

输出:
```
t.AddTrackedWorkspaceRequestSchema=(0,i.messageDesc)(t.file_exa_language_server_pb_language_server,64)
```

这意味着 `AddTrackedWorkspaceRequest` 是该 proto 文件中的第 64 个消息定义。

---

## 三、API 调用链追踪

### 3.1 搜索方法调用

```bash
# 精确搜索方法名 (区分大小写)
grep -c "AddTrackedWorkspace" extension.js

# 带上下文搜索
grep -oP '.{0,200}AddTrackedWorkspace.{0,200}' extension.js
```

**关键判断**: 如果方法名只出现在 Schema 定义中 (出现 1 次)，说明 IDE 从未调用该 API。如果出现多次，后续出现的就是实际调用点。

### 3.2 追踪启动/初始化流程

```bash
# LS 启动链
grep -oP '.{0,300}startLanguageServer.{0,300}' extension.js

# Extension Server 连接
grep -oP '.{0,200}reconnectExtensionServer.{0,200}' extension.js

# LSP 初始化
grep -oP '.{0,300}createLspClient.{0,300}' extension.js

# 命令行参数构建
grep -oP '.{0,100}(--workspace|--extension_server_port|--enable_lsp).{0,300}' extension.js
```

### 3.3 追踪工具函数实现

```bash
# 找函数定义 (通常是 exports.functionName = ...)
grep -oP 'getWorkspaceID.{0,500}' extension.js | head -5

# 找类方法 (通常是 methodName(args){...})
grep -oP 'createLspClient\(e,t\)\{.{0,800}' extension.js | head -3
```

### 3.4 追踪命令注册

```bash
# IDE 命令注册 (registerCommand)
grep -oP '.{0,100}registerCommand.{0,100}SET_WORKING.{0,100}' extension.js

# 判断: 如果只有 registerCommand 没有 executeCommand，说明该命令只是被注册了但没主动调用
```

---

## 四、进程运行时分析

### 4.1 查看 LS 进程参数

```bash
# 列出所有 LS 进程及完整参数
ps aux | grep language_server | grep -v grep

# 更精确的参数读取
cat /proc/<pid>/cmdline | tr '\0' '\n'
```

### 4.2 对比多实例差异

典型场景: IDE LS vs Daemon LS，重点对比:

- `--enable_lsp` (是否启用 LSP)
- `--extension_server_port` (Extension Server 端口)
- `--persistent_mode` (持久化模式)
- `--workspace_id` (工作区标识)
- `--parent_pipe_path` (IPC 管道)

### 4.3 端口监听检查

```bash
ss -tlnp | grep <port>
```

### 4.4 日志分析

```bash
# IDE LS 日志: 通常在 .antigravity-server 目录
tail -50 ~/.antigravity-server/.<commit-hash>.log

# Daemon LS 日志: 取决于启动配置
# persistent_mode 时写入 getLogFilePath(workspaceId) 的路径
```

---

## 五、黑盒 API 探测

### 5.1 三步探测法

```
1. 空请求 → 看错误消息 (判断 API 是否存在、需要什么参数)
2. 带参请求 → 看错误消息变化 (判断参数是否被识别)
3. 错误消息中的关键词 → 反向推断正确结构
```

### 5.2 标准探测命令

```bash
# 空请求探测
curl -s -X POST "https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>" \
  -H "Content-Type: application/json" \
  -H "connect-protocol-version: 1" \
  -H "x-codeium-csrf-token: <token>" \
  -d '{}' --insecure

# 带参探测
curl -s -X POST "https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>" \
  -H "Content-Type: application/json" \
  -H "connect-protocol-version: 1" \
  -H "x-codeium-csrf-token: <token>" \
  -d '{"workspace": "file:///home/tiemuer"}' --insecure
```

### 5.3 常见错误消息解读

| 错误消息 | 含义 |
|---------|------|
| `run state not found` | 需要活跃的 RUNNING 对话 |
| `input not registered for step 0` | 参数结构错误，stepIndex 放错位置 |
| 200 + 空 body | 调用成功但可能无效果 (如 ResolveOutstandingSteps) |

---

## 六、Extension Server 协议探测

### 6.1 原理

LS 会主动调用 Extension Server 的方法。搭建一个轻量 HTTP 服务器，记录所有请求即可发现 LS 需要哪些能力:

```javascript
// 核心: 未知方法返回空 JSON
if (!handlers[method]) {
    console.log(`UNIMPLEMENTED: ${method}`, JSON.stringify(body).substring(0, 200));
    res.writeHead(200, { 'Content-Type': 'application/json', 'connect-protocol-version': '1' });
    res.end('{}');
}
```

### 6.2 关键发现方法

1. 启动 Extension Server
2. 启动 LS，指向该 Extension Server
3. 观察 LS 调用了哪些方法、传了什么参数
4. 逐步实现必要的方法

---

## 七、Stream 协议分析

### 7.1 Connect Streaming 协议

```
Content-Type: application/connect+json
请求/响应 Envelope: flags(1B) + length(4B big-endian) + JSON payload
  flags=0x00: 数据帧
  flags=0x02: end-of-stream (trailer)
```

### 7.2 Protobuf Diff 格式

Stream 推送的是 field-level diff，用 `fieldNumber` 标识字段:

```json
{
  "version": "27",
  "diff": {
    "fieldDiffs": [{
      "fieldNumber": 2,
      "updateSingular": {
        "messageValue": { "fieldDiffs": [...] }
      }
    }]
  }
}
```

值类型:

| JSON 字段 | 对应 proto 类型 |
|----------|---------------|
| `stringValue` | string |
| `enumValue` | enum (数字) |
| `int32Value` | int32/uint32 |
| `boolValue` | bool |
| `messageValue` | 嵌套 message |
| `updateRepeated` | repeated 字段 |

### 7.3 字段映射方法

1. 用探测脚本触发操作，记录 stream 推送的 fieldNumber
2. 同时通过 `GetCascadeTrajectory` 拉取完整 JSON
3. 对比两者，建立 `fieldNumber → 字段名` 的映射表

---

## 八、实战清单 (Checklist)

新逆向任务开始时，按此顺序执行:

- [ ] **定位文件**: 找到目标 extension.js / 二进制
- [ ] **关键词搜索**: `grep -c "目标关键词" extension.js`，判断是否存在
- [ ] **Schema 搜索**: `grep -oP '目标Schema.{0,200}' extension.js`，找到 proto message 编号
- [ ] **Proto 解码**: 提取 base64 → 解码 → 搜索字段定义
- [ ] **调用链追踪**: 方法名出现次数 > Schema定义次数 → 有实际调用 → 追踪上下文
- [ ] **进程参数**: `ps aux | grep` 查看运行时参数
- [ ] **黑盒探测**: 空请求 → 带参请求 → 解读错误
- [ ] **日志验证**: 检查 LS 日志确认行为

---

## 九、已知陷阱

| 陷阱 | 说明 |
|------|------|
| Go 二进制字符串搜索 | 噪音极大，CJK 字符编码表会干扰搜索。**优先搜 extension.js** |
| API 返回 200 不代表生效 | ResolveOutstandingSteps 等 API 返回成功但实际无效 |
| WAITING vs PENDING | 用户审批的状态是 `CORTEX_STEP_STATUS_WAITING`，不是 PENDING |
| proto field 编号 vs 数组索引 | stream diff 中 `fieldNumber` 是 proto 字段编号，`updateRepeated` 中的索引才是数组下标 |
| extension.js minified 变量名 | 每次构建变量名可能不同，搜原始字符串常量更可靠 |
| `--enable_lsp=false` | LSP 关闭后 LS 不会收到 `initialize` 中的 `workspaceFolders`，导致工作区感知缺失 |
