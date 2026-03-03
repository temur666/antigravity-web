# Sidebar Swipe Gesture + Cancel Conversation

## 1. 侧边栏跟手拖拽 (Mobile)

将侧边栏的触摸手势从简单的滑动检测升级为实时跟手拖拽：

- `touchmove` 时实时更新 sidebar 的 `transform` 和遮罩层 `opacity`
- 方向锁定：首次移动确定水平/垂直方向，避免与上下滚动冲突
- `touchend` 时根据拖拽距离（超过 40%）或速度（> 0.3px/ms）决定吸附方向
- 遮罩层改为始终渲染 + opacity 控制，配合拖拽实时渐变

修改文件：
- `frontend/src/App.tsx` — 跟手拖拽逻辑
- `frontend/src/index.css` — sidebar-backdrop 改为 opacity 控制

## 2. 终止对话功能

全链路打通 `CancelCascadeInvocation` gRPC API：

- `lib/core/controller.js` — 新增 `cancelCascade(cascadeId)` 方法
- `server.js` — 新增 `req_cancel` 消息处理
- `frontend/src/types/protocol.ts` — 新增 `ReqCancel` / `ResCancel` 类型
- `frontend/src/store/app-store.ts` — 新增 `cancelConversation` action
- `frontend/src/components/ChatPanel/ChatPanel.tsx` — RUNNING 状态时显示红色终止按钮
- `frontend/src/index.css` — `.cancel-btn` 样式
