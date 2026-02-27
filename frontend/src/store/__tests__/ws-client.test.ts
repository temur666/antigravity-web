/**
 * ws-client 单元测试
 *
 * 测试 WebSocket 客户端的连接管理和消息收发逻辑。
 * 使用 Mock WebSocket 隔离网络依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WSClient, WSClientState } from '@/store/ws-client';

// ========== Mock WebSocket ==========

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    url: string;
    onopen: (() => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;

    sentMessages: string[] = [];

    constructor(url: string) {
        this.url = url;
    }

    send(data: string) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code: 1000 });
    }

    // 模拟辅助方法
    simulateOpen() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    simulateMessage(data: object) {
        this.onmessage?.({ data: JSON.stringify(data) });
    }

    simulateClose(code = 1000) {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code });
    }

    simulateError(err: unknown) {
        this.onerror?.(err);
    }
}

// ========== 测试 ==========

describe('WSClient', () => {
    let mockWs: MockWebSocket;
    let client: WSClient;

    beforeEach(() => {
        mockWs = new MockWebSocket('ws://localhost:3210');
        // 用工厂函数注入 Mock
        client = new WSClient(() => mockWs as unknown as WebSocket);
    });

    afterEach(() => {
        client.destroy();
    });

    // ---------- 连接管理 ----------

    describe('连接管理', () => {
        it('初始状态为 DISCONNECTED', () => {
            expect(client.state).toBe(WSClientState.DISCONNECTED);
        });

        it('调用 connect 后状态变为 CONNECTING', () => {
            client.connect();
            expect(client.state).toBe(WSClientState.CONNECTING);
        });

        it('WebSocket open 后状态变为 CONNECTED', () => {
            client.connect();
            mockWs.simulateOpen();
            expect(client.state).toBe(WSClientState.CONNECTED);
        });

        it('连接断开后状态变为 DISCONNECTED', () => {
            client.connect();
            mockWs.simulateOpen();
            mockWs.simulateClose();
            expect(client.state).toBe(WSClientState.DISCONNECTED);
        });

        it('重复调用 connect 不创建新连接', () => {
            const factory = vi.fn(() => mockWs as unknown as WebSocket);
            client = new WSClient(factory);
            client.connect();
            client.connect();
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it('disconnect 关闭 WebSocket', () => {
            client.connect();
            mockWs.simulateOpen();
            client.disconnect();
            expect(client.state).toBe(WSClientState.DISCONNECTED);
        });
    });

    // ---------- 消息发送 ----------

    describe('消息发送', () => {
        it('send 发送 JSON 消息', () => {
            client.connect();
            mockWs.simulateOpen();
            client.send({ type: 'req_status', reqId: '1' });
            expect(mockWs.sentMessages).toHaveLength(1);
            expect(JSON.parse(mockWs.sentMessages[0])).toEqual({
                type: 'req_status',
                reqId: '1',
            });
        });

        it('未连接时 send 不抛异常，返回 false', () => {
            const result = client.send({ type: 'req_status' });
            expect(result).toBe(false);
        });

        it('sendAndWait 返回匹配的响应', async () => {
            client.connect();
            mockWs.simulateOpen();

            const promise = client.sendAndWait({ type: 'req_status', reqId: 'test-1' });

            // 模拟服务端响应
            mockWs.simulateMessage({ type: 'res_status', reqId: 'test-1', ls: { connected: true } });

            const res = await promise;
            expect(res.type).toBe('res_status');
            expect((res as { reqId?: string }).reqId).toBe('test-1');
        });

        it('sendAndWait 超时返回 error', async () => {
            vi.useFakeTimers();
            client.connect();
            mockWs.simulateOpen();

            const promise = client.sendAndWait({ type: 'req_status', reqId: 'timeout-test' }, 1000);

            vi.advanceTimersByTime(1500);

            const res = await promise;
            expect(res.type).toBe('res_error');
            vi.useRealTimers();
        });
    });

    // ---------- 消息接收 ----------

    describe('消息接收', () => {
        it('onMessage 回调收到解析后的消息', () => {
            const handler = vi.fn();
            client.onMessage(handler);
            client.connect();
            mockWs.simulateOpen();
            mockWs.simulateMessage({ type: 'event_ls_status', connected: true });

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'event_ls_status', connected: true }),
            );
        });

        it('多个 handler 都被调用', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            client.onMessage(handler1);
            client.onMessage(handler2);
            client.connect();
            mockWs.simulateOpen();
            mockWs.simulateMessage({ type: 'event_ls_status', connected: true });

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        it('offMessage 移除 handler', () => {
            const handler = vi.fn();
            client.onMessage(handler);
            client.offMessage(handler);
            client.connect();
            mockWs.simulateOpen();
            mockWs.simulateMessage({ type: 'event_ls_status', connected: true });

            expect(handler).not.toHaveBeenCalled();
        });

        it('无效 JSON 消息不触发 handler', () => {
            const handler = vi.fn();
            client.onMessage(handler);
            client.connect();
            mockWs.simulateOpen();
            // 直接发送无效 JSON
            mockWs.onmessage?.({ data: 'not json' });

            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ---------- 状态回调 ----------

    describe('状态回调', () => {
        it('onStateChange 在连接状态变化时触发', () => {
            const handler = vi.fn();
            client.onStateChange(handler);
            client.connect();
            expect(handler).toHaveBeenCalledWith(WSClientState.CONNECTING);

            mockWs.simulateOpen();
            expect(handler).toHaveBeenCalledWith(WSClientState.CONNECTED);
        });
    });

    // ---------- reqId 生成 ----------

    describe('reqId 生成', () => {
        it('nextReqId 生成递增 ID', () => {
            const id1 = client.nextReqId();
            const id2 = client.nextReqId();
            expect(id1).not.toBe(id2);
            expect(typeof id1).toBe('string');
        });
    });
});
