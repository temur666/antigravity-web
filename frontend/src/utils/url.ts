/**
 * utils/url.ts — URL 路由工具（History API）
 *
 * URL 规则:
 *   /            → 对话列表（无活跃对话）
 *   /chat/<id>   → 直达某个对话
 *
 * 纯函数 + 薄封装，不含业务逻辑。
 */

const CHAT_PREFIX = '/chat/';

/**
 * 从当前 pathname 解析对话 ID
 * @returns conversationId 或 null
 */
export function getConversationIdFromUrl(): string | null {
    const path = window.location.pathname;
    if (path.startsWith(CHAT_PREFIX)) {
        const id = path.slice(CHAT_PREFIX.length);
        // 防御：只接受非空、无斜杠的 ID
        if (id && !id.includes('/')) {
            return decodeURIComponent(id);
        }
    }
    return null;
}

/**
 * 更新 URL 到对应的对话路径
 * @param id  对话 ID，null 表示回到列表
 * @param replace 是否用 replaceState（不产生历史记录）
 */
export function pushConversationUrl(id: string | null, replace = false): void {
    const target = id ? `${CHAT_PREFIX}${encodeURIComponent(id)}` : '/';
    // 避免重复 push 相同路径
    if (window.location.pathname === target) return;

    if (replace) {
        window.history.replaceState(null, '', target);
    } else {
        window.history.pushState(null, '', target);
    }
}
