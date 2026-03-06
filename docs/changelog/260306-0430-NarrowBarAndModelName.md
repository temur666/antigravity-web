# Mobile Input Narrow Bar + Model Name Shortening

## 修改模块
- `frontend/src/components/ChatPanel/InputBox.tsx`
- `frontend/src/components/Header/ModelSelector.tsx`
- `frontend/src/index.css`

## 修改内容

### 1. 移动端输入栏单行窄栏 (ChatGPT 风格)
**技术**: 用 CSS `display: contents` 打散容器层级 + `order` 重排

布局变化:
```
之前 (两行):
  [textarea]
  [📎]          [🎤] [→]

现在 (单行):
  [📎] [textarea...      ] [→]
```

CSS 核心:
- `.input-bottom-bar`, `.input-actions-left/right`: `display: contents` 放弃容器身份
- `.btn-attach`: `order: 0` (左)
- `.input-textarea-vertical`: `order: 1; flex: 1` (中)
- `.btn-send`: `order: 2` (右)
- `.btn-mic`: `display: none` (隐藏无功能的语音按钮)
- `.input-box-inner-vertical`: `flex-direction: row; border-radius: 24px` (pill 形)
- 无任何 JSX 结构改动,纯 CSS 重排

### 2. Header 模型名缩写
- `ModelSelector.tsx`: 导入 `shortenModelLabel`
- Header 位置使用缩写: `shortenModelLabel(fullName)`
- 下拉菜单内仍显示完整名称
- 缩写规则 (已有):
  - "Claude Opus 4.6 (Thinking)" → "Opus 4.6"
  - "Gemini 3.1 Pro (High)" → "Gemini 3.1 Pro H"
  - "Claude Sonnet 4.5" → "Sonnet 4.5"
