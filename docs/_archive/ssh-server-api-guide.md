# Antigravity SSH 服务器端 API 获取指南

## 目标

在 SSH 远程服务器上，直接通过本地 Language Server 的 gRPC API 获取对话历史数据。

## 背景

Antigravity IDE 通过 SSH 连接远程服务器时，会在远程运行一个 `language_server_linux` 进程。这个进程：
- 监听本地端口，提供 gRPC API
- 持有 CSRF token（在启动参数中）
- 能解密本地 `~/.gemini/antigravity/conversations/*.pb` 文件并返回对话内容

## 第一步：找到 Language Server 进程

```bash
ps aux | grep language_server | grep -v grep
```

输出示例：
```
tiemuer  2189980  4.8  4.6 5062496 375180 ?  Ssl  03:27  33:29 /home/tiemuer/.antigravity/... --csrf_token 95179dd3-0936-4cdf-9xxx --extension_server_port 12345 ...
tiemuer  2264771  6.3  4.0 4936080 327244 ?  Sl   14:52   0:18 /home/tiemuer/.antigravity/... --csrf_token 628f1d91-d344-4271-8xxx ...
```

提取关键信息：
```bash
# 提取 CSRF token
ps aux | grep language_server | grep -v grep | grep -oP '\-\-csrf_token\s+\K[a-f0-9-]+'

# 提取 PID
ps aux | grep language_server | grep -v grep | awk '{print $2}'
```

## 第二步：找到 gRPC 端口

Language Server 监听多个端口，需要找到提供 gRPC ConnectRPC 服务的那个。

```bash
# 对每个 LS 进程，列出它监听的端口
PID=2189980  # 替换为实际 PID
ss -tlnp | grep "pid=$PID"
```

输出示例：
```
LISTEN  0  128  127.0.0.1:36117  0.0.0.0:*  users:(("language_server",pid=2189980,fd=12))
LISTEN  0  128  127.0.0.1:36118  0.0.0.0:*  users:(("language_server",pid=2189980,fd=15))
LISTEN  0  128  127.0.0.1:36120  0.0.0.0:*  users:(("language_server",pid=2189980,fd=18))
```

## 第三步：验证哪个是 gRPC 端口

对每个端口发送测试请求：

```bash
CSRF="95179dd3-0936-4cdf-9xxx"  # 替换为实际 CSRF
PORT=36118                       # 替换为候选端口

curl -sk -X POST \
  https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetUnleashData \
  -H "Content-Type: application/json" \
  -H "x-codeium-csrf-token: $CSRF" \
  -H "connect-protocol-version: 1" \
  -d '{}'
```

- 返回 `200` + JSON 数据 → ✅ 这是 gRPC 端口
- 返回 `401` → CSRF 不对
- 连接拒绝 → 不是 HTTPS 或不是 gRPC

## 第四步：获取对话内容

```bash
CSRF="95179dd3-0936-4cdf-9xxx"
PORT=36118
CONVERSATION_ID="8b4af5b0-0b1b-4bee-a0f4-0ef27e193fb4"

curl -sk -X POST \
  https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory \
  -H "Content-Type: application/json" \
  -H "x-codeium-csrf-token: $CSRF" \
  -H "connect-protocol-version: 1" \
  -d "{\"cascadeId\":\"$CONVERSATION_ID\"}" \
  -o trajectory.json

# 查看结果
cat trajectory.json | python3 -m json.tool | head -50
```

## 一键测试脚本

把下面的内容保存为 `test-api.sh` 并运行：

