# Mobile Bottom Nav + Notes Page

## 修改模块

### 新增组件
- `components/BottomNav/BottomNav.tsx` — 移动端底部导航栏（Chat / Notes 切换）
- `components/NotesPage/NotesPage.tsx` — 笔记编辑器（contentEditable + 高亮功能）

### 修改文件
- `App.tsx` — 整合底部导航栏，根据 activeTab 切换 Chat / Notes 视图
- `index.css` — 底部导航栏样式、笔记页面样式、高亮样式

## 功能说明

- 移动端（≤768px）底部显示两个 Tab 图标（MessageCircle / StickyNote），无文字
- Notes 页面：单篇 contentEditable 编辑器，支持文字高亮（选中文字 → 点击工具栏按钮）
- 高亮颜色：柔和暖黄（rgba(234, 179, 8, 0.25)）
- 内容自动保存到 localStorage（防抖 500ms）
- 桌面端不受影响
