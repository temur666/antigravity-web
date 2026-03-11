/**
 * app-store 单元测试
 *
 * 测试 zustand Store 的状态转换逻辑。
 * 使用 Mock SSEClient + Mock fetch 隔离网络。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAppStore, type AppStore } from '@/store/app-store';
import type { ServerMessage, Step, ConversationSummary } from '@/types';

// ========== Mock api-client ==========

const mockApi = vi.hoisted(() => ({
    getStatus: vi.fn(),
    getConversations: vi.fn(),
    getTrajectory: vi.fn(),
    newChat: vi.fn(),
    sendMessage: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    cancel: vi.fn(),
    deleteConversation: vi.fn(),
    exportMarkdown: vi.fn(),
    approveStep: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    yoloStart: vi.fn(),
    yoloStop: vi.fn(),
    yoloStatus: vi.fn(),
}));

vi.mock('@/store/api-client', () => ({ api: mockApi }));

// ========== Mock SSEClient ==========

function createMockSSEClient() {
    const handlers = new Set<(msg: ServerMessage) => void>();

    return {
        state: 'DISCONNECTED' as string,
        connect: vi.fn(),
        disconnect: vi.fn(),
        nextReqId: vi.fn((() => {
            let n = 0;
            return () => String(++n);
        })()),
        onMessage: vi.fn((handler: (msg: ServerMessage) => void) => {
            handlers.add(handler);
        }),
        offMessage: vi.fn((handler: (msg: ServerMessage) => void) => {
            handlers.delete(handler);
        }),
        onStateChange: vi.fn(),
        offStateChange: vi.fn(),
        destroy: vi.fn(),

        // 测试辅助
        _simulateMessage(msg: ServerMessage) {
            for (const handler of handlers) {
                handler(msg);
            }
        },
    };
}

let mockClient: ReturnType<typeof createMockSSEClient>;
let store: AppStore;

// ========== 测试 ==========

describe('AppStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        window.history.replaceState(null, '', '/');
        mockClient = createMockSSEClient();
        store = createAppStore(mockClient as never);
    });

    // ---------- 初始状态 ----------

    describe('初始状态', () => {
        it('初始 lsConnected 为 false', () => {
            expect(store.getState().lsConnected).toBe(false);
        });

        it('初始 conversations 为空数组', () => {
            expect(store.getState().conversations).toEqual([]);
        });

        it('初始 activeConversationId 为 null', () => {
            expect(store.getState().activeConversationId).toBeNull();
        });

        it('初始 steps 为空数组', () => {
            expect(store.getState().steps).toEqual([]);
        });

        it('初始 debugMode 为 false', () => {
            expect(store.getState().debugMode).toBe(false);
        });
    });

    // ---------- LS 状态事件 ----------

    describe('LS 状态事件', () => {
        it('event_ls_status connected=true 更新 lsConnected', () => {
            mockApi.getConversations.mockResolvedValue({ conversations: [], total: 0 });
            mockApi.getStatus.mockResolvedValue({
                ls: { connected: true, port: 35711, pid: 12345 },
                config: {},
                models: [],
                account: null,
            });

            mockClient._simulateMessage({
                type: 'event_ls_status',
                connected: true,
                port: 35711,
                pid: 12345,
            });
            expect(store.getState().lsConnected).toBe(true);
            expect(store.getState().lsInfo).toEqual({ port: 35711, pid: 12345 });
        });

        it('event_ls_status connected=false 重置 lsInfo', () => {
            mockApi.getConversations.mockResolvedValue({ conversations: [], total: 0 });
            mockApi.getStatus.mockResolvedValue({
                ls: { connected: true, port: 35711, pid: 12345 },
                config: {},
                models: [],
                account: null,
            });

            mockClient._simulateMessage({
                type: 'event_ls_status',
                connected: true,
                port: 35711,
                pid: 12345,
            });
            mockClient._simulateMessage({
                type: 'event_ls_status',
                connected: false,
                port: null,
                pid: null,
            });
            expect(store.getState().lsConnected).toBe(false);
            expect(store.getState().lsInfo).toBeNull();
        });
    });

    // ---------- 对话列表 ----------

    describe('对话列表', () => {
        it('loadConversations 调用 api.getConversations 并更新列表', async () => {
            const conversations: ConversationSummary[] = [
                { id: 'c1', title: '对话1', updatedAt: '2026-01-01', sizeBytes: 100 },
                { id: 'c2', title: '对话2', updatedAt: '2026-01-02', sizeBytes: 200 },
            ];

            mockApi.getConversations.mockResolvedValue({ total: 2, conversations });

            await store.getState().loadConversations();

            expect(mockApi.getConversations).toHaveBeenCalledWith({ limit: 50, search: undefined });
            expect(store.getState().conversations).toEqual(conversations);
            expect(store.getState().conversationsTotal).toBe(2);
        });

        it('loadConversations 失败时 conversations 保持不变', async () => {
            mockApi.getConversations.mockRejectedValue(new Error('network error'));

            await expect(store.getState().loadConversations()).rejects.toThrow();
            expect(store.getState().conversations).toEqual([]);
        });
    });

    // ---------- 选择对话 ----------

    describe('选择对话', () => {
        it('selectConversation 设置 activeConversationId', async () => {
            const steps: Step[] = [
                { type: 'CORTEX_STEP_TYPE_USER_INPUT', status: 'CORTEX_STEP_STATUS_DONE', userInput: { items: [{ text: 'hello' }] } },
            ];

            mockApi.getTrajectory.mockResolvedValue({
                cascadeId: 'c1',
                status: 'CASCADE_RUN_STATUS_IDLE',
                totalSteps: 1,
                steps,
                metadata: [],
                seq: 0,
                source: 'live',
            });
            mockApi.subscribe.mockResolvedValue({ ok: true, cascadeId: 'c1', seq: 0 });

            await store.getState().selectConversation('c1');

            expect(store.getState().activeConversationId).toBe('c1');
            expect(store.getState().steps).toEqual(steps);
            expect(store.getState().conversationStatus).toBe('IDLE');
        });
    });

    // ---------- 新建对话 ----------

    describe('新建对话', () => {
        it('newChat 创建并选择新对话', async () => {
            mockApi.newChat.mockResolvedValue({ cascadeId: 'new-c1' });
            mockApi.getTrajectory.mockResolvedValue({
                cascadeId: 'new-c1',
                status: 'CASCADE_RUN_STATUS_IDLE',
                totalSteps: 0,
                steps: [],
                metadata: [],
                seq: 0,
                source: 'live',
            });
            mockApi.subscribe.mockResolvedValue({ ok: true, cascadeId: 'new-c1', seq: 0 });
            mockApi.getConversations.mockResolvedValue({ conversations: [], total: 0 });

            await store.getState().newChat();

            expect(store.getState().activeConversationId).toBe('new-c1');
        });

        it('newChat 失败时抛出错误', async () => {
            mockApi.newChat.mockRejectedValue(new Error('LS not connected'));

            await expect(store.getState().newChat()).rejects.toThrow();
        });
    });

    // ---------- 发送消息 ----------

    describe('发送消息', () => {
        it('sendMessage 调用 api.sendMessage', async () => {
            store.getState().setActiveConversation('c1');
            mockApi.sendMessage.mockResolvedValue({ ok: true, cascadeId: 'c1' });

            await store.getState().sendMessage('你好');

            expect(mockApi.sendMessage).toHaveBeenCalledWith(
                'c1',
                expect.objectContaining({ text: '你好' }),
            );
        });

        it('无 activeConversationId 时 sendMessage 无效', async () => {
            await store.getState().sendMessage('你好');
            expect(mockApi.sendMessage).not.toHaveBeenCalled();
        });

        it('status=RUNNING 时 sendMessage 被拦截', async () => {
            store.getState().setActiveConversation('c1');
            store.setState({ conversationStatus: 'RUNNING' } as never);

            await store.getState().sendMessage('你好');
            expect(mockApi.sendMessage).not.toHaveBeenCalled();
        });
    });

    // ---------- 事件驱动增量更新 ----------

    describe('事件驱动增量更新', () => {
        beforeEach(() => {
            store.getState().setActiveConversation('c1');
        });

        it('event_step_added 追加 step', () => {
            const step: Step = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                status: 'CORTEX_STEP_STATUS_DONE',
                userInput: { items: [{ text: 'hello' }] },
            };

            mockClient._simulateMessage({
                type: 'event_step_added',
                cascadeId: 'c1',
                stepIndex: 0,
                step,
            });

            expect(store.getState().steps).toHaveLength(1);
            expect(store.getState().steps[0]).toEqual(step);
        });

        it('event_step_added 对非活跃对话无效', () => {
            mockClient._simulateMessage({
                type: 'event_step_added',
                cascadeId: 'other',
                stepIndex: 0,
                step: { type: 'CORTEX_STEP_TYPE_USER_INPUT', status: 'CORTEX_STEP_STATUS_DONE' },
            });

            expect(store.getState().steps).toHaveLength(0);
        });

        it('event_step_updated 更新已有 step', () => {
            const step: Step = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                status: 'CORTEX_STEP_STATUS_GENERATING',
                plannerResponse: { response: 'partial...' },
            };
            mockClient._simulateMessage({ type: 'event_step_added', cascadeId: 'c1', stepIndex: 0, step });

            const updatedStep: Step = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                status: 'CORTEX_STEP_STATUS_DONE',
                plannerResponse: { response: 'complete answer', thinking: 'thought' },
            };
            mockClient._simulateMessage({ type: 'event_step_updated', cascadeId: 'c1', stepIndex: 0, step: updatedStep });

            expect(store.getState().steps[0].status).toBe('CORTEX_STEP_STATUS_DONE');
            expect(store.getState().steps[0].plannerResponse?.response).toBe('complete answer');
        });

        it('event_status_changed 更新 conversationStatus', () => {
            mockClient._simulateMessage({
                type: 'event_status_changed',
                cascadeId: 'c1',
                from: 'IDLE',
                to: 'RUNNING',
            });

            expect(store.getState().conversationStatus).toBe('RUNNING');
        });

        it('event_status_changed 对非活跃对话无效', () => {
            mockClient._simulateMessage({
                type: 'event_status_changed',
                cascadeId: 'other',
                from: 'IDLE',
                to: 'RUNNING',
            });

            expect(store.getState().conversationStatus).toBe('IDLE');
        });
    });

    // ---------- 配置管理 ----------

    describe('配置管理', () => {
        it('loadConfig 获取并更新配置', async () => {
            mockApi.getConfig.mockResolvedValue({
                config: {
                    model: 'MODEL_X',
                    agenticMode: false,
                    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
                    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_STRICT',
                    knowledgeEnabled: false,
                    ephemeralEnabled: true,
                    conversationHistoryEnabled: true,
                },
            });

            await store.getState().loadConfig();

            expect(store.getState().config.model).toBe('MODEL_X');
            expect(store.getState().config.agenticMode).toBe(false);
        });

        it('setConfig 更新配置', async () => {
            mockApi.setConfig.mockResolvedValue({
                config: {
                    model: 'MODEL_Y',
                    agenticMode: true,
                    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
                    artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO',
                    knowledgeEnabled: true,
                    ephemeralEnabled: true,
                    conversationHistoryEnabled: true,
                },
            });

            await store.getState().setConfig({ model: 'MODEL_Y' });

            expect(store.getState().config.model).toBe('MODEL_Y');
        });
    });

    // ---------- Debug 模式 ----------

    describe('Debug 模式', () => {
        it('toggleDebugMode 切换 debugMode', () => {
            expect(store.getState().debugMode).toBe(false);
            store.getState().toggleDebugMode();
            expect(store.getState().debugMode).toBe(true);
            store.getState().toggleDebugMode();
            expect(store.getState().debugMode).toBe(false);
        });
    });
});
