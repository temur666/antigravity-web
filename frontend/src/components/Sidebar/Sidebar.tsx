/**
 * Sidebar — 对话列表侧边栏
 */
import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';
import { formatRelativeTime, formatBytes, truncate } from '@/utils/format';
import type { ConversationSummary } from '@/types';

export interface SidebarProps {
    isOpen?: boolean;
    isMobile?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen = true, isMobile = false, onClose }: SidebarProps) {
    const conversations = useAppStore(s => s.conversations);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const loadConversations = useAppStore(s => s.loadConversations);
    const selectConversation = useAppStore(s => s.selectConversation);
    const newChat = useAppStore(s => s.newChat);

    // 首次加载对话列表
    useEffect(() => {
        loadConversations();
    }, [loadConversations]);

    const handleNewChat = useCallback(() => {
        newChat();
    }, [newChat]);

    const handleRefresh = useCallback(() => {
        loadConversations();
    }, [loadConversations]);

    return (
        <aside className={`sidebar ${isOpen ? 'open' : 'closed'} ${isMobile ? 'mobile' : 'desktop'}`}>
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <span className="logo-icon">✦</span>
                    <span className="logo-text">Antigravity</span>
                </div>
                <button className="sidebar-btn" onClick={handleNewChat} title="新建对话">
                    ＋
                </button>
            </div>

            <div className="sidebar-list">
                <div className="sidebar-section-title">
                    对话列表
                    <button className="sidebar-refresh-btn" onClick={handleRefresh} title="刷新">
                        ↻
                    </button>
                </div>

                {conversations.length === 0 && (
                    <div className="sidebar-empty">暂无对话</div>
                )}

                {conversations.map(conv => (
                    <ChatItem
                        key={conv.id}
                        conversation={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={(id) => {
                            selectConversation(id);
                            if (isMobile && onClose) {
                                onClose();
                            }
                        }}
                    />
                ))}
            </div>
        </aside>
    );
}

// ========== ChatItem ==========

interface ChatItemProps {
    conversation: ConversationSummary;
    isActive: boolean;
    onSelect: (id: string) => void;
}

function ChatItem({ conversation, isActive, onSelect }: ChatItemProps) {
    const title = conversation.title
        ? truncate(conversation.title, 30)
        : conversation.id.slice(0, 8) + '...';

    return (
        <button
            className={`chat-item ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(conversation.id)}
        >
            <div className="chat-item-icon">💬</div>
            <div className="chat-item-info">
                <div className="chat-item-title">{title}</div>
                <div className="chat-item-meta">
                    <span>{formatRelativeTime(conversation.updatedAt)}</span>
                    <span>{formatBytes(conversation.sizeBytes)}</span>
                </div>
            </div>
        </button>
    );
}
