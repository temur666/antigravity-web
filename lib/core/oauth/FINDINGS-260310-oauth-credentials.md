---
title: LS Standalone OAuth Credentials 提取与多账号 Token 链路
date: 2026-03-10
updated: 2026-03-10
tags: [reverse-engineering, ai-dev]
status: confirmed
---

# LS Standalone OAuth Credentials 提取与多账号 Token 链路

> 从 LS 二进制中提取到正确的 OAuth CLIENT_ID/SECRET, 建立了完整的多账号 Token 获取链路, 并通过 E2E 验证。

---

## 1. 事实 (Facts)

- **F-01** ✓ LS binary (v1.19.6) 中硬编码了两组 OAuth Client Credentials → `[E-01]`
  - 组1: `1071006060591-<REDACTED>.apps.googleusercontent.com`
  - 组2: `884354919052-<REDACTED>.apps.googleusercontent.com`
- **F-02** ✓ 组1 的 CLIENT_ID 是 13 位数字 (`1071006060591`) 而非常见的 12 位 → `[E-02]`
- **F-03** ✓ Cockpit 扩展 (jlcodes.antigravity-cockpit v2.1.29) 使用与组1 完全相同的 CLIENT_ID/SECRET → `[E-03]`
- **F-04** ✓ LS standalone 模式读取 `~/<gemini_dir>/jetski-standalone-oauth-token` 文件进行认证 → `[E-04]`
- **F-05** ✓ 组1 credentials 可成功 refresh 两个 Google 账号的 token → `[E-05]`
- **F-06** ✓ 组2 credentials 的 refresh 请求返回 `unauthorized_client`, 可能是 service-to-service 专用 → `[E-06]`
- **F-07** ✗ 原 `oauth-login.js` 中的 CLIENT_ID (`681255809395`) 已完全失效, `invalid_client: Unauthorized` → `[E-07]`
- **F-08** ✓ LS daemon 使用 `-gemini_dir` 参数控制 token 文件路径, 可实现多账号隔离 → `[E-08]`
- **F-09** ✓ Token 文件格式为 `{ access_token, token_type, refresh_token, expiry }`, LS 使用内置 CLIENT_ID 自动 refresh → `[E-04]`

## 2. 结论 (Conclusions)

LS standalone 模式的 OAuth 认证使用组1 credentials (`1071006060591-...` + `GOCSPX-K58FWR...`), 与 Cockpit 扩展一致 (F-01, F-03)。原 `oauth-login.js` 使用的旧 CLIENT_ID 已被 Google 吊销 (F-07), 是此次调查的触发原因。

多账号支持通过 `-gemini_dir` 参数实现, 每个账号使用独立的 gemini 目录 (F-08):
- `.gemini` → tiemuer2025@gmail.com (默认)
- `.gemini-alt` → peakerlomascolo163@gmail.com

refresh_token 可通过两种方式获取 (F-05):
1. **Cockpit 扩展** — 安装后直接从扩展中提取 (已验证可行)
2. **oauth-login.js** — 使用更新后的 CLIENT_ID 重新走浏览器授权流程

提取 CLIENT_ID 时需注意 13 位数字的情况 (F-02), `\d{12}` 正则会截断前导数字。

## 3. 证据 (Evidence)

### E-01: LS binary 中的 OAuth Client Credentials
- **类型**: script-result
- **来源**: LS binary v1.19.6 (`language_server_linux_x64`)
- **复现方法**:
  ```bash
  # 提取 CLIENT_ID (注意不限定 12 位)
  strings ~/.antigravity-server/bin/1.19.6-d2597a5c475647ed306b22de1e39853c7812d07d/extensions/antigravity/bin/language_server_linux_x64 \
    | grep -oP '\d+-[a-z0-9]+\.apps\.googleusercontent\.com' | sort -u

  # 提取 CLIENT_SECRET
  strings ~/.antigravity-server/bin/1.19.6-d2597a5c475647ed306b22de1e39853c7812d07d/extensions/antigravity/bin/language_server_linux_x64 \
    | grep -oP 'GOCSPX-[A-Za-z0-9_-]+' | sort -u
  ```
- **结果**:
  ```
  CLIENT_ID 组1: 1071006060591-<REDACTED>.apps.googleusercontent.com
  CLIENT_ID 组2: 884354919052-<REDACTED>.apps.googleusercontent.com
  SECRET 组1: GOCSPX-<REDACTED-1>
  SECRET 组2: GOCSPX-<REDACTED-2>
  ```

### E-02: 12 位正则截断问题
- **类型**: log
- **来源**: strings 输出中的原始上下文
- **内容**:
  ```
  # strings 输出中 CLIENT_ID 紧接在 RPC 名称后面:
  ...GetBrowserWhitelistFilePath1071006060591-<REDACTED>.apps.googleusercontent.com...

  # \d{12} 正则匹配结果 (截断了前导 1):
  071006060591-<REDACTED>.apps.googleusercontent.com

  # \d+ 正则匹配结果 (正确):
  1071006060591-<REDACTED>.apps.googleusercontent.com
  ```

