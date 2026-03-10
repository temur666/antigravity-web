# 移除 V1 Service 兼容层

## 变更内容

### 删除的文件
- `lib/service.js` — V1 业务编排层 (Facade)，已被 `core/controller.js` 完全架空
- `lib/cdp/api.js` — V1 API 兼容层，内部已代理到 Controller，唯一调用方为 service.js
- `tests/service.test.js` — service.js 的测试文件

### 修改的文件
- `tools/ag.js` — 直接使用 `Controller` 替代 `service.js`，将 `findConversation`、`listConversations`、`exportConversation` 内联为 CLI 专用函数

## 原因

`service.js` → `cdp/api.js` → `Controller` 形成了三层代理链，但底层全部委托给同一个 Controller。
移除两个中间层，简化调用链为：`ag.js` → `Controller` → `core/conversation/*`。

## 保留的 CDP 功能
`lib/cdp/cdp.js` 和 `lib/cdp/ide.js` 仍被 Telegram bot 使用，未删除。
