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
    ResDeleteConversation,
    ResExportMarkdown,
    CascadeConfig,
    ModelInfo,
    GeneratorMetadata,
    StepUsageInfo,
} from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import type { WSClient } from './ws-client';
import { buildStepUsageMap } from '@/utils/metadata';
import { getConversationIdFromUrl, pushConversationUrl } from '@/utils/url';

// ========== 对话缓存（内存级，不参与渲染） ==========

interface ConversationSnapshot {
    steps: Step[];
    metadata: GeneratorMetadata[];
    stepUsageMap: Map<number, StepUsageInfo>;
    status: string;
    lastSeq: number;
}

const conversationCache = new Map<string, ConversationSnapshot>();
const CACHE_MAX_SIZE = 20;

/** LRU 写入：超出上限时淘汰最早条目 */
function cacheSet(id: string, snapshot: ConversationSnapshot) {
    // 先删后插，保证 Map 顺序为最近访问
    conversationCache.delete(id);
    conversationCache.set(id, snapshot);
    // 淘汰
    while (conversationCache.size > CACHE_MAX_SIZE) {
        const oldest = conversationCache.keys().next().value;
        if (oldest) conversationCache.delete(oldest);
    }
}

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
    typography: 'default' | 'editorial';
    readingMode: boolean;
    loading: boolean;
    error: string | null;

    // Archive 降级
    archiveMarkdown: string | null;   // 非 null 时表示当前对话是归档模式

    // 自动回复 (YOLO 模式)
    autoReply: boolean;

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
    toggleTypography: () => void;
    toggleAutoReply: () => void;
    deleteConversation: (id: string) => Promise<boolean>;
    exportMarkdown: (id: string) => Promise<string | null>;
}

export type AppStore = StoreApi<AppState>;

// ========== Store 工厂 ==========

