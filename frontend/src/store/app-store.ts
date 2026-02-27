/**
 * store/app-store.ts — 全局状态管理 (zustand)
 *
 * 餐厅类比:
 *   - Store = 厨师长 + 点单台
 *   - State = 正在做的菜
 *   - Action = 点单
 *
 * 职责:
 *   - 管理 LS 连接状态
 *   - 管理对话列表和当前对话
 *   - 处理 WebSocket 事件驱动的增量更新
 *   - 配置管理
 */

import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand';
import type {
    ConversationSummary,
    Step,
    ServerMessage,
    EventStepAdded,
    EventStepUpdated,
    EventStatusChanged,
    EventLsStatus,
    ResConversations,
    ResTrajectory,
    ResNewChat,
    ResConfig,
    ResStatus,
    CascadeConfig,
    ModelInfo,
} from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import type { WSClient } from './ws-client';

// ========== State 类型 ==========

export interface AppState {
    // LS 连接
    lsConnected: boolean;
    lsInfo: { port: number; pid: number } | null;

    // 对话列表
    conversations: ConversationSummary[];
    conversationsTotal: number;
    activeConversationId: string | null;

    // 当前对话
    steps: Step[];
    conversationStatus: string;
    metadata: unknown[];

    // 配置
    config: CascadeConfig;
    models: ModelInfo[];

    // 账号
    account: { email: string; tier: string } | null;

    // UI 状态
    debugMode: boolean;
    loading: boolean;
    error: string | null;

    // Actions
    loadConversations: (limit?: number, search?: string) => Promise<void>;
    selectConversation: (id: string) => Promise<void>;
    newChat: () => Promise<string | null>;
    sendMessage: (text: string, configOverride?: Partial<CascadeConfig>, extras?: { mentions?: Array<{ file: { absoluteUri: string } }>; media?: Array<{ mimeType: string; uri: string; thumbnail?: string }> }) => Promise<void>;
    loadConfig: () => Promise<void>;
    setConfig: (partial: Partial<CascadeConfig>) => Promise<void>;
    loadStatus: () => Promise<void>;
    toggleDebugMode: () => void;
    setActiveConversation: (id: string | null) => void;
}

export type AppStore = StoreApi<AppState>;

// ========== Store 工厂 ==========

