# lib/core/ 架构文档

## 目录结构

```
lib/core/
  ls/                           # 环节A: LS 连接生命周期
    discovery.js                # LS 发现 (daemon file + 进程 fallback)
    grpc.js                     # gRPC 传输 (HTTP/HTTPS 自动检测)
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
[ LSManager.init() ] → [ new StreamClient() ] → [ _registerWorkspace() ]
  manager.js              stream-client.js        manager.js (grpc.js)

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