export function createAppStore(wsClient: WSClient): AppStore {
    // ── 持久化恢复（URL 优先 > localStorage fallback） ──
    const urlConvId = getConversationIdFromUrl();
    const persistedConvId = urlConvId
        || (typeof localStorage !== 'undefined'
            ? localStorage.getItem('activeConversationId') : null);
    const persistedViewMode = typeof localStorage !== 'undefined'
        ? localStorage.getItem('viewMode') as 'scroll' | 'paged' | null : null;
    const persistedDebug = typeof localStorage !== 'undefined'
        ? localStorage.getItem('debugMode') : null;
    const persistedCols = typeof localStorage !== 'undefined'
        ? localStorage.getItem('pagedColumns') : null;
    const persistedAutoReply = typeof localStorage !== 'undefined'
        ? localStorage.getItem('autoReply') === 'true' : false;
    const persistedTypography = typeof localStorage !== 'undefined'
        ? localStorage.getItem('typography') as 'default' | 'editorial' | null : null;

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
        typography: persistedTypography || 'default',
        readingMode: false,
        loading: false,
        error: null,
        archiveMarkdown: null,
        autoReply: persistedAutoReply,
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
            // 如果有旧订阅，取消，并缓存旧对话数据
            const oldId = get().activeConversationId;
            if (oldId && oldId !== id) {
                // 将旧对话的实时状态同步回 conversations 列表
                const oldStatus = get().conversationStatus;
                set(prev => ({
                    conversations: prev.conversations.map(c =>
                        c.id === oldId ? { ...c, status: oldStatus } : c
                    ),
                }));
                // 缓存当前对话数据
                const prev = get();
                if (prev.steps.length > 0) {
                    cacheSet(oldId, {
                        steps: prev.steps,
                        metadata: prev.metadata,
                        stepUsageMap: prev.stepUsageMap,
                        status: prev.conversationStatus,
                        lastSeq: prev.lastSeq,
                    });
                }
                wsClient.send({
                    type: 'req_unsubscribe',
                    reqId: wsClient.nextReqId(),
                    cascadeId: oldId,
                });
            }

            // 检查缓存：命中则秒开
            const cached = conversationCache.get(id);
            if (cached) {
                set({
                    activeConversationId: id,
                    steps: cached.steps,
                    conversationStatus: cached.status,
                    metadata: cached.metadata,
                    stepUsageMap: cached.stepUsageMap,
                    lastSeq: cached.lastSeq,
                    loading: false,
                    error: null,
                    archiveMarkdown: null,
                });
                localStorage.setItem('activeConversationId', id);
                pushConversationUrl(id);

                // 后台重订阅增量更新
                await wsClient.sendAndWait({
                    type: 'req_subscribe',
                    reqId: wsClient.nextReqId(),
                    cascadeId: id,
                }, 15000);
                // Background Sync: 静默刷新列表，确保标题等字段同步
                get().loadConversations().catch(() => { });
                return;
            }

            // 无缓存：重载同一对话时保留现有 steps（A 方案）
            const isSameConv = oldId === id && get().steps.length > 0;

            set({
                activeConversationId: id,
                ...(isSameConv ? {} : { steps: [] }),
                conversationStatus: 'IDLE',
                lastSeq: 0,
                loading: !isSameConv,
                error: null,
                archiveMarkdown: null,
            });
            localStorage.setItem('activeConversationId', id);
            pushConversationUrl(id);

            // 拉取完整轨迹（超时 30s）
            const trajectoryRes = await wsClient.sendAndWait({
                type: 'req_trajectory',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            }, 30000);

            // 竞态保护
            if (get().activeConversationId !== id) return;

            if (trajectoryRes.type === 'res_trajectory') {
                const data = trajectoryRes as ResTrajectory & { seq?: number };

                // Archive 降级：返回 markdown 而不是 steps
                if (data.source === 'archive' && data.markdown) {
                    set({
                        steps: [],
                        conversationStatus: 'IDLE',
                        metadata: [],
                        stepUsageMap: new Map(),
                        lastSeq: 0,
                        loading: false,
                        archiveMarkdown: data.markdown,
                    });
                    return;
                }

                const meta = (data.metadata || []) as GeneratorMetadata[];
                const usageMap = buildStepUsageMap(meta);
                set({
                    steps: data.steps,
                    conversationStatus: data.status.replace('CASCADE_RUN_STATUS_', ''),
                    metadata: meta,
                    stepUsageMap: usageMap,
                    lastSeq: data.seq || 0,
                    loading: false,
                    archiveMarkdown: null,
                });
                // 写入缓存
                cacheSet(id, {
                    steps: data.steps,
                    metadata: meta,
                    stepUsageMap: usageMap,
                    status: data.status.replace('CASCADE_RUN_STATUS_', ''),
                    lastSeq: data.seq || 0,
                });
            } else {
                localStorage.removeItem('activeConversationId');
                set({
                    loading: false,
                    error: '加载对话失败',
                    activeConversationId: null,
                    steps: [],
                    conversationStatus: 'IDLE',
                });
                return;
            }

            if (get().activeConversationId !== id) return;

            await wsClient.sendAndWait({
                type: 'req_subscribe',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            }, 15000);
            // Background Sync: 静默刷新列表，确保标题等字段同步
            get().loadConversations().catch(() => { });
        },

        newChat: async () => {
            const res = await wsClient.sendAndWait({
                type: 'req_new_chat',
                reqId: wsClient.nextReqId(),
            });

            if (res.type === 'res_new_chat') {
                const data = res as ResNewChat;
                const now = new Date().toISOString();

                // Optimistic Update: 立即插入占位记录，侧边栏/标签栏秒级刷新
                set(prev => {
                    const exists = prev.conversations.some(c => c.id === data.cascadeId);
                    if (exists) return {};
                    return {
                        conversations: [{
                            id: data.cascadeId,
                            title: '',
                            updatedAt: now,
                            createdAt: now,
                            sizeBytes: 0,
                            status: 'IDLE',
                            stepCount: 0,
                        }, ...prev.conversations],
                        conversationsTotal: prev.conversationsTotal + 1,
                    };
                });

                await get().selectConversation(data.cascadeId);

                // Background Sync: 静默刷新列表，服务端数据覆盖占位记录
                get().loadConversations().catch(() => {/* 静默失败 */ });

                return data.cascadeId;
            }

            return null;
        },

        sendMessage: async (text: string, configOverride?: Partial<CascadeConfig>, extras?: { mentions?: Array<{ file: { absoluteUri: string } }>; media?: Array<{ mimeType: string; data?: string; uri?: string; thumbnail?: string }> }) => {
            const cascadeId = get().activeConversationId;
            if (!cascadeId) return;

            set(prev => ({
                conversationStatus: 'RUNNING',
                conversations: prev.conversations.map(c =>
                    c.id === cascadeId ? { ...c, status: 'RUNNING' } : c
                ),
            }));

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
            // 切走时缓存当前对话
            const prev = get();
            if (prev.activeConversationId && prev.steps.length > 0 && prev.activeConversationId !== id) {
                cacheSet(prev.activeConversationId, {
                    steps: prev.steps,
                    metadata: prev.metadata,
                    stepUsageMap: prev.stepUsageMap,
                    status: prev.conversationStatus,
                    lastSeq: prev.lastSeq,
                });
            }
            if (id) localStorage.setItem('activeConversationId', id);
            else localStorage.removeItem('activeConversationId');
            pushConversationUrl(id);
            set({
                activeConversationId: id,
                steps: [],
                conversationStatus: 'IDLE',
                archiveMarkdown: null,
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

        toggleTypography: () => {
            set(state => {
                const next = state.typography === 'default' ? 'editorial' : 'default';
                localStorage.setItem('typography', next);
                return { typography: next };
            });
        },

        toggleAutoReply: () => {
            set(state => {
                const next = !state.autoReply;
                localStorage.setItem('autoReply', String(next));
                return { autoReply: next };
            });
        },

        deleteConversation: async (id: string) => {
            const res = await wsClient.sendAndWait({
                type: 'req_delete_conversation',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            });

            if (res.type === 'res_delete_conversation') {
                const data = res as ResDeleteConversation;
                if (data.ok) {
                    // 从列表删除
                    set(prev => ({
                        conversations: prev.conversations.filter(c => c.id !== id),
                        conversationsTotal: Math.max(0, prev.conversationsTotal - 1),
                    }));
                    // 从缓存删除
                    conversationCache.delete(id);
                    // 如果是当前对话，跳回主页
                    if (get().activeConversationId === id) {
                        get().setActiveConversation(null);
                    }
                    return true;
                }
            }
            return false;
        },

        exportMarkdown: async (id: string) => {
            const res = await wsClient.sendAndWait({
                type: 'req_export_markdown',
                reqId: wsClient.nextReqId(),
                cascadeId: id,
            }, 30000);

            if (res.type === 'res_export_markdown') {
                const data = res as ResExportMarkdown;
                return data.markdown;
            }
            return null;
        },
    }));

    // ========== 自动回复模板 ==========

    const AUTO_REPLY_TEXT = `继续你的工作，自行判断所有决策。
- 遇到错误：分析原因，尝试解决，解决不了就跳过并记录
- 产品决策：从用户价值角度思考
- 技术决策：从架构合理性角度思考
- 完成所有工作后：按照参考文档中的完成 Hook 执行`;

    const AUTO_REPLY_COOLDOWN = 5000; // 5 秒冷却
    let autoReplyTimer: ReturnType<typeof setTimeout> | null = null;

    // ========== autoReply: 自动批准 WAITING step ==========

    function autoApproveIfWaiting(cascadeId: string, stepIndex: number, step: Step) {
        const s = store.getState();
        if (!s.autoReply) return;
        if (step.status !== 'CORTEX_STEP_STATUS_WAITING') return;
        // 只批准 RUN_COMMAND 类型的 WAITING step (安全限制)
        if (step.type !== 'CORTEX_STEP_TYPE_RUN_COMMAND') return;
        console.log(`[AutoApprove] step[${stepIndex}] →`, cascadeId.slice(0, 8));
        wsClient.send({
            type: 'req_approve_step',
            reqId: wsClient.nextReqId(),
            cascadeId,
            stepIndex,
        });
    }

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
                        currentState.loadConversations();
                        currentState.loadStatus();
                        if (currentState.activeConversationId && !isRestoringConversation) {
                            // C: 已有 steps 数据 → 跳过全量拉取，只重订阅
                            if (currentState.steps.length > 0) {
                                wsClient.send({
                                    type: 'req_subscribe',
                                    reqId: wsClient.nextReqId(),
                                    cascadeId: currentState.activeConversationId,
                                    lastSeq: currentState.lastSeq,
                                });
                            } else {
                                isRestoringConversation = true;
                                currentState.selectConversation(currentState.activeConversationId)
                                    .catch(() => {
                                        localStorage.removeItem('activeConversationId');
                                        store.setState({ activeConversationId: null, steps: [], loading: false });
                                    })
                                    .finally(() => { isRestoringConversation = false; });
                            }
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
                            });
                        }
                    } else {
                        // 场景 C: 首次 WS 连接，LS 已在线
                        currentState.loadConversations();
                        currentState.loadStatus();
                        if (currentState.activeConversationId && !isRestoringConversation) {
                            // C: 已有 steps 数据 → 跳过全量拉取，只重订阅
                            if (currentState.steps.length > 0) {
                                wsClient.send({
                                    type: 'req_subscribe',
                                    reqId: wsClient.nextReqId(),
                                    cascadeId: currentState.activeConversationId,
                                    lastSeq: currentState.lastSeq,
                                });
                            } else {
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
                // autoReply: 自动批准 WAITING step
                autoApproveIfWaiting(event.cascadeId, event.stepIndex, event.step);
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
                // autoReply: 自动批准 WAITING step
                autoApproveIfWaiting(event.cascadeId, event.stepIndex, event.step);
                break;
            }

            case 'event_status_changed': {
                const event = msg as EventStatusChanged & { seq?: number };
                store.setState(prev => {
                    // 同步更新 conversations 列表中对应对话的 status
                    const newConversations = prev.conversations.map(c =>
                        c.id === event.cascadeId
                            ? { ...c, status: event.to }
                            : c
                    );
                    // 仅当是活跃对话时，更新 conversationStatus 和 lastSeq
                    if (event.cascadeId === prev.activeConversationId) {
                        return {
                            conversations: newConversations,
                            conversationStatus: event.to,
                            lastSeq: event.seq || prev.lastSeq,
                        };
                    }
                    return { conversations: newConversations };
                });

                // 自动回复：IDLE + autoReply ON + 是当前活跃对话
                const afterState = store.getState();
                if (
                    event.to === 'IDLE'
                    && afterState.autoReply
                    && event.cascadeId === afterState.activeConversationId
                    && afterState.steps.length > 0  // 排除空对话
                ) {
                    if (autoReplyTimer) clearTimeout(autoReplyTimer);
                    autoReplyTimer = setTimeout(() => {
                        autoReplyTimer = null;
                        const s = store.getState();
                        // 二次确认：仍然 autoReply ON、仍然 IDLE、仍然是同一对话
                        if (s.autoReply && s.conversationStatus === 'IDLE' && s.activeConversationId === event.cascadeId) {
                            console.log('[AutoReply] 自动回复 →', event.cascadeId.slice(0, 8));
                            s.sendMessage(AUTO_REPLY_TEXT);
                        }
                    }, AUTO_REPLY_COOLDOWN);
                }
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
