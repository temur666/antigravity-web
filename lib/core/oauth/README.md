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

## OAuth Scopes

请求的权限范围 (与 Cockpit 扩展 / LS binary 对齐):

| Scope | 用途 |
|-------|------|
| `cloud-platform` | Google Cloud API 核心访问权限 |
| `userinfo.email` | 获取用户邮箱 |
| `userinfo.profile` | 获取用户名/头像 |
| `cclog` | Cloud Code 日志服务 |
| `experimentsandconfigs` | Google 实验/配置服务 (A/B 测试、feature flags) |

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

# 浏览器 OAuth 登录 (已验证可用, 需要 SSH 端口转发)
# 本地: ssh -L 9876:127.0.0.1:9876 <server>
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


## 用户笔记
oken 文件 (三者的交汇点)
路径: ~/<gemini_dir>/jetski-standalone-oauth-token

```json
{
  "access_token": "ya29...",     ← 短期通行证 (约1小时)
  "token_type": "Bearer",
  "refresh_token": "1//0e...",   ← 长期钥匙 (几乎不过期)
  "expiry": "2026-03-10T..."     ← access_token 的过期时间
}
```

关键: LS daemon 启动后，读这个文件拿到 access_token 去访问 Google API。当 access_token 过期时，LS 用文件里的 refresh_token + 自己内置的 CLIENT_ID/SECRET 自动刷新。你的代码也用同一套 CLIENT_ID/SECRET 做同样的事。

### 多账号是怎么隔离的
不是靠什么复杂机制，就是不同目录放不同的 token 文件：

~/.gemini/jetski-standalone-oauth-token          → tiemuer2025@gmail.com
~/.gemini-alt/jetski-standalone-oauth-token      → peakerlomascolo163@gmail.com
LS daemon 通过 -gemini_dir 参数决定读哪个目录。你的 ls-daemon.sh 通过 GEMINI_DIR 环境变量控制。

### LS 用文件里的 refresh_token + 自己内置的 CLIENT_ID/SECRET 自动刷新 2获取1是吗？缺一不可

对，完全正确。三件东西缺一不可：

refresh_token  +  CLIENT_ID  +  CLIENT_SECRET
    (用户的)        (应用的)       (应用的)
发给 Google 的请求就是这三个拼在一起：

```
POST https://oauth2.googleapis.com/token
client_id=1071006060591-xxx.apps.googleusercontent.com
&client_secret=GOCSPX-xxx
&refresh_token=1//0e-xxx
&grant_type=refresh_token
Google 验证逻辑：
```

CLIENT_ID + CLIENT_SECRET → 确认"是哪个应用在请求"
refresh_token → 确认"是哪个用户授权的"
三者匹配 → 返回新的 access_token
少了任何一个，Google 都会拒绝。这也解释了 FINDINGS 里的两个失败案例：

旧 CLIENT_ID (681255809395) → invalid_client，应用身份不对
组2 的 CLIENT_ID/SECRET 搭配 refresh_token → unauthorized_client，那组 credentials 不支持这个流程