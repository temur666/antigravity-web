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
- **F-10** ✓ 浏览器 OAuth 登录流程 (authorization_code flow) 在使用正确的 CLIENT_ID 后已验证成功 (之前因旧 CLIENT_ID 在 code exchange 阶段失败) → `[E-09]` `[E-10]`
- **F-11** ✓ refresh_token 的实际获取来源是 Cockpit 扩展 (jlcodes.antigravity-cockpit), 该扩展有显示账号配额的功能, 登录后可直接导出 refresh_token → `[E-09]`

## 2. 结论 (Conclusions)

LS standalone 模式的 OAuth 认证使用组1 credentials (`1071006060591-...` + `GOCSPX-K58FWR...`), 与 Cockpit 扩展一致 (F-01, F-03)。原 `oauth-login.js` 使用的旧 CLIENT_ID 已被 Google 吊销 (F-07), 是此次调查的触发原因。

多账号支持通过 `-gemini_dir` 参数实现, 每个账号使用独立的 gemini 目录 (F-08):
- `.gemini` → tiemuer2025@gmail.com (默认)
- `.gemini-alt` → peakerlomascolo163@gmail.com

refresh_token 的获取方式 (F-10, F-11):
- **实际可行**: 浏览器 OAuth authorization_code flow — 使用正确的 CLIENT_ID (`1071006060591-...`) + 对齐 Scopes 后验证成功, 账号 tiemuer2025@gmail.com
- **实际可行**: 通过 Cockpit 扩展获取 — 该扩展在 IDE 中登录 Google 账号后, 可导出 refresh_token 供 standalone LS 使用
- **已修复**: 之前浏览器流程失败是因为旧 CLIENT_ID (`681255809395`) 的 secret 已被 Google rotate

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

### E-09: 浏览器 OAuth 登录失败 + Cockpit 扩展成功
- **类型**: log
- **来源**: 终端输出 + 浏览器
- **浏览器流程复现**:
  ```bash
  # 1. 在远程 GCP 机器上启动 oauth-login.js
  node scripts/oauth-login.js --gemini-dir .gemini-alt
  # 输出: OAuth URL + 等待回调...

  # 2. 本地机器 SSH 端口转发
  ssh -L 9876:127.0.0.1:9876 gcp-iap

  # 3. 本地浏览器打开 OAuth URL → Google 授权页面正常打开
  #    用户选择第二个 Google 账号 → 授权成功 → 浏览器回调到 localhost:9876

  # 4. 回调到达, 但 code exchange 失败:
  #    POST https://oauth2.googleapis.com/token → invalid_client: Unauthorized
  #    原因: oauth-login.js 中的 CLIENT_SECRET 已被 Google rotate
  ```
- **Cockpit 扩展流程**:
  ```
  IDE 中安装 jlcodes.antigravity-cockpit v2.1.29 → 显示账号配额
  → 扩展已用正确的 CLIENT_ID 完成 OAuth 登录
  → 从扩展中导出 refresh_token (JSON 格式, 包含 email + refresh_token)
  → 用 refresh_token + 从 LS binary 提取的 CLIENT_ID 创建 token 文件
  ```
- **结论**: 浏览器流程因旧 CLIENT_SECRET 失败, 但 Cockpit 扩展提供了可用的 refresh_token

### E-10: 浏览器 OAuth 登录验证成功 (修复后)
- **类型**: script-result
- **来源**: `node lib/core/oauth/index.js login` (更新 CLIENT_ID 和 Scopes 后)
- **复现方法**:
  ```bash
  # GCP 服务器上
  node lib/core/oauth/index.js login --port 9876 --gemini-dir .gemini

  # 本地 SSH 端口转发
  ssh -L 9876:127.0.0.1:9876 gcp-iap

  # 本地浏览器打开输出的 OAuth URL
  ```
- **结果**: Login Success, Account: tiemuer2025@gmail.com
- **修复内容**: 更新 Scopes (去掉 openid, 加上 cclog + experimentsandconfigs, 与 Cockpit 扩展对齐)
- **根因确认**: 之前失败是因为旧 CLIENT_ID, 不是流程问题

## 4. 探索过程 (Exploration Summary)

用户发现 DaemonLS 只有一个账号 (tiemuer2025) 的 token, 想添加第二个账号:
  ↓
**尝试1: 浏览器 OAuth 登录 (失败)**:
  运行 `oauth-login.js` → 在 GCP 远程机器上启动 HTTP 回调服务器 (port 9876)
  → SSH 端口转发 `ssh -L 9876:127.0.0.1:9876 gcp-iap`
  → 本地浏览器打开 Google OAuth URL → 授权页面正常打开
  → 用第二个 Google 账号登录并授权 → Google 回调到 localhost:9876
  → 回调到达服务器, 但 code exchange 失败: `invalid_client: Unauthorized`
  → 结论: oauth-login.js 中硬编码的旧 CLIENT_SECRET 已被 Google rotate
  ↓
**尝试2: 从 LS binary 提取新 credentials, 更新 oauth-login.js (部分成功)**:
  从 LS binary (v1.19.6) 用 strings + grep 提取 OAuth credentials → 找到两组
  ↓
  用提取到的 CLIENT_ID `071006060591` (12位) 测试 refresh → `The OAuth client was not found`
  ↓
  **死胡同**: 所有已知 CLIENT_ID 测试均失败, AI 得出 "credentials 全部被 Google 吊销" 的错误结论
  ↓
  **关键转折**: 用户质疑 — 如果被删了, 全世界用户都会坏掉
  → 重新检查 strings 输出, 发现正则 `\d{12}` 截断了一位
  → 正确的 CLIENT_ID 是 13 位 `1071006060591`
  ↓
  用正确的 CLIENT_ID 测试 → refresh 成功!
  ↓
**问题: refresh_token 从哪来?**
  用户提供了二个账号的 refresh_token, 来源是 Cockpit 扩展 (jlcodes.antigravity-cockpit)
  → 该扩展是一个显示 Gemini 账号配额的 IDE 插件
  → 用户在 IDE 中用两个 Google 账号登录该扩展后, 导出了 refresh_token
  → 验证: Cockpit 扩展使用的 CLIENT_ID 与 LS binary 中的组1 完全一致
  ↓
用 Cockpit 扩展的 refresh_token + LS binary 的 CLIENT_ID 创建 token 文件 → 成功:
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
