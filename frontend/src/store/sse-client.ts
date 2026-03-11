/**
 * store/sse-client.ts — SSE 客户端
 *
 * 替代 ws-client.ts，职责：
 *   - 管理 EventSource 连接生命周期
 *   - 收到 SSE 消息 → parse JSON → 分发给订阅者
 *   - 断线自动重连（EventSource 浏览器原生支持，但需要处理 error → closed）
 *   - 状态通知（CONNECTING / CONNECTED / DISCONNECTED）
 */

import type { ServerMessage } from '@/types';

// ========== 连接状态 ==========

export const SSEClientState = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
} as const;

export type SSEClientStateType = typeof SSEClientState[keyof typeof SSEClientState];

// ========== 类型 ==========

type MessageHandler = (msg: ServerMessage) => void;
type StateHandler = (state: SSEClientStateType) => void;

// ========== SSEClient ==========

export class SSEClient {
    private es: EventSource | null = null;
    private messageHandlers: Set<MessageHandler> = new Set();
    private stateHandlers: Set<StateHandler> = new Set();
    private _state: SSEClientStateType = SSEClientState.DISCONNECTED;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelay = 1000;
    private readonly maxReconnectDelay = 30000;
    private destroyed = false;

    // ── 接口计数器（用于生成 reqId，兼容旧代码调用点） ──
    private _reqCounter = 0;

    /** 连接 SSE 端点 */
    connect(): void {
        if (this.destroyed) return;
        if (this.es) return; // 已在连接

        this.setState(SSEClientState.CONNECTING);
        this.es = new EventSource('/api/events/stream');

        this.es.onopen = () => {
            this.reconnectDelay = 1000; // 重置退避
            this.setState(SSEClientState.CONNECTED);
        };

        this.es.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as ServerMessage;
                for (const handler of this.messageHandlers) {
                    handler(msg);
                }
            } catch (err) {
                console.warn('[SSEClient] parse error:', err);
            }
        };

        this.es.onerror = () => {
            // onerror 后 EventSource 会自动尝试重连（CONNECTING 状态）
            // 如果 readyState 变为 CLOSED，说明连接已无法恢复，需要手动重建
            if (this.es?.readyState === EventSource.CLOSED) {
                this.es.close();
                this.es = null;
                this.setState(SSEClientState.DISCONNECTED);
                this.scheduleReconnect();
            } else {
                // 正在自动重连中
                this.setState(SSEClientState.CONNECTING);
            }
        };
    }

    /** 主动断开 */
    disconnect(): void {
        this.clearReconnect();
        if (this.es) {
            this.es.close();
            this.es = null;
        }
        this.setState(SSEClientState.DISCONNECTED);
    }

    /** 获取当前状态 */
    get state(): SSEClientStateType {
        return this._state;
    }

    // ── 消息订阅 ──

    onMessage(handler: MessageHandler): void {
        this.messageHandlers.add(handler);
    }

    offMessage(handler: MessageHandler): void {
        this.messageHandlers.delete(handler);
    }

    onStateChange(handler: StateHandler): void {
        this.stateHandlers.add(handler);
    }

    offStateChange(handler: StateHandler): void {
        this.stateHandlers.delete(handler);
    }

    // ── 兼容 WSClient 的 send / nextReqId（供 autoApproveIfWaiting 等调用点使用） ──
    // 注意：send 在 SSE 模式下是 fire-and-forget 的 REST 调用（由调用方自行处理）
    // 这里保留接口签名，具体行为由 app-store 在迁移过渡期处理

    /** 生成递增的 reqId（兼容旧接口，新代码不依赖此值） */
    nextReqId(): string {
        return String(++this._reqCounter);
    }

    /** 销毁，清理所有资源 */
    destroy(): void {
        this.destroyed = true;
        this.disconnect();
        this.messageHandlers.clear();
        this.stateHandlers.clear();
    }

    // ── 私有方法 ──

    private setState(newState: SSEClientStateType): void {
        if (this._state === newState) return;
        this._state = newState;
        for (const handler of this.stateHandlers) {
            handler(newState);
        }
    }

    private scheduleReconnect(): void {
        if (this.destroyed) return;
        this.clearReconnect();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) this.connect();
        }, this.reconnectDelay);
        // 指数退避
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
