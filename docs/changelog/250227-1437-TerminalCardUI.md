# 250227-1437-TerminalCardUI

## 修改了什么
- 将 `RunCommandStep.tsx` 中原先简单的黑框代码重构为了精美的 Terminal Card UI，并自动补齐带有提示符（`$`）的交互样式。
- 修复了因为后端传回命令属性名不一致（`CommandLine`, `commandLine`, `command`）导致的渲染为空框的问题，对数据结构做了向下兼容，提升鲁棒性。
- 在 `index.css` 中引入 `--font-sans` 和 `--font-mono` 以确保字体正确设置。
- 在 `index.css` 中补充了 `.terminal-card` 系列的现代毛玻璃/暗色样式。

## 涉及模块
- `frontend/src/components/ChatPanel/steps/RunCommandStep.tsx`
- `frontend/src/index.css`
