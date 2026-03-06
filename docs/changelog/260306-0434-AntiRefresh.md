# Anti-Refresh: SW + Cache Headers + State Persistence

## 问题
切换 app 后网页白屏全量刷新，回到首页，体验差。

## 根因
1. Service Worker 缓存策略单一 (全部 network-first)
2. 服务端无 Cache-Control 头
3. 关键状态无持久化 (activeConversationId 丢失)

## 修改模块
- `frontend/public/sw.js`
- `server.js`
- `frontend/src/store/app-store.ts`
- `frontend/src/index.css` (补回误删的移动端样式)

## 修改内容

### 1. Service Worker 双层缓存策略 (sw.js)
升级为 `antigravity-v2`，两层策略:
- **Cache-First**: `/assets/*` (Vite hashed 文件, 不可变, 从缓存秒读)
- **Network-First**: HTML 等 (在线取最新, 离线回退缓存)
- 导航请求离线时 fallback 到 `/index.html` (SPA)

### 2. 服务端 Cache-Control (server.js)
- `/assets/*`: `max-age=1y, immutable` (配合 Vite content hash)
- `*.html`, `sw.js`: `no-cache` (总是验证, 保证更新)
- 其他: `max-age=3600, public`
- 启用 ETag + Last-Modified

### 3. 状态持久化 (app-store.ts)
- `sessionStorage`: `activeConversationId` (标签页级别, 关闭标签页清除)
- `localStorage`: `viewMode`, `debugMode`, `pagedColumns` (用户偏好, 永久)
- 初始化时读取持久化值
- `selectConversation` / `setActiveConversation` 时自动保存
- 场景 C (首次 WS 连接) 自动恢复持久化的活跃对话

### 4. CSS 补回
- 恢复之前误删的 `.input-dropdown-trigger`, `.sidebar-btn`, `.chat-item` 的移动端触摸目标大小
