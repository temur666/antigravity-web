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
    EventMetadataUpdated,
    ResConversations,
    ResTrajectory,
    ResNewChat,
    ResConfig,
    ResStatus,
    CascadeConfig,
    ModelInfo,
    GeneratorMetadata,
    StepUsageInfo,
} from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import type { WSClient } from './ws-client';
import { buildStepUsageMap } from '@/utils/metadata';

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
    metadata: GeneratorMetadata[];
    stepUsageMap: Map<number, StepUsageInfo>;
    lastSeq: number;  // 最后收到的事件序号，用于断点续传

    // 配置
    config: CascadeConfig;
    models: ModelInfo[];

    // 账号
    account: { email: string; tier: string } | null;

    // UI 状态
    debugMode: boolean;
    viewMode: 'scroll' | 'paged';
    pagedColumns: 1 | 2;
    readingMode: boolean;
    loading: boolean;
    error: string | null;

    // 输入草稿缓存 (conversationId -> draft text)
    draftMap: Record<string, string>;

    // Actions
    loadConversations: (limit?: number, search?: string) => Promise<void>;
    selectConversation: (id: string) => Promise<void>;
    newChat: () => Promise<string | null>;
    sendMessage: (text: string, configOverride?: Partial<CascadeConfig>, extras?: { mentions?: Array<{ file: { absoluteUri: string } }>; media?: Array<{ mimeType: string; data?: string; uri?: string; thumbnail?: string }> }) => Promise<void>;
    loadConfig: () => Promise<void>;
    setConfig: (partial: Partial<CascadeConfig>) => Promise<void>;
    loadStatus: () => Promise<void>;
    toggleDebugMode: () => void;
    toggleViewMode: () => void;
    togglePagedColumns: () => void;
    setActiveConversation: (id: string | null) => void;
    cancelConversation: () => Promise<void>;
    setDraft: (conversationId: string, text: string) => void;
    toggleReadingMode: () => void;
}

export type AppStore = StoreApi<AppState>;

// ========== Store 工厂 ==========

