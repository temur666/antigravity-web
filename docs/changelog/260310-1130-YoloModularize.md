# YOLO 模块化迁移

## 概述

将 `scripts/yolo.js` (496 行) 的业务逻辑拆解为 `lib/yolo/` 模块，并集成到 WebSocket 后端，使前端能控制 YOLO。

## 变更

### 新建 `lib/yolo/`

| 文件 | 职责 |
|------|------|
| `engine.js` | 核心引擎 (EventEmitter)，包含 waitForIdle/safeCall/主循环 |
| `marker.js` | .yolo-done 标记文件读写检测 |
| `logger.js` | 日志模块（同步写入） |
| `config.js` | parseArgs + AUTO_REPLY_TEMPLATE + DEFAULTS |
| `notify.js` | Telegram 通知（从 yolo-done.js 提取） |
| `index.js` | 统一导出 |
| `__tests__/yolo.test.js` | 综合测试 (25 单元 + 4 集成) |

### 瘦身 scripts/

- `scripts/yolo.js`: 496 行 -> 70 行（纯 CLI 入口）
- `scripts/yolo-done.js`: 98 行 -> 24 行（委托 lib/yolo）

### main.js 集成

新增 3 个 WS handler:
- `req_yolo_start` — 启动 YOLO（异步，不阻塞 WS）
- `req_yolo_stop` — 停止 YOLO
- `req_yolo_status` — 查询 YOLO 状态

新增 4 个 WS 广播事件:
- `event_yolo_status` — 运行/停止/错误状态
- `event_yolo_round` — 每轮完成
- `event_yolo_step` — 实时 step 输出
- `event_yolo_error` — 可恢复错误

### 删除

- `tests/yolo/` 目录（5 个文件，已合并到 lib/yolo/__tests__/）

## 测试

```
yolo.test: 29 passed, 0 failed (含 --integration)
controller.integration: 17 passed, 0 failed
```
