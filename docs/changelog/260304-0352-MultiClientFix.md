# 多客户端并发访问修复

## 修改模块

### 1. frontend/src/store/app-store.ts — 重连状态恢复
- 区分三种场景：LS 首次连接 / LS 断开重连 / WS 断开重连
- WS 重连时只重新订阅（带 lastSeq 增量恢复），不做全量 selectConversation
- 避免了切后台回来时清空当前对话内容导致的 "自己刷新" 现象

### 2. frontend/src/main.tsx — 去除重复的重连逻辑
- 移除了 main.tsx 中的 onStateChange 重连处理
- 统一由 app-store 的 event_ls_status 事件处理重连恢复

### 3. frontend/src/store/ws-client.ts — 心跳保活 + 前台检测
- 添加 25s 间隔的 ping/pong 心跳，10s 超时主动断开重连
- 监听 visibilitychange 事件，切回前台时立即发心跳检测连接
- 解决移动端静默断连（锁屏、切 App、NAT 超时）感知不到的问题

### 4. server.js — 心跳响应 + lastSeq 透传
- 处理前端 ping 消息，回复 pong（不走 JSON 解析路径）
- req_subscribe 传递 lastSeq 给 Controller，启用增量恢复

### 5. lib/core/controller.js — unsubscribeAll 资源泄漏修复
- 客户端断开时检查是否仍有其他订阅者
- 无订阅者时断开 StreamClient 避免僵尸流残留
