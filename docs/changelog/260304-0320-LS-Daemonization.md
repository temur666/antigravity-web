# LS Daemon 化

> 2026-03-04 03:20 | feat: Language Server 独立于 IDE 运行

## 修改模块

| 文件 | 修改 |
|------|------|
| `scripts/ls-daemon.sh` | 新增 - LS daemon 启动/停止/状态管理脚本 |
| `ecosystem.config.js` | 新增 ls-daemon PM2 进程配置 |
| `language_server_linux_x64` | 二进制 patch: `1.11.0` -> `1.19.6` |

## 功能

Language Server 现在可以独立于 IDE 运行，由 PM2 管理。

### 关键参数

```bash
-persistent_mode=true    # 写 discovery file, IDE 关闭不退出
-standalone=true         # 不依赖 extension server
-server_port=42100       # 固定端口
```

### 二进制 Patch

LS 在 standalone 模式下默认自报版本 `1.11.0`（Go 常量 fallback），
导致谷歌云端认为版本过低，拒绝使用 Gemini 3.1 Pro 等新模型。

用 `dd` 精确替换二进制中唯一的 `1.11.0` 字符串为 `1.19.6`：
- offset: 103594449
- 长度: 6 bytes (等长替换，零风险)
- 原始文件备份: `language_server_linux_x64.original`

### 验证结果

| 测试 | 结果 |
|------|------|
| Heartbeat | OK |
| GetUserStatus | tiemuer2025@gmail.com / Google AI Ultra |
| Gemini 3 Flash (M18) | OK |
| **Gemini 3.1 Pro (M37)** | **OK (patch 后解除限制)** |
| PM2 进程管理 | online, autorestart |
| Discovery file 自动写入 | `~/.gemini/antigravity/daemon/ls_*.json` |

### PM2 管理

```bash
pm2 start ecosystem.config.js --only ls-daemon
pm2 stop ls-daemon
pm2 restart ls-daemon
pm2 logs ls-daemon
```

### 注意事项

- LS daemon 使用 `~/.gemini/oauth_creds.json` 中的凭据 (tiemuer2025@gmail.com)
- IDE 的 LS 使用 IDE 内部凭据 (peakerlomascolo163@gmail.com)
- 两个 LS 可以同时运行，端口不同互不冲突
- IDE 升级后可能需要重新 patch 新版本的二进制
