# lib/core/oauth/ — OAuth 认证模块

> LS Daemon standalone 模式的 OAuth Token 管理。支持多账号。

---

## 文件结构

```
oauth/
  credentials.js                    # OAuth credentials 加载 (环境变量 / 配置文件)
  index.js                          # 完整 OAuth 链路 (CRUD + refresh + login + CLI)
  __tests__/oauth-e2e.test.js       # E2E 验证: 启动真实 LS daemon 验证 token 有效性
  FINDINGS-260310-oauth-credentials.md  # 调研报告: credentials 提取过程和结论
  README.md                         # 本文件
```

## 核心概念

LS Daemon 以 `-standalone=true` 模式运行时, 从本地文件读取 OAuth Token:

```
~/<gemini_dir>/jetski-standalone-oauth-token
```

Token 文件格式:

```json
{ "access_token": "ya29...", "token_type": "Bearer", "refresh_token": "1//...", "expiry": "ISO8601" }
```

LS 使用内置的 CLIENT_ID/SECRET 自动 refresh。本模块使用相同的 credentials。

## Credentials 配置

OAuth CLIENT_ID/SECRET 不在代码中硬编码, 通过以下方式加载 (优先级从高到低):

1. **环境变量**: `AG_OAUTH_CLIENT_ID` + `AG_OAUTH_CLIENT_SECRET`
2. **配置文件**: `~/.gemini/antigravity/oauth-credentials.json`

配置文件格式:

```json
{ "client_id": "<CLIENT_ID>", "client_secret": "<CLIENT_SECRET>" }
```

获取 credentials 的方法见 FINDINGS 文档。

## 多账号

通过不同的 `gemini_dir` 实现账号隔离:

- `.gemini` — 默认账号
- `.gemini-alt` — 第二个账号

`ls-daemon.sh` 使用 `GEMINI_DIR` 环境变量切换:

```bash
GEMINI_DIR=.gemini-alt ./scripts/ls-daemon.sh
```

## CLI 用法

```bash
# 查看 token 状态
node lib/core/oauth status --gemini-dir .gemini

# 从 refresh_token 创建 token 文件
node lib/core/oauth create --refresh-token <token> --gemini-dir .gemini-alt

# 刷新过期 token
node lib/core/oauth refresh --gemini-dir .gemini

# 浏览器 OAuth 登录 (需要 SSH 端口转发)
node lib/core/oauth login --gemini-dir .gemini --port 9876
```

## 程序化调用

```javascript
const oauth = require('./lib/core/oauth');

// 确保 token 有效 (自动刷新过期 token)
const token = await oauth.ensureValidToken('.gemini-alt');

// 从 refresh_token 创建新 token 文件
const { filePath, email } = await oauth.createTokenFromRefresh('1//0e...', '.gemini-alt');

// 读取 / 检查 / 保存
const token = oauth.readToken('.gemini');
const expired = oauth.isTokenExpired(token);
oauth.saveToken('.gemini', tokenData);
```

## E2E 测试

验证完整链路: Token 文件 → LS daemon 启动 → Heartbeat → CreateCascade。

```bash
node lib/core/oauth/__tests__/oauth-e2e.test.js --gemini-dir .gemini-alt --port 42300
```
