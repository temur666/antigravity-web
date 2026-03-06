# 260306-1101-MobileDvhFix

## 模块
`frontend/src/index.css` — 全局布局

## 修改内容
将 `.app` 的 `height: 100vh` 改为 `height: 100dvh`。

## 原因
移动端 Chrome 的地址栏会占据额外空间，`100vh` 始终等于地址栏隐藏时的最大视口高度，导致页面底部内容被遮挡。`100dvh`（Dynamic Viewport Height）会实时跟随地址栏的显隐变化，确保布局高度始终等于实际可用空间。
