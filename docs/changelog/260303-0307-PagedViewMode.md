# 翻页模式 (Paged View Mode)

## 修改模块
- `store/app-store.ts` — 新增 `viewMode` 状态和 `toggleViewMode` action
- `components/ChatPanel/ChatPanel.tsx` — 微信读书式 CSS multi-column 左右翻页
- `components/ChatPanel/PagedOverlay.tsx` — 翻页浮层（左右按钮 + 页码 + 新内容提示）
- `App.tsx` — Header 新增 viewMode toggle 按钮
- `index.css` — 翻页模式 CSS（multi-column 容器、浮层、提示条）

## 功能说明
- 点击 Header 右侧按钮切换滚动/翻页模式
- 翻页模式使用 CSS multi-column + JS 计算：
  - 内容自动填满视口高度，溢出部分流入下一"列"（即下一页）
  - JS 计算列宽 = 视口宽度，translateX 平移实现翻页
  - 底部居中浮层显示左/右翻页按钮和页码
  - 键盘支持：← → / PageUp / PageDown / Space / Home / End
  - 触摸滑动支持：左滑下一页、右滑上一页
  - 内容允许跨页切断（与微信读书一致）
  - 新 Step 推送时不自动跳转，显示"有新内容"提示
  - 窗口 resize 自动重算页数
