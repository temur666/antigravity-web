# 260301-0726 Production Mode Migration

## 修改模块

### lib/core/ls-discovery.js
- 新增 `discoverProcessCandidates()`: 获取 LS 进程的所有监听端口
- 新增 `discoverLSAsync()`: 异步 LS 发现，逐端口 Heartbeat 探测，替代硬编码 fd=9 匹配
- 修复了 Discovery File 中 PID 失效时无法正确 fallback 到进程发现的问题

### lib/core/controller.js
- `init()` 和 `refreshLS()` 改用 `discoverLSAsync()`，去掉重复的 Heartbeat 验证

### main.js (新文件)
- 生产模式唯一入口
- 服务 frontend/dist/ 静态文件 + WebSocket + REST API
- 启动前检查 dist 目录是否存在
- 去掉了 publicPath fallback（不再支持旧 public/ 目录）

### ecosystem.config.js (新文件)
- PM2 进程管理配置
- 管理 antigravity-web (main.js) 和 cloudflared 两个进程

### package.json
- main 入口改为 main.js
- start/dev 脚本更新

### ~/.cloudflared/config.yml
- 简化为 chat.zome.life -> localhost:3210
- 去掉 api.zome.life（后端 API 通过同源 /api 路径访问）

## 架构变更

**之前**: Tunnel -> Vite Dev Server (5173) -> Proxy -> server.js (3210)
**现在**: Tunnel -> main.js (3210，直接 serve 静态文件 + API + WebSocket)
