# lib/core/ 架构文档

## 目录结构

```
lib/core/
  ls/                           # 环节A: LS 连接生命周期
    discovery.js                # LS 发现 (daemon file + 进程 fallback)
    grpc.js                     # gRPC 传输 (HTTP/HTTPS 自动检测)
    health-check.js             # 健康验证 (版本校验 + 业务冒烟测试)
    stream-client.js            # 流式长连接 (StreamCascadeReactiveUpdates)
    manager.js                  # 连接管理 (init, health, reconnect)
    index.js                    # 统一导出

  conversation/                 # 环节B: 对话数据通道
    state.js                    # 对话状态 + CRUD (list, create, send, trajectory)
    sync.js                     # 数据同步 (subscribe, diff, throttle, broadcast)
    step-normalizer.js          # Step 数据规范化 (LS 字段 → 前端 Schema)

  controller.js                 # 组合层: 将 ls/ + conversation/ 组合为统一 API
  ws-protocol.js                # WebSocket 协议定义 + 请求体构造

  ls-discovery.js               # [兼容] re-export → ls/discovery + ls/grpc
  stream-client.js              # [兼容] re-export → ls/stream-client
  step-normalizer.js            # [兼容] re-export → conversation/step-normalizer
```

## Chain Graph

### 环节A: LS 连接生命周期

```
流1: 发现
[ daemon/ls_*.json ] → [ PID 存活校验 ] → [ Heartbeat 验证 ]
  discovery.js            discovery.js         grpc.js

流2: 建立连接
[ LSManager.init() ] → [ fullHealthCheck() ] → [ new StreamClient() ] → [ _registerWorkspace() ]
  manager.js           health-check.js (grpc.js)   stream-client.js       manager.js (grpc.js)

流3: 健康维持
[ 30s 心跳 ] → [ Heartbeat 失败? ] → [ refreshLS() 重连 ]
  manager.js     manager.js (grpc.js)   manager.js → 重走流1+流2
```

### 环节B: 对话数据通道

```
流4: 实时数据同步
[ StreamClient change ] → [ _fetchAndDiff() ] → [ _broadcastWithSeq() ]
  stream-client.js → sync.js   sync.js (grpc.js)    sync.js → WebSocket

流5: 对话 CRUD
[ newChat/sendMessage ] → [ grpcCall(LS API) ] → [ 更新 ConversationState ]
  state.js                  grpc.js                 state.js
```

### 组合层

```
[ Controller ] → [ LSManager ] + [ ConversationStore ] + [ ConversationSync ]
  controller.js    ls/manager.js   conversation/state.js   conversation/sync.js
```

## 模块依赖图

```
controller.js (组合层, 对外统一接口)
  ├── ls/manager.js
  │     ├── ls/discovery.js
  │     ├── ls/grpc.js
  │     ├── ls/health-check.js ←── ls/grpc.js
  │     └── ls/stream-client.js ←── ls/grpc.js (协议缓存)
  ├── conversation/state.js
  │     ├── ls/grpc.js
  │     ├── ws-protocol.js
  │     └── conversation/step-normalizer.js
  └── conversation/sync.js
        ├── ls/grpc.js
        └── conversation/step-normalizer.js
```

## 设计决策

1. **回调接口解耦**: `LSManager` 通过 `onStreamChange()` / `onGetActiveSubscriptions()` 回调与 `ConversationSync` 通信，避免循环依赖
2. **兼容性 re-export**: 旧路径 (`ls-discovery.js`, `stream-client.js`, `step-normalizer.js`) 全部保留为 re-export，外部引用零修改
3. **纯组合层 Controller**: `controller.js` 只做连线，不含业务逻辑，方法全部代理到子模块
4. **健康检查独立模块**: `health-check.js` 只依赖 `grpc.js`，与 `conversation/` 完全解耦。版本 unknown (进程 fallback) 时放行但 warn，版本低于 1.19.0 时拒绝连接






### 测试汇总

| 测试文件 | 模块 | 用例数 | 类型 |
| :--- | :--- | :--- | :--- |
| `ls/discovery.test.js` | LS 发现 | 13 | 单元 |
| `ls/grpc.test.js` | gRPC 传输 | 10 | 单元 + 集成 |
| `ls/manager.test.js` | 连接管理 | 7 | 单元 + 集成 |
| `conversation/state.test.js` | 对话状态 | 14 | 单元 |
| `conversation/sync.test.js` | 数据同步 | 17 | 单元 |
| `controller.integration.test.js` | 完整链路 | 19 | 集成 |
| **合计** | - | **80** | - |

运行方式：

  纯单元测试: node lib/core/ls/__tests__/discovery.test.js
  带真实 LS 集成: node lib/core/ls/__tests__/grpc.test.js --integration
  全部跑: 上面的链式命令



## 后续行动 (Next Steps)

- **清理 re-export**
  - **核心描述**: 移除 `ls-discovery.js`, `stream-client.js`, `step-normalizer.js` 垫片
  - **风险/收益**: 消除间接层；需全局替换 `scripts/`, `tools/` 等引用
- **移除 v1 兼容层**
  - **核心描述**: 清理 `cdp/api.js` (legacyController) 与 `service.js`
  - **风险/收益**: 大幅精简代码；需确认 CLI/Telegram 已完全切换至 v2
- **补全模块化测试** ✅
  - **核心描述**: 为 `LSManager`, `ConversationStore`, `ConversationSync` 编写独立单元测试
  - **风险/收益**: 提高测试覆盖率与维护性；需重构旧 `controller.test.js`
- **业务层集成**
  - **核心描述**: 推进前端功能对接、YOLO mode 测试及其他应用逻辑
  - **风险/收益**: 验证架构稳定性；跨模块协同
