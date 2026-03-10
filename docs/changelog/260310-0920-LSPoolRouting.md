# 260310-0920 LSPool Multi-LS 路由层

## 问题
同一台机器运行多个 LS 实例(IDE LS + Daemon LS),
每个 LS 维护独立的内存对话索引, controller 只连一个 LS,
导致另一个 LS 创建的对话不可见/不可加载。

## 根因
LS 只在启动时索引 .pb 文件, 运行时创建的对话不会被其他 LS 实例发现。
discoverLSAsync() 返回单个实例, 无法覆盖所有 LS 上的对话。

## 方案: LSPool
引入 LS 连接池, 管理多个 LS 实例, 通过路由表将请求定向到正确 LS。

## 修改文件
- `lib/core/ls/discovery.js`: 新增 `discoverAllLS()`
- `lib/core/ls/pool.js`: (新建) LSPool 核心实现
- `lib/core/conversation/state.js`: listConversations 并行查询所有 LS + 去重合并
- `lib/core/conversation/sync.js`: subscribe/unsubscribe/fetchAndDiff 走路由
- `lib/core/controller.js`: LSManager -> LSPool

## 验证结果
- LSPool 成功发现 2 个 LS 实例 (PID=1308529:42100, PID=1283367:37305)
- 对话列表从 12/14 合并为 24 个 (source=ls)  
- 之前仅 IDE LS 可见的 cc756be5 成功跨 LS 加载: 366 步
