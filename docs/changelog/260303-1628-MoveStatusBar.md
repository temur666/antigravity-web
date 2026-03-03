# Move StatusBar to MetadataPopover

将底部的 StatusBar 取消，并将其显示的信息（LS状态、账号信息、Debug开关）全部移动到了对话上方的 `MetadataPopover` 内部（对话元数据弹窗），节省了屏幕空间并且满足了保留所有信息的要求。

- 移除了 `src/components/StatusBar` 文件夹以及在 `App.tsx` 中的引用。
- 修改了 `src/components/ChatPanel/MetadataPopover.tsx`，底部增加了状态区的显示和 `store` 相关状态的引用。
- 更新了 `src/index.css`，移除了与 `.status-bar` 相关的 CSS 代码并添加了 `.metadata-status-section` 相关样式。