```bash
#!/bin/bash
# test-api.sh — 在 SSH 服务器上测试 Antigravity gRPC API
set -e

echo "=== Step 1: 查找 Language Server 进程 ==="
PROCS=$(ps aux | grep language_server | grep -v grep)
if [ -z "$PROCS" ]; then
    echo "❌ 未找到 language_server 进程"
    exit 1
fi
echo "$PROCS" | head -5

# 提取第一个进程的信息
FIRST_LINE=$(echo "$PROCS" | head -1)
PID=$(echo "$FIRST_LINE" | awk '{print $2}')
CSRF=$(echo "$FIRST_LINE" | grep -oP '\-\-csrf_token\s+\K[a-f0-9-]+')

echo ""
echo "PID: $PID"
echo "CSRF: $CSRF"

echo ""
echo "=== Step 2: 查找监听端口 ==="
PORTS=$(ss -tlnp 2>/dev/null | grep "pid=$PID" | grep -oP '127\.0\.0\.1:\K\d+' || \
        netstat -tlnp 2>/dev/null | grep "$PID/" | grep -oP '127\.0\.0\.1:\K\d+')
echo "端口: $PORTS"

echo ""
echo "=== Step 3: 验证 gRPC 端口 ==="
GRPC_PORT=""
for PORT in $PORTS; do
    STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X POST \
        "https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetUnleashData" \
        -H "Content-Type: application/json" \
        -H "x-codeium-csrf-token: $CSRF" \
        -H "connect-protocol-version: 1" \
        -d '{}' 2>/dev/null || echo "0")
    echo "  Port $PORT: HTTP $STATUS"
    if [ "$STATUS" = "200" ]; then
        GRPC_PORT=$PORT
        echo "  ✅ 找到 gRPC 端口!"
        break
    fi
done

if [ -z "$GRPC_PORT" ]; then
    echo "❌ 未找到 gRPC 端口"
    exit 1
fi

echo ""
echo "=== Step 4: 列出对话文件 ==="
CONV_DIR="$HOME/.gemini/antigravity/conversations"
if [ -d "$CONV_DIR" ]; then
    COUNT=$(ls "$CONV_DIR"/*.pb 2>/dev/null | wc -l)
    echo "对话文件数: $COUNT"
    # 取第一个文件的 UUID 作为测试
    FIRST_PB=$(ls "$CONV_DIR"/*.pb 2>/dev/null | head -1)
    CONV_ID=$(basename "$FIRST_PB" .pb)
    echo "测试对话 ID: $CONV_ID"
else
    echo "对话目录不存在: $CONV_DIR"
    exit 1
fi

echo ""
echo "=== Step 5: 获取对话内容 ==="
RESULT=$(curl -sk -X POST \
    "https://127.0.0.1:$GRPC_PORT/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory" \
    -H "Content-Type: application/json" \
    -H "x-codeium-csrf-token: $CSRF" \
    -H "connect-protocol-version: 1" \
    -d "{\"cascadeId\":\"$CONV_ID\"}" 2>/dev/null)

# 检查结果
if echo "$RESULT" | grep -q '"trajectory"'; then
    STEPS=$(echo "$RESULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d.get('trajectory',{}).get('steps',[])))" 2>/dev/null || echo "?")
    echo "✅ 成功! Steps: $STEPS"
    echo "$RESULT" | python3 -m json.tool 2>/dev/null | head -20
else
    echo "❌ 失败: $RESULT" | head -5
fi

echo ""
echo "=== 汇总 ==="
echo "CSRF: $CSRF"
echo "gRPC Port: $GRPC_PORT"
echo "对话数: $COUNT"
echo ""
echo "获取任意对话:"
echo "  curl -sk -X POST https://127.0.0.1:$GRPC_PORT/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'x-codeium-csrf-token: $CSRF' \\"
echo "    -H 'connect-protocol-version: 1' \\"
echo "    -d '{\"cascadeId\":\"<UUID>\"}' -o output.json"
```

## API 参考

| 方法 | 用途 | Body |
|------|------|------|
| `GetUnleashData` | 验证端口+CSRF | `{}` |
| `GetCascadeTrajectory` | 获取完整对话 | `{"cascadeId":"UUID"}` |
| `StartCascade` | 创建新对话 | `{}` |
| `GetCommandModelConfigs` | 获取模型配置 | `{}` |

所有请求格式：
- **协议**: HTTPS (自签名证书，需 `-k`)
- **路径**: `/exa.language_server_pb.LanguageServerService/{方法名}`
- **Headers**: `Content-Type: application/json`, `x-codeium-csrf-token: {token}`, `connect-protocol-version: 1`

## 对话数据结构

`GetCascadeTrajectory` 返回的 JSON：

```json
{
  "trajectory": {
    "cascadeId": "UUID",
    "steps": [
      { "type": "CORTEX_STEP_TYPE_USER_INPUT", "userInput": { "items": [{ "text": "..." }] } },
      { "type": "CORTEX_STEP_TYPE_PLANNER_RESPONSE", "plannerResponse": { "response": "...", "rawThinkingText": "..." } },
      { "type": "CORTEX_STEP_TYPE_TOOL_CALL", "toolCall": { "toolName": "...", "input": "..." } }
    ],
    "generatorMetadata": [{ "chatModel": { "usage": { "model": "...", "inputTokens": "...", "outputTokens": "..." } } }]
  },
  "status": "CASCADE_RUN_STATUS_IDLE",
  "numTotalSteps": 34
}
```
