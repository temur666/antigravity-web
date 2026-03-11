/**
 * store/api-client.ts — REST API 客户端
 *
 * 替代 WSClient.sendAndWait 的所有 req_* 消息。
 * 每个函数直接对应原来的一个 WS 消息类型。
 */

import type {
    CascadeConfig,
    ConversationSummary,
    Step,
    GeneratorMetadata,
    ModelInfo,
} from '@/types';

// ========== 通用 fetch 封装 ==========

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            msg = body.error || body.message || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
    }
    return res.json() as Promise<T>;
}

function postJSON<T>(url: string, body: unknown): Promise<T> {
    return apiFetch<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function putJSON<T>(url: string, body: unknown): Promise<T> {
    return apiFetch<T>(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ========== 响应类型 ==========

export interface StatusResponse {
    ls: { connected: boolean; port: number | null; pid: number | null; version: string };
    config: CascadeConfig;
    conversations: { total: number; running: number; subscribed: number };
    polling: boolean;
    account: { email: string; tier: string } | null;
    models: ModelInfo[];
    defaultModel: string | null;
}

export interface ConversationsResponse {
    total: number;
    conversations: ConversationSummary[];
}

export interface TrajectoryResponse {
    cascadeId?: string;
    id?: string;
    status: string;
    steps: Step[];
    totalSteps: number;
    metadata: GeneratorMetadata[];
    seq?: number;
    source?: 'live' | 'archive';
    markdown?: string;
    title?: string;
}

export interface NewChatResponse {
    cascadeId: string;
}

export interface SendMessageResponse {
    ok: boolean;
    cascadeId: string;
}

export interface SubscribeResponse {
    ok: boolean;
    cascadeId: string;
    seq: number;
}

export interface ConfigResponse {
    config: CascadeConfig;
}

export interface OkResponse {
    ok: boolean;
    cascadeId?: string;
}

export interface ExportMarkdownResponse {
    cascadeId: string;
    markdown: string;
    title?: string;
}

export interface ApproveStepResponse {
    ok: boolean;
    cascadeId: string;
    stepIndex: number;
}

export interface YoloStatusResponse {
    running: boolean;
    [key: string]: unknown;
}

// ========== API 函数 ==========

export const api = {
    // 对应 req_status
    getStatus: (): Promise<StatusResponse> =>
        apiFetch('/api/status'),

    // 对应 req_conversations
    getConversations: (params?: { limit?: number; search?: string }): Promise<ConversationsResponse> => {
        const qs = new URLSearchParams();
        if (params?.limit) qs.set('limit', String(params.limit));
        if (params?.search) qs.set('search', params.search);
        const query = qs.toString();
        return apiFetch(`/api/conversations${query ? '?' + query : ''}`);
    },

    // 对应 req_trajectory
    getTrajectory: (cascadeId: string): Promise<TrajectoryResponse> =>
        apiFetch(`/api/conversations/${cascadeId}`),

    // 对应 req_new_chat
    newChat: (): Promise<NewChatResponse> =>
        postJSON('/api/conversations', {}),

    // 对应 req_send_message
    sendMessage: (cascadeId: string, body: {
        text: string;
        config?: Partial<CascadeConfig>;
        mentions?: Array<{ file: { absoluteUri: string } }>;
        media?: Array<{ mimeType: string; data?: string; uri?: string; thumbnail?: string }>;
        traceId?: string;
    }): Promise<SendMessageResponse> =>
        postJSON(`/api/conversations/${cascadeId}/messages`, body),

    // 对应 req_subscribe
    subscribe: (cascadeId: string, lastSeq?: number): Promise<SubscribeResponse> =>
        postJSON(`/api/conversations/${cascadeId}/subscribe`, { lastSeq }),

    // 对应 req_unsubscribe
    unsubscribe: (cascadeId: string): Promise<OkResponse> =>
        postJSON(`/api/conversations/${cascadeId}/unsubscribe`, {}),

    // 对应 req_cancel
    cancel: (cascadeId: string): Promise<OkResponse> =>
        postJSON(`/api/conversations/${cascadeId}/cancel`, {}),

    // 对应 req_delete_conversation
    deleteConversation: (cascadeId: string): Promise<OkResponse> =>
        apiFetch(`/api/conversations/${cascadeId}`, { method: 'DELETE' }),

    // 对应 req_export_markdown
    exportMarkdown: (cascadeId: string): Promise<ExportMarkdownResponse> =>
        apiFetch(`/api/conversations/${cascadeId}/export`),

    // 对应 req_approve_step
    approveStep: (cascadeId: string, stepIndex: number): Promise<ApproveStepResponse> =>
        postJSON(`/api/conversations/${cascadeId}/approve-step`, { stepIndex }),

    // 对应 req_get_config
    getConfig: (): Promise<ConfigResponse> =>
        apiFetch('/api/config'),

    // 对应 req_set_config
    setConfig: (partial: Partial<CascadeConfig>): Promise<ConfigResponse> =>
        putJSON('/api/config', partial),

    // YOLO
    yoloStart: (opts: {
        task?: string | null;
        docPath?: string | null;
        timeout?: number;
        cooldown?: number;
        pollInterval?: number;
        agentic?: boolean;
        cascadeId?: string | null;
    }): Promise<OkResponse> =>
        postJSON('/api/yolo/start', opts),

    yoloStop: (): Promise<OkResponse> =>
        postJSON('/api/yolo/stop', {}),

    yoloStatus: (): Promise<YoloStatusResponse> =>
        apiFetch('/api/yolo/status'),
};
