# Proto Schema 系统性提取

## 修改内容

从 extension.js (v1.19.6) 中系统性提取了完整的 protobuf schema。

### 新增文件

- `tools/extract-proto-schema.js` — 提取脚本
  - 手写最小 protobuf wire format 解码器 (无额外依赖)
  - 解码 extension.js 中 base64 编码的 FileDescriptorProto
  - 输出为人类可读的 .proto 格式
  - 支持 `--filter`, `--json`, `--raw` 参数

- `docs/reference/proto/*.proto` — 22 个 proto 定义文件
  - 核心: `exa-language-server-pb-language-server.proto` (1834 行, 336 messages, 148 methods)
  - 核心: `exa-cortex-pb-cortex.proto` (3298 行, 381 messages, 58 enums)
  - 核心: `exa-codeium-common-pb-codeium-common.proto` (3649 行, 273 messages, 96 enums)
  - 核心: `exa-extension-server-pb-extension-server.proto` (540 行, 110 messages, 52 methods)

### 统计

| 指标 | 数量 |
|------|------|
| Proto 文件 | 22 |
| Message 类型 | 1476 |
| Enum 类型 | 215 |
| Service | 8 |
| RPC 方法 | 251 |
| 字段总数 | 4997 |
| 总行数 | 12156 |

### 逆向完成度变化

- 之前: ~20 个 API 已逆向 (14%), 基于手动搜索 extension.js
- **现在: 251 个 RPC 方法 + 1476 个 Message 类型的完整字段定义已导出 (100%)**
