# 250227-1110 项目结构重构

## 概述

全面重构项目结构，减少臃肿，提升可维护性。

## 变更清单

### 1. tools/ 归档 (68 → 3 个活跃文件)

**保留：**
- `ag.js` — CLI 入口
- `call-grpc-api.js` — gRPC 调用工具
- `capture-mode-diff.js` — 模式对比抓包工具
- `switch-window.js` — 窗口切换工具（从根目录迁入）

**归档到 `tools/_archive/`：** 65 个探索性/一次性脚本

### 2. server 入口文件整理

| 旧文件名 | 新文件名 | 说明 |
|:--|:--|:--|
| `server-v2.js` | `server.js` | 主入口（v2 协议） |
| `server.js` | `server-v1.js` | 旧入口，标记 @deprecated |
| `switch-window.js` | `tools/switch-window.js` | 迁入 tools/ |

### 3. lib/ 目录分层 (扁平 → 分层)

```
lib/
├── core/               ← v2 核心（gRPC 直连）
│   ├── controller.js   ← 对话管理、轮询、Diff
│   ├── ls-discovery.js ← LS 端口发现 + grpcCall
│   └── ws-protocol.js  ← WebSocket 协议定义
├── cdp/                ← CDP 层（v1 兼容）
│   ├── cdp.js          ← CDP 连接管理
│   ├── ide.js          ← IDE DOM 操作
│   └── api.js          ← 兼容层（931行 → ~200行）
├── data/               ← 数据层
│   ├── conversations.js← SQLite/PB 读取
│   └── format.js       ← 输出格式化
└── service.js          ← CLI 高级 API
```

### 4. lib/cdp/api.js 精简 (931行 → ~200行)

- 删除与 `lib/core/ls-discovery.js` 重复的端口发现逻辑
- 删除与 `lib/core/controller.js` 重复的 API 调用逻辑
- 保留 CDP CSRF 获取降级路线
- 保留向后兼容的 CLI 接口包裹

### 5. docs/ 目录重组

```
docs/
├── api-reference.md          ← 新：完整 API 参考（~626行）
├── changelog/                ← 从 doc/ 迁入
│   ├── 250227-0356-controller-layer.md
│   ├── 250227-0645-frontend-phase1-2.md
│   ├── 250227-0716-frontend-phase3.md
│   ├── 250227-1040-ls-api-params-update.md
│   └── 250227-1110-project-restructure.md
└── _archive/                 ← 旧文档
    ├── conversation-data-reverse-engineering.md
    ├── ssh-server-api-guide.md
    └── chat-history-requirements.md
```

### 6. 其他修正

- `package.json`：更新 main/scripts 指向新的 server.js
- `api-reference.md`：修正端口发现路径、require 路径
- `.gitignore`：添加 *.mp4 规则，移除误提交的录屏文件

## 受影响文件

- `package.json` — scripts 路径
- `server.js`, `server-v1.js` — 入口文件
- `lib/core/*`, `lib/cdp/*`, `lib/data/*` — 所有 require 路径
- `lib/service.js`, `tools/ag.js` — 依赖路径
- `tests/*.test.js` — 测试依赖路径
- `docs/api-reference.md` — 文档引用

## 验证

- ✅ 74 个测试全部通过
- ✅ TypeScript 编译无错误
- ✅ CLI (ag.js) 正常运行
