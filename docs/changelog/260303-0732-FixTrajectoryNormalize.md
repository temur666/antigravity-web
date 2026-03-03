# fix: getTrajectory 返回 normalized steps

## 模块
- `lib/core/controller.js` — `getTrajectory()` 方法

## 问题
`getTrajectory()` 内部对 LS 原始 steps 做了 normalize（存入 `conv.steps`），
但返回值仍然是 LS 的原始 `data` 对象。

`server.js` 从返回值的 `traj.trajectory.steps` 取数据发给前端，
导致前端收到的是 LS 原始字段名（如 `absolutePathUri`），
而前端组件期望的是 `filePath`，字段对不上，全部显示为"未知文件"。

## 修复
在 `getTrajectory()` 返回前，用 `conv.steps`（已 normalize）
替换 `data.trajectory.steps`（未 normalize），
确保所有下游消费者拿到的都是规范化后的数据。

## 影响范围
- VIEW_FILE: "Unknown File" → 正确文件名
- CODE_ACTION: "未知文件" → 正确文件路径
- GREP_SEARCH: 空 Path + 无结果 → 正确搜索路径和匹配列表
- VIEW_FILE_OUTLINE / VIEW_CODE_ITEM: 同理修复
