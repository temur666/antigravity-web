# 前后端分离开发模式配置

## 修改模块
- `ecosystem.config.js` — PM2 进程管理
- `~/.cloudflared/config.yml` — Cloudflare Tunnel 配置

## 变更内容

### 1. 后端 watch 模式
`ecosystem.config.js` 中 `antigravity-web` 进程新增：
- `watch: ['main.js', 'lib/', 'server.js']` — 监听后端文件变化自动重启
- `ignore_watch: ['frontend', 'node_modules', 'logs', ...]` — 忽略无关目录
- `watch_delay: 1000` — 1 秒防抖

### 2. Vite Dev Server 进程
`ecosystem.config.js` 新增 `vite-dev` 进程：
- 运行 `npx vite --host 0.0.0.0 --port 5173`
- cwd: `frontend/`
- 提供 HMR 热更新，前端代码修改后毫秒级刷新

### 3. Cloudflare Tunnel 指向切换
`~/.cloudflared/config.yml` 中 `chat.zome.life` 指向从 `3210` 改为 `5173`。

## 架构说明

### 开发模式（当前）
```
手机 chat.zome.life → Cloudflare → 5173(Vite Dev) ──proxy──→ 3210(后端)
```
- 改前端代码手机实时预览
- 后端 PM2 watch 自动重启

### 切回生产模式
```bash
pm2 stop vite-dev
sed -i 's|http://localhost:5173|http://localhost:3210|' ~/.cloudflared/config.yml
npm run build:frontend
pm2 restart cloudflared
```

## PM2 进程列表
| 进程 | 端口 | 职责 |
|---|---|---|
| antigravity-web | 3210 | 后端 API + WebSocket |
| vite-dev | 5173 | 前端开发服务器 (HMR) |
| cloudflared | - | Cloudflare Tunnel |
