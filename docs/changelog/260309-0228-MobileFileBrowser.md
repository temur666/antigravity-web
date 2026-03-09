# Mobile File Browser - 移动端底部文件浏览器栏

## 修改模块
- `main.js` (后端)
- `frontend/src/components/BottomNav/BottomNav.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/FileBrowser/` (新增组件)

## 功能说明

### 后端 - 目录读取 API
- 新增 `GET /api/fs/list?path=<relative-path>` 端点
- 返回项目目录下的文件结构（区分文件夹 `isDir=true` 以及一般文件，隐藏文件及 `node_modules` 自动过滤过滤）
- 支持和 `/api/file` 一致的安全措施及相对路径访问

### 前端 - 底部导航扩展
- 为移动端的底部状态栏 `BottomNav.tsx` 增加第三个 Tab："files"
- 图标采用 `FolderOpen` (Lucide-react)
- `App.tsx` 中的展示逻辑同步修改：点击该选项将全屏渲染 `FileBrowser`

### 前端 - 文件浏览器 UI
- 支持面包屑（Breadcrumbs）顶层导航路径和多级目录穿梭
- 面板渲染了与系统界面兼容的一致深色风格 `CSS` 和悬浮感点击
- 文件夹列表点击后将无缝展开此级目录；具体文件点击则复用刚刚添加好的 `FileViewer` 组件（通过模态框层级显示）
