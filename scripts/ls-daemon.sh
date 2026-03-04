#!/bin/bash
# ============================================================================
# LS Daemon 启动脚本
# 
# 用途: 独立于 IDE 运行 Antigravity Language Server
# 特性:
#   - persistent_mode: 自动写 discovery file, IDE 关闭后不退出
#   - standalone: 不依赖 extension server
#   - 版本已 patch: 1.11.0 -> 1.19.6 (解除模型限制)
#
# 使用方式:
#   ./scripts/ls-daemon.sh           # 启动 daemon
#   ./scripts/ls-daemon.sh stop      # 停止 daemon
#   ./scripts/ls-daemon.sh status    # 查看状态
#   ./scripts/ls-daemon.sh restart   # 重启
#
# PM2 集成:
#   pm2 start ecosystem.config.js --only ls-daemon
# ============================================================================

set -euo pipefail

# --- 配置 ---
LS_VERSION="1.19.6"
LS_HASH="d2597a5c475647ed306b22de1e39853c7812d07d"
LS_BIN="$HOME/.antigravity-server/bin/${LS_VERSION}-${LS_HASH}/extensions/antigravity/bin/language_server_linux_x64"
LS_PORT="${LS_PORT:-42100}"
CLOUD_ENDPOINT="https://daily-cloudcode-pa.googleapis.com"
DISCOVERY_DIR="$HOME/.gemini/antigravity/daemon"
LOG_FILE="$DISCOVERY_DIR/ls_daemon.log"

# CSRF Token: 从环境变量读取或自动生成
CSRF_TOKEN="${LS_CSRF_TOKEN:-$(python3 -c "import uuid; print(uuid.uuid4())")}"

# --- 函数 ---
find_daemon_pid() {
    pgrep -f "language_server.*persistent_mode.*server_port=${LS_PORT}" 2>/dev/null || true
}

status() {
    local pid
    pid=$(find_daemon_pid)
    if [ -n "$pid" ]; then
        echo "[OK] LS Daemon running (PID: $pid, port: $LS_PORT)"
        # 显示 discovery file
        local df
        df=$(ls "$DISCOVERY_DIR"/ls_*.json 2>/dev/null | head -1)
        if [ -n "$df" ]; then
            echo "[OK] Discovery file: $df"
            cat "$df"
        fi
        return 0
    else
        echo "[--] LS Daemon not running"
        return 1
    fi
}

stop() {
    local pid
    pid=$(find_daemon_pid)
    if [ -n "$pid" ]; then
        echo "Stopping LS Daemon (PID: $pid)..."
        kill "$pid"
        sleep 2
        if kill -0 "$pid" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$pid"
        fi
        echo "Stopped."
    else
        echo "LS Daemon not running."
    fi
}

start() {
    # 检查二进制是否存在
    if [ ! -x "$LS_BIN" ]; then
        echo "ERROR: LS binary not found: $LS_BIN"
        exit 1
    fi

    # 检查是否已经在运行
    local pid
    pid=$(find_daemon_pid)
    if [ -n "$pid" ]; then
        echo "LS Daemon already running (PID: $pid). Use 'restart' to restart."
        exit 0
    fi

    # 检查端口是否被占用
    if ss -tlnp 2>/dev/null | grep -q ":${LS_PORT} "; then
        echo "ERROR: Port $LS_PORT is already in use."
        echo "Check: ss -tlnp | grep :$LS_PORT"
        exit 1
    fi

    # 确保 discovery 目录存在
    mkdir -p "$DISCOVERY_DIR"

    echo "Starting LS Daemon..."
    echo "  Binary:  $LS_BIN"
    echo "  Port:    $LS_PORT"
    echo "  CSRF:    $CSRF_TOKEN"
    echo "  Log:     $LOG_FILE"

    # 启动
    exec "$LS_BIN" \
        -persistent_mode=true \
        -csrf_token="$CSRF_TOKEN" \
        -server_port="$LS_PORT" \
        -random_port=false \
        -standalone=true \
        -workspace_id=file_home_tiemuer \
        -cloud_code_endpoint="$CLOUD_ENDPOINT" \
        -app_data_dir=antigravity \
        -gemini_dir=.gemini \
        -enable_lsp=false \
        2>&1
}

# --- 主入口 ---
case "${1:-start}" in
    start)    start ;;
    stop)     stop ;;
    status)   status ;;
    restart)  stop; sleep 1; start ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        exit 1
        ;;
esac
