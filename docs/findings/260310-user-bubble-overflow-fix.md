---
title: 用户气泡手机端溢出修复
date: 2026-03-10
updated: 2026-03-10
tags: ai-dev
status: confirmed
---

# 用户气泡手机端溢出修复

## 事实 (Facts)

- **F-01** ✓ `.step-user-input .step-content` 设置了 `width: 100%` 但缺少 `overflow-wrap` 和 `min-width: 0`，导致长文本（URL、路径、代码片段）撑破手机屏幕宽度 → [E-01]
- **F-02** ✓ AI 回复侧 `.ai-response` 已通过 `max-width: 100%` + `overflow-x: hidden` 做了宽度约束，用户气泡侧没有同等防护 → [E-02]
- **F-03** ✓ Code Block 采用双层结构（`.code-block-wrapper` 限宽 + `overflow-x: auto`，内层 `pre` 用 `width: fit-content`），是项目中处理宽度溢出的标准模式 → [E-03]
- **F-04** ✓ Flex 子项的 `min-width` 默认值为 `auto`（即内容最小宽度），不显式设置 `min-width: 0` 时，容器无法缩小到比内容窄 → [E-04]

## 结论 (Conclusions)

- **C-01** 用户气泡溢出的根因是缺少文本折行策略 + flex min-width 打破。修复只需在 `.step-user-input .step-content` 添加三个 CSS 属性（`min-width: 0`、`overflow-wrap: break-word`、`word-break: break-all`），无需改动组件逻辑。综合 F-01、F-04。
- **C-02** 项目中已有两种宽度约束模式：a) 容器折行（用户气泡适用此方案），b) wrapper 滚动（code block / table 适用）。选择取决于内容语义——自然语言折行更友好，代码滚动保留格式更重要。综合 F-02、F-03。

## 证据 (Evidence)

- **E-01** `Steps.css:88-96`，原始 `.step-user-input .step-content` 样式，仅有 `white-space: pre-wrap` 但无 `overflow-wrap` 或 `word-break`
  - 来源: source-code
  - 路径: `frontend/src/components/ChatPanel/Steps.css`

- **E-02** `Steps.css:103-110`，`.ai-response` 的宽度约束样式
  - 来源: source-code
  - 路径: `frontend/src/components/ChatPanel/Steps.css`

- **E-03** `Steps.css:165-185`，Code Block 双层结构样式
  - 来源: source-code
  - 路径: `frontend/src/components/ChatPanel/Steps.css`

- **E-04** CSS Flexbox 规范：flex item 的 min-width 默认为 auto
  - 来源: spec-reference
  - 链接: https://www.w3.org/TR/css-flexbox-1/#min-size-auto

## 探索过程 (Exploration Summary)

```yaml
- 用户报告手机端用户气泡超出屏幕宽度
- 查阅 KI「Antigravity Frontend Architecture」中 responsive_content_rendering 文档 ↓
  了解到 code block / table 的宽度约束方案（双层 wrapper + overflow-x: auto）
- 定位到 UserInputStep.tsx 和 Steps.css 中的用户气泡样式 ↓
  发现 .step-user-input .step-content 只有 white-space: pre-wrap，缺少折行策略
- 对比 .ai-response 和 .code-block-wrapper 的实现 ↓
  确认问题是缺少 overflow-wrap + min-width: 0
- 选择方案 A（折行）而非方案 B（水平滚动），因为用户消息是自然语言，折行体验更好
- 添加 min-width: 0 / overflow-wrap: break-word / word-break: break-all 三个属性
```

## 聊天记录 (Chat Excerpts)

- 对话 ID: `2e46e519-e2d5-4059-88cb-258966d6e217`
- 关键决策: 用户选择方案 A（长内容自动折行），而非方案 B（水平滚动）