export function createAppStore(wsClient: WSClient): AppStore {
    // ── 持久化恢复 ──
    const persistedConvId = typeof localStorage !== 'undefined'
        ? localStorage.getItem('activeConversationId') : null;
    const persistedViewMode = typeof localStorage !== 'undefined'
        ? localStorage.getItem('viewMode') as 'scroll' | 'paged' | null : null;
    const persistedDebug = typeof localStorage !== 'undefined'
        ? localStorage.getItem('debugMode') : null;
    const persistedCols = typeof localStorage !== 'undefined'
        ? localStorage.getItem('pagedColumns') : null;

    const store = createStore<AppState>((set, get) => ({
        // ---- 初始状态 (从持久化恢复) ----
        lsConnected: false,
        lsInfo: null,
        conversations: [],
        conversationsTotal: 0,
        activeConversationId: persistedConvId || null,
        steps: [],
        conversationStatus: 'IDLE',
        metadata: [],
        stepUsageMap: new Map(),
        lastSeq: 0,
        config: { ...DEFAULT_CONFIG },
        models: [],
        account: null,
        debugMode: persistedDebug === 'true',
        viewMode: persistedViewMode || 'scroll',
        pagedColumns: (persistedCols === '2' ? 2 : 1) as 1 | 2,
        readingMode: false,
        loading: false,
        error: null,
        draftMap: {},

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
                lastSeq: 0,
                loading: true,
                error: null,
            });
            localStorage.setItem('activeConversationId', id);

            // 拉取完整轨迹（超时 30s，大型对话可能需要较长时间）
            const trajectoryRes = await wsClient.sendAndWait({
                type: 'req_trajectory',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            }, 30000);

            // 竞态保护：如果用户在等待期间切换到了其他对话，丢弃本次结果
            if (get().activeConversationId !== id) return;

            if (trajectoryRes.type === 'res_trajectory') {
                const data = trajectoryRes as ResTrajectory & { seq?: number };
                const meta = (data.metadata || []) as GeneratorMetadata[];
                set({
                    steps: data.steps,
                    conversationStatus: data.status.replace('CASCADE_RUN_STATUS_', ''),
                    metadata: meta,
                    stepUsageMap: buildStepUsageMap(meta),
                    lastSeq: data.seq || 0,
                    loading: false,
                });
            } else {
                // 加载失败 → 清除死 ID，防止刷新后反复卡死
                localStorage.removeItem('activeConversationId');
                set({
                    loading: false,
                    error: '加载对话失败',
                    activeConversationId: null,
                    steps: [],
                    conversationStatus: 'IDLE',
                });
                return; // 不再订阅
            }

            // 再次检查竞态：订阅前确认仍是当前对话
            if (get().activeConversationId !== id) return;

            // 订阅实时更新（带 lastSeq 用于增量恢复，超时 15s）
            await wsClient.sendAndWait({
                type: 'req_subscribe',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            } as any, 15000);
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

        sendMessage: async (text: string, configOverride?: Partial<CascadeConfig>, extras?: { mentions?: Array<{ file: { absoluteUri: string } }>; media?: Array<{ mimeType: string; data?: string; uri?: string; thumbnail?: string }> }) => {
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
            set(state => {
                const next = !state.debugMode;
                localStorage.setItem('debugMode', String(next));
                return { debugMode: next };
            });
        },

        toggleViewMode: () => {
            set(state => {
                const next = state.viewMode === 'scroll' ? 'paged' : 'scroll';
                localStorage.setItem('viewMode', next);
                return { viewMode: next };
            });
        },

        togglePagedColumns: () => {
            set(state => {
                const next = state.pagedColumns === 1 ? 2 : 1;
                localStorage.setItem('pagedColumns', String(next));
                return { pagedColumns: next as 1 | 2 };
            });
        },

        setActiveConversation: (id: string | null) => {
            if (id) localStorage.setItem('activeConversationId', id);
            else localStorage.removeItem('activeConversationId');
            set({
                activeConversationId: id,
                steps: [],
                conversationStatus: 'IDLE',
            });
        },

        cancelConversation: async () => {
            const cascadeId = get().activeConversationId;
            if (!cascadeId) return;
            await wsClient.sendAndWait({
                type: 'req_cancel',
                reqId: wsClient.nextReqId(),
                cascadeId,
            });
        },

        setDraft: (conversationId: string, text: string) => {
            set(prev => {
                const next = { ...prev.draftMap };
                if (text) {
                    next[conversationId] = text;
                } else {
                    delete next[conversationId];
                }
                return { draftMap: next };
            });
        },

        toggleReadingMode: () => {
            set(state => ({ readingMode: !state.readingMode }));
        },
    }));

    // ========== 事件监听 ==========

    // 跟踪是否曾经收到过 LS 连接事件（区分首次 vs 重连）
    let hasReceivedLsStatus = false;
    // 防重入锁：避免多次 event_ls_status 触发重复的 selectConversation
    let isRestoringConversation = false;

    wsClient.onMessage((msg: ServerMessage) => {
        const state = store.getState();

        switch (msg.type) {
            case 'event_ls_status': {
                const event = msg as EventLsStatus;
                const wasLsConnected = state.lsConnected;
                store.setState({
                    lsConnected: event.connected,
                    lsInfo: event.connected
                        ? { port: event.port!, pid: event.pid! }
                        : null,
                });

                if (event.connected) {
                    const currentState = store.getState();

                    if (!wasLsConnected) {
                        // 场景 A: LS 首次连接 或 LS 真正断开后重连
                        // → 全量加载（对话列表 + 状态 + 活跃对话）
                        currentState.loadConversations();
                        currentState.loadStatus();
                        if (currentState.activeConversationId && !isRestoringConversation) {
                            isRestoringConversation = true;
                            currentState.selectConversation(currentState.activeConversationId)
                                .catch(() => {
                                    localStorage.removeItem('activeConversationId');
                                    store.setState({ activeConversationId: null, steps: [], loading: false });
                                })
                                .finally(() => { isRestoringConversation = false; });
                        }
                    } else if (hasReceivedLsStatus) {
                        // 场景 B: WS 断开重连，但 LS 一直在线
                        // → 轻量恢复：刷新列表 + 重新订阅（不重置当前对话内容）
                        currentState.loadConversations();
                        currentState.loadStatus();
                        if (currentState.activeConversationId) {
                            // 只重新订阅，带 lastSeq 做增量恢复
                            wsClient.send({
                                type: 'req_subscribe',
                                reqId: wsClient.nextReqId(),
                                cascadeId: currentState.activeConversationId,
                                lastSeq: currentState.lastSeq,
                            } as any);
                        }
                    } else {
                        // 场景 C: 首次 WS 连接，LS 已在线
                        // → 首次加载 + 恢复持久化的活跃对话
                        currentState.loadConversations();
                        currentState.loadStatus();
                        if (currentState.activeConversationId && !isRestoringConversation) {
                            isRestoringConversation = true;
                            currentState.selectConversation(currentState.activeConversationId)
                                .catch(() => {
                                    localStorage.removeItem('activeConversationId');
                                    store.setState({ activeConversationId: null, steps: [], loading: false });
                                })
                                .finally(() => { isRestoringConversation = false; });
                        }
                    }
                }

                hasReceivedLsStatus = true;
                break;
            }

            case 'event_step_added': {
                const event = msg as EventStepAdded & { seq?: number };
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState(prev => {
                    const newSteps = [...prev.steps];
                    if (event.stepIndex < newSteps.length) {
                        // 已存在（重复），替换
                        newSteps[event.stepIndex] = event.step;
                    } else {
                        // 新 step，追加
                        newSteps.push(event.step);
                    }
                    return {
                        steps: newSteps,
                        lastSeq: event.seq || prev.lastSeq,
                    };
                });
                break;
            }

            case 'event_step_updated': {
                const event = msg as EventStepUpdated & { seq?: number };
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState(prev => {
                    const newSteps = [...prev.steps];
                    if (event.stepIndex < newSteps.length) {
                        newSteps[event.stepIndex] = event.step;
                    }
                    return {
                        steps: newSteps,
                        lastSeq: event.seq || prev.lastSeq,
                    };
                });
                break;
            }

            case 'event_status_changed': {
                const event = msg as EventStatusChanged & { seq?: number };
                if (event.cascadeId !== state.activeConversationId) break;
                store.setState(prev => ({
                    conversationStatus: event.to,
                    lastSeq: event.seq || prev.lastSeq,
                }));
                break;
            }

            case 'event_metadata_updated': {
                const event = msg as EventMetadataUpdated & { seq?: number };
                if (event.cascadeId !== state.activeConversationId) break;
                const meta = event.metadata as GeneratorMetadata[];
                store.setState(prev => ({
                    metadata: meta,
                    stepUsageMap: buildStepUsageMap(meta),
                    lastSeq: (event as { seq?: number }).seq || prev.lastSeq,
                }));
                break;
            }

            case 'events_batch' as string: {
                // 断点续传：服务端一次性发送缓冲区中的多个事件
                const batch = msg as unknown as { cascadeId: string; events: Array<EventStepAdded | EventStepUpdated | EventStatusChanged & { seq?: number }> };
                if (batch.cascadeId !== state.activeConversationId) break;
                store.setState(prev => {
                    let newSteps = [...prev.steps];
                    let newStatus = prev.conversationStatus;
                    let newSeq = prev.lastSeq;
                    for (const evt of batch.events) {
                        if ((evt as { seq?: number }).seq) {
                            newSeq = (evt as { seq: number }).seq;
                        }
                        if (evt.type === 'event_step_added') {
                            const e = evt as EventStepAdded;
                            if (e.stepIndex < newSteps.length) {
                                newSteps[e.stepIndex] = e.step;
                            } else {
                                newSteps = [...newSteps, e.step];
                            }
                        } else if (evt.type === 'event_step_updated') {
                            const e = evt as EventStepUpdated;
                            if (e.stepIndex < newSteps.length) {
                                newSteps = [...newSteps];
                                newSteps[e.stepIndex] = e.step;
                            }
                        } else if (evt.type === 'event_status_changed') {
                            newStatus = (evt as EventStatusChanged).to;
                        }
                    }
                    return { steps: newSteps, conversationStatus: newStatus, lastSeq: newSeq };
                });
                break;
            }
        }
    });

    return store;
}
