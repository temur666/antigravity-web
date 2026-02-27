/**
 * store/ws-client.ts — WebSocket 客户端
 *
 * 职责:
 *   - 管理 WebSocket 连接生命周期
 *   - 发送 JSON 消息 (send / sendAndWait)
 *   - 分发接收到的消息给订阅者
 *   - 自动重连 (可选)
 *
 * 设计:
 *   - 通过工厂函数注入 WebSocket，方便测试
 *   - sendAndWait 基于 reqId 做请求-响应匹配
 */

import type { ClientMessage, ServerMessage } from '@/types';

// ========== 连接状态 ==========

export const WSClientState = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
} as const;

export type WSClientState = (typeof WSClientState)[keyof typeof WSClientState];

// ========== 类型 ==========

type MessageHandler = (msg: ServerMessage) => void;
type StateHandler = (state: WSClientState) => void;

type WSFactory = () => WebSocket;

interface PendingRequest {
    resolve: (msg: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
}

// ========== WSClient ==========

export class WSClient {
    private ws: WebSocket | null = null;
    private factory: WSFactory;
    private messageHandlers: Set<MessageHandler> = new Set();
    private stateHandlers: Set<StateHandler> = new Set();
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private reqCounter = 0;
    private _state: WSClientState = WSClientState.DISCONNECTED;
    private destroyed = false;

    constructor(factory?: WSFactory) {
        this.factory = factory ?? (() => new WebSocket(this.getWSUrl()));
    }

    // ========== 公共 API ==========

    get state(): WSClientState {
        return this._state;
    }

    /**
     * 获取 WebSocket URL (基于当前页面 location)
     */
    private getWSUrl(): string {
        if (typeof window === 'undefined') return 'ws://localhost:3210';
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}`;
    }

    /**
     * 建立连接
     */
    connect(): void {
        if (this.destroyed) return;
        if (this._state !== WSClientState.DISCONNECTED) return;

        this.setState(WSClientState.CONNECTING);
        const ws = this.factory();
        this.ws = ws;

        ws.onopen = () => {
            this.setState(WSClientState.CONNECTED);
        };

        ws.onclose = () => {
            this.ws = null;
            this.setState(WSClientState.DISCONNECTED);
            this.rejectAllPending('Connection closed');
        };

        ws.onerror = () => {
            // onclose 会在 onerror 后触发，不需要额外处理
        };

        ws.onmessage = (event: MessageEvent) => {
            this.handleRawMessage(event.data);
        };
    }

    /**
     * 主动断开连接
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.setState(WSClientState.DISCONNECTED);
        this.rejectAllPending('Disconnected');
    }

    /**
     * 发送消息
     * @returns true 发送成功, false 未连接
     */
    send(msg: ClientMessage): boolean {
        if (!this.ws || this._state !== WSClientState.CONNECTED) {
            return false;
        }
        this.ws.send(JSON.stringify(msg));
        return true;
    }

    /**
     * 发送请求并等待响应 (基于 reqId 匹配)
     * @param msg 请求消息 (必须有 reqId)
     * @param timeout 超时毫秒数
     * @returns 匹配的响应消息
     */
    sendAndWait(msg: ClientMessage & { reqId?: string }, timeout = 10000): Promise<ServerMessage> {
        return new Promise((resolve) => {
            const reqId = msg.reqId ?? this.nextReqId();
            const msgWithId = { ...msg, reqId };

            const timer = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve({
                    type: 'res_error',
                    reqId,
                    code: 'TIMEOUT',
                    message: `Request ${reqId} timed out after ${timeout}ms`,
                } as ServerMessage);
            }, timeout);

            this.pendingRequests.set(reqId, { resolve, timer });

            if (!this.send(msgWithId as ClientMessage)) {
                clearTimeout(timer);
                this.pendingRequests.delete(reqId);
                resolve({
                    type: 'res_error',
                    reqId,
                    code: 'NOT_CONNECTED',
                    message: 'WebSocket not connected',
                } as ServerMessage);
            }
        });
    }

    /**
     * 生成递增的 reqId
     */
    nextReqId(): string {
        return `r${++this.reqCounter}`;
    }

    // ========== 事件订阅 ==========

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

    // ========== 销毁 ==========

    destroy(): void {
        this.destroyed = true;
        this.disconnect();
        this.messageHandlers.clear();
        this.stateHandlers.clear();
    }

    // ========== 内部方法 ==========

    private setState(newState: WSClientState): void {
        if (this._state === newState) return;
        this._state = newState;
        for (const handler of this.stateHandlers) {
            handler(newState);
        }
    }

    private handleRawMessage(raw: string): void {
        let data: ServerMessage;
        try {
            data = JSON.parse(raw);
        } catch {
            console.warn('[WSClient] 无效 JSON:', raw);
            return;
        }

        if (!data.type) {
            console.warn('[WSClient] 缺少 type 字段:', data);
            return;
        }

        // 检查是否有 pending request 匹配
        const reqId = (data as { reqId?: string }).reqId;
        if (reqId && this.pendingRequests.has(reqId)) {
            const pending = this.pendingRequests.get(reqId)!;
            clearTimeout(pending.timer);
            this.pendingRequests.delete(reqId);
            pending.resolve(data);
        }

        // 分发给所有 handler
        for (const handler of this.messageHandlers) {
            handler(data);
        }
    }

    private rejectAllPending(reason: string): void {
        for (const [reqId, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.resolve({
                type: 'res_error',
                reqId,
                code: 'CONNECTION_LOST',
                message: reason,
            } as ServerMessage);
        }
        this.pendingRequests.clear();
    }
}