### E-03: Cockpit 扩展使用相同 credentials
- **类型**: script-result
- **来源**: Cockpit 扩展 JS bundle
- **复现方法**:
  ```bash
  grep -oP '\d+-[a-z0-9]+\.apps\.googleusercontent\.com' \
    ~/.antigravity-server/extensions/jlcodes.antigravity-cockpit-2.1.29-universal/out/extension.js
  grep -oP 'GOCSPX-[A-Za-z0-9_-]+' \
    ~/.antigravity-server/extensions/jlcodes.antigravity-cockpit-2.1.29-universal/out/extension.js
  ```
- **结果**: 与 LS binary 组1 完全一致

### E-04: LS standalone 模式的 token 文件名
- **类型**: script-result
- **来源**: LS binary strings 搜索
- **复现方法**:
  ```bash
  strings ~/.antigravity-server/bin/1.19.6-*/extensions/antigravity/bin/language_server_linux_x64 \
    | grep 'jetski-standalone'
  ```
- **结果**: `jetski-standalone-oauth-token` (确认文件名硬编码)

### E-05: 双账号 refresh 成功
- **类型**: script-result
- **来源**: curl + Google OAuth2 API
- **复现方法**:
  ```bash
  curl -s -X POST https://oauth2.googleapis.com/token \
    -d "client_id=1071006060591-<REDACTED>.apps.googleusercontent.com\
    &client_secret=GOCSPX-<REDACTED-1>\
    &refresh_token=<REFRESH_TOKEN>\
    &grant_type=refresh_token"
  ```
- **结果**: 两个账号均返回 `access_token` + `expires_in: 3599`

### E-06: 组2 credentials 不支持 refresh_token 流程
- **类型**: log
- **来源**: curl 测试
- **内容**: `unauthorized_client: Unauthorized`

### E-07: 旧 CLIENT_ID 失效
- **类型**: log
- **来源**: curl 测试 + oauth-login.js code exchange
- **内容**:
  ```
  CLIENT_ID 681255809395-... → invalid_client: Unauthorized (code exchange)
  CLIENT_ID 071006060591-... → invalid_client: The OAuth client was not found (截断的 ID)
  ```

### E-08: E2E 验证 — LS daemon 双账号启动成功
- **类型**: script-result
- **来源**: `lib/core/oauth/__tests__/oauth-e2e.test.js`
- **复现方法**:
  ```bash
  # 测试第二个账号
  node lib/core/oauth/__tests__/oauth-e2e.test.js --gemini-dir .gemini-alt --port 42300

  # 测试第一个账号
  node lib/core/oauth/__tests__/oauth-e2e.test.js --gemini-dir .gemini --port 42300
  ```
- **结果**: 两个账号均通过 Heartbeat + CreateCascade 验证

## 4. 探索过程 (Exploration Summary)

用户发现 DaemonLS 只有一个账号 (tiemuer2025) 的 token, 想添加第二个账号:
  ↓
尝试用现有 `oauth-login.js` 走 OAuth flow → Google 授权页面正常打开:
  ↓
code exchange 阶段失败: `invalid_client: Unauthorized` → CLIENT_SECRET 或 CLIENT_ID 已被 rotate:
  ↓
从 LS binary (v1.19.6) 用 strings + grep 提取 OAuth credentials → 找到两组:
  ↓
用提取到的 CLIENT_ID `071006060591` 测试 refresh → `The OAuth client was not found`:
  ↓
**关键转折**: 用户质疑 "CLIENT_ID 被删除" 的结论 — 如果被删了, 全世界用户都会坏掉:
  ↓
重新检查 strings 输出, 发现正则 `\d{12}` 截断了一位 → 正确的 CLIENT_ID 是 13 位 `1071006060591`:
  ↓
用正确的 CLIENT_ID 测试 → 两个账号 refresh 全部成功:
  ↓
创建完整 OAuth 模块 (`lib/core/oauth/`) 并用 CLI 生成第二个账号的 token 文件:
  ↓
用户再次质疑: "你验证过 LS daemon 能真正用这个 token 吗?":
  ↓
编写 E2E 验证脚本, 启动真实 LS daemon + Heartbeat + CreateCascade → 两个账号均通过:
  ↓
更新 `ls-daemon.sh` 支持 `GEMINI_DIR` 环境变量实现多账号切换

## 5. 聊天记录 (Chat Excerpts)

### 片段 1: 用户质疑 CLIENT_ID 被删除
- **对话 ID**: `159dd464-751f-4343-ba27-eb56e458f4dd`
- **上下文**: 所有 CLIENT_ID 测试均失败后, AI 得出 "CLIENT_ID 被 Google 删除" 的结论

> **USER**: CLIENT_ID 071006060591 本身已经被 Google 删除/吊销了。什么意思?
> **AI**: 等等，你说得对。如果这个 CLIENT_ID 是 Google 自己产品里硬编码的, 不可能被删除。
> 我可能提取 CLIENT_ID 时截断了! 正则 `\d{12}` 只匹配了 12 位, 但实际是 13 位 `1071006060591`。

### 片段 2: 用户要求 E2E 验证
- **对话 ID**: `159dd464-751f-4343-ba27-eb56e458f4dd`
- **上下文**: token 创建成功后

> **USER**: 等等。你有没有验证过 sh 能够正确用账号来使用?
> **AI**: 好问题。我们验证了 OAuth token 创建链路, 但还没验证 LS daemon 能不能真正用这个 token 跑起来。
