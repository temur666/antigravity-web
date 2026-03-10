# YOLO 系统测试 & CSRF 自动发现修复

## 修改模块
- `scripts/yolo.js`
- `tests/yolo/` (新增)
- `docs/tasks/yolo-test.md` (新增)

## 变更内容

### Bug Fix: CSRF Token 自动发现
`yolo.js` 的默认 CSRF token 硬编码为 `daemon-with-ext-server`，但 LS daemon 启动时生成的是动态 UUID。导致不手动传 `--csrf` 时无法连接 LS。

修复: 启动时调用 `discoverLS()` 自动获取端口和 CSRF，用户显式传参时优先使用。

### 新增: 完整测试套件 (57 assertions)

| 测试文件 | 断言数 | 覆盖点 |
|---------|--------|-------|
| test-yolo-marker.js | 8 | 标记文件熔断逻辑 |
| test-yolo-args.js | 21 | 参数解析 |
| test-yolo-done.js | 11 | 完成 Hook + Telegram |
| test-yolo-grpc.js | 17 | gRPC API 全链路 |
| test-yolo-e2e.js | 10 | 端到端全流程 (16.4s) |
