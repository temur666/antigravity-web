# 260310-1541 阅读模式点击与拖选冲突修复

## 修改模块
ChatPanel

## 问题
拖拽选择文字时，mouseup 后浏览器仍会触发 click 事件，导致阅读模式被意外切换。

## 修复方案
在 `handleContentClick` 中增加双重守卫：

1. **鼠标位移检测** — `mousedown` 时记录坐标，`click` 时计算位移，超过 5px 判定为拖选，跳过切换
2. **Selection 检测** — `window.getSelection()` 有选中文本时跳过切换

## 影响文件
| 文件 | 改动 |
|------|------|
| `ChatPanel.tsx` | 新增 `mouseDownRef`、`handleContentMouseDown`；`handleContentClick` 增加位移和选区守卫 |
