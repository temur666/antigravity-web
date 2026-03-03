# 翻页模式 (Paged View Mode)

## 修改模块
- `store/app-store.ts` — 新增 `viewMode` 状态和 `toggleViewMode` action
- `components/ChatPanel/ChatPanel.tsx` — 支持 scroll/paged 双模式切换，键盘翻页，页码计算，"有新内容"提示逻辑
- `components/ChatPanel/PagedOverlay.tsx` — 新组件，翻页浮层 UI（上下翻按钮 + 页码 + 新内容提示）
- `App.tsx` — Header 新增 viewMode toggle 按钮
- `index.css` — 翻页模式 CSS（scroll-snap、浮层、提示条样式）

## 功能说明
- 点击 Header 右侧按钮切换滚动/翻页模式
- 翻页模式下：
  - 每个 step 自动 snap 对齐（scroll-snap: proximity）
  - 每个 step 最小高度 60vh，形成翻页感
  - 右侧浮层显示上/下翻页按钮和页码
  - 键盘支持：PageUp/PageDown/ArrowUp/ArrowDown/Space/Home/End
  - 新 Step 推送时不自动跳转，显示"有新内容"提示