export function createAppStore(wsClient: WSClient): AppStore {
    const store = createStore<AppState>((set, get) => ({
        // ---- 初始状态 ----
        lsConnected: false,
        lsInfo: null,
        conversations: [],
        conversationsTotal: 0,
        activeConversationId: null,
        steps: [],
        conversationStatus: 'IDLE',
        metadata: [],
        config: { ...DEFAULT_CONFIG },
        models: [],
        account: null,
        debugMode: false,
        loading: false,
        error: null,

        // ---- Actions ----

        loadConversations: async (limit = 50, search?: string) => {
            const res = await wsClient.sendAndWait({
                type: 'req_conversations',
                reqId: wsClient.nextReqId(),
                limit,
                search,
            });

            if (res.type === 'res_conversations') {
                const data = res as ResConversations;
                set({
                    conversations: data.conversations,
                    conversationsTotal: data.total,
                });
            }
        },

        selectConversation: async (id: string) => {
            // 如果有旧订阅，取消
            const oldId = get().activeConversationId;
            if (oldId && oldId !== id) {
                wsClient.send({
                    type: 'req_unsubscribe',
                    reqId: wsClient.nextReqId(),
                    cascadeId: oldId,
                });
            }

            set({
                activeConversationId: id,
                steps: [],
                conversationStatus: 'IDLE',
                loading: true,
                error: null,
            });

            // 拉取完整轨迹
            const trajectoryRes = await wsClient.sendAndWait({
                type: 'req_trajectory',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            });

            if (trajectoryRes.type === 'res_trajectory') {
                const data = trajectoryRes as ResTrajectory;
                set({
                    steps: data.steps,
                    conversationStatus: data.status.replace('CASCADE_RUN_STATUS_', ''),
                    metadata: data.metadata,
                    loading: false,
                });
            } else {
                set({ loading: false, error: '加载对话失败' });
            }

            // 订阅实时更新
            await wsClient.sendAndWait({
                type: 'req_subscribe',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            });
        },

        newChat: async () => {
            const res = await wsClient.sendAndWait({
                type: 'req_new_chat',
                reqId: wsClient.nextReqId(),
            });

            if (res.type === 'res_new_chat') {
                const data = res as ResNewChat;
                await get().selectConversation(data.cascadeId);
                return data.cascadeId;
            }

            return null;
        },

        sendMessage: async (text: string, configOverride?: Partial<CascadeConfig>, extras?: { mentions?: Array<{ file: { absoluteUri: string } }>; media?: Array<{ mimeType: string; uri: string; thumbnail?: string }> }) => {
            const cascadeId = get().activeConversationId;
            if (!cascadeId) return;

            set({ conversationStatus: 'RUNNING' });

            await wsClient.sendAndWait({
                type: 'req_send_message',
                reqId: wsClient.nextReqId(),
                cascadeId,
                text,
                ...(configOverride ? { config: configOverride } : {}),
                ...(extras?.mentions ? { mentions: extras.mentions } : {}),
                ...(extras?.media ? { media: extras.media } : {}),
            });
        },

        loadConfig: async () => {
            const res = await wsClient.sendAndWait({
                type: 'req_get_config',
                reqId: wsClient.nextReqId(),
            });

            if (res.type === 'res_config') {
                const data = res as ResConfig;
                set({ config: data.config });
            }
        },

        setConfig: async (partial: Partial<CascadeConfig>) => {
            const res = await wsClient.sendAndWait({
                type: 'req_set_config',
                reqId: wsClient.nextReqId(),
                ...partial,
            });

            if (res.type === 'res_config') {
                const data = res as ResConfig;
                set({ config: data.config });
            }
        },

        loadStatus: async () => {
            const res = await wsClient.sendAndWait({
                type: 'req_status',
                reqId: wsClient.nextReqId(),
            });

            if (res.type === 'res_status') {
                const data = res as ResStatus;
                set({
                    lsConnected: data.ls.connected,
                    lsInfo: data.ls.connected
                        ? { port: data.ls.port!, pid: data.ls.pid! }
                        : null,
                    config: data.config,
                    models: data.models,
                    account: data.account,
                });
            }
        },

        toggleDebugMode: () => {
            set(state => ({ debugMode: !state.debugMode }));
        },

        setActiveConversation: (id: string | null) => {
            set({
                activeConversationId: id,
                steps: [],
                conversationStatus: 'IDLE',
            });
        },
    }));

    // ========== 事件监听 ==========

    wsClient.onMessage((msg: ServerMessage) => {
        const state = store.getState();

        switch (msg.type) {
            case 'event_ls_status': {
                const event = msg as EventLsStatus;
                store.setState({
                    lsConnected: event.connected,
                    lsInfo: event.connected
                        ? { port: event.port!, pid: event.pid! }
                        : null,
                });
                break;
            }

            case 'event_step_added': {
                const event = msg as EventStepAdded;
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState(prev => ({
                    steps: [...prev.steps, event.step],
                }));
                break;
            }

            case 'event_step_updated': {
                const event = msg as EventStepUpdated;
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState(prev => {
                    const newSteps = [...prev.steps];
                    if (event.stepIndex < newSteps.length) {
                        newSteps[event.stepIndex] = event.step;
                    }
                    return { steps: newSteps };
                });
                break;
            }

            case 'event_status_changed': {
                const event = msg as EventStatusChanged;
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState({
                    conversationStatus: event.to,
                });
                break;
            }
        }
    });

    return store;
}
