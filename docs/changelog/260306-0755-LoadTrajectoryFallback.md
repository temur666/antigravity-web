# LoadTrajectory Fallback 修复

## 修改模块
`lib/core/controller.js` — `getTrajectory` 方法

## 问题
LS 进程只在内存中保留它"知道"的 ~16 个对话。磁盘上有 100 个 `.pb` 文件（加密的历史对话），其中 84 个 LS 不认识。用户在前端列表中点击这些对话后，`GetCascadeTrajectory` 返回 `"trajectory not found"`，前端显示空白。

**根因**：`listConversations` 有 3 层 fallback（LS API > .pb 扫描 > SQLite），但 `getTrajectory` 只走 LS API 一条路径，两者数据源不对称。

## 修复
在 `getTrajectory` 中添加 `LoadTrajectory` API fallback：

```
GetCascadeTrajectory → "trajectory not found"?
  → LoadTrajectory(cascadeId)  // 让 LS 解密 .pb 并加载到内存
  → 重试 GetCascadeTrajectory  // 现在 LS 认识了，返回完整数据
```

## 验证
- `7e638486` 对话从 0 steps 恢复到 48 steps
- 现有 37 个单元测试全部通过（5 个失败为 InputBox 测试与 UI 重构不同步的已知问题，与本次修改无关）
