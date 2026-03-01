# PWA 化 + 移动端体验优化

## 日期
2026-03-01

## 模块
- `frontend/index.html` — PWA meta 标签、viewport-fit=cover、apple-mobile-web-app
- `frontend/public/manifest.json` — PWA 应用清单（standalone 全屏模式）
- `frontend/public/sw.js` — Service Worker（App Shell 缓存 + Network First）
- `frontend/public/icons/` — 192x192 & 512x512 应用图标
- `frontend/src/main.tsx` — Service Worker 注册（仅生产环境）
- `frontend/src/index.css` — 移动端响应式优化

## 变更内容

### PWA 基础设施
1. 添加 `manifest.json`：应用名 "Antigravity Chat"、深色主题、standalone 全屏模式、竖屏方向
2. 添加 `sw.js`：Network First 策略，预缓存 App Shell，API/WS 不缓存，SPA 离线回退
3. 更新 `index.html`：完整 PWA meta 标签集，包括 iOS Safari 全屏支持
4. 生成应用图标：青色发光几何符号风格

### 移动端交互优化
1. **iOS 安全区域**：Header、输入框、状态栏均使用 `env(safe-area-inset-*)` 避让刘海/底部手势条
2. **触摸目标 44px**：所有按钮、列表项、下拉触发器统一 `min-width/min-height: 44px`
3. **字体防缩放**：输入框字体 16px（iOS 对 < 16px 的输入框会自动缩放）
4. **弹性回弹禁止**：全局 `overscroll-behavior: none`，消息区 `overscroll-behavior-y: contain`
5. **触摸滚动优化**：代码块等可滚动区域添加 `-webkit-overflow-scrolling: touch`
6. **点击高亮消除**：`-webkit-tap-highlight-color: transparent`
7. **下拉菜单 Bottom Sheet**：移动端下拉菜单改为从底部弹出，带安全区域边距
8. **拖拽手柄放大**：移动端 grip bar 更宽更高，方便触摸操作
