# Editorial Typography Mode

## 修改模块
- `store/app-store.ts` — 新增 `typography` 状态 (`'default' | 'editorial'`) + `toggleTypography` action + localStorage 持久化
- `components/ChatPanel/typography-editorial.css` — 新建，从 `infinite` 项目移植 ArticleCard 排版系统
- `components/ChatPanel/ChatPanel.tsx` — 引入 editorial CSS，根据 typography 状态动态切换 `.editorial-typography` class
- `components/ConfigPanel/ConfigPanel.tsx` — 新增"排版风格"切换按钮

## 功能说明
在 ConfigPanel 中新增"排版风格"开关，支持两种模式：
- **Default**: 原有紧凑工具风排版 (Inter 14px)
- **Editorial**: 移植自 `infinite` 项目的疏朗阅读风排版 (系统字体栈、可变字重 460/520/560、宽松间距)

设置自动持久化到 localStorage，刷新后保持。
