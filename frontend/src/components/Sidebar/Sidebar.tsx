/**
 * Sidebar — 对话列表侧边栏
 *
 * 功能:
 *   - 显示对话列表（带 RUNNING 状态指示）
 *   - 搜索过滤
 *   - 右键菜单（删除、导出）
 */
import './Sidebar.css';
import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';
import { formatRelativeTime, truncate } from '@/utils/format';
import type { ConversationSummary } from '@/types';

export interface SidebarProps {
    isOpen?: boolean;
    isMobile?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen = true, isMobile = false, onClose }: SidebarProps) {
    const conversations = useAppStore(s => s.conversations);
    const activeConversationId = useAppStore(s => s.activeConversationId);
    const conversationStatus = useAppStore(s => s.conversationStatus);
    const loadConversations = useAppStore(s => s.loadConversations);
    const selectConversation = useAppStore(s => s.selectConversation);
    const setActiveConversation = useAppStore(s => s.setActiveConversation);
    const newChat = useAppStore(s => s.newChat);
    const deleteConversation = useAppStore(s => s.deleteConversation);
    const exportMarkdown = useAppStore(s => s.exportMarkdown);

    const [search, setSearch] = useState('');
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    // 首次加载对话列表
    useEffect(() => {
        loadConversations();
    }, [loadConversations]);

    // 搜索
    useEffect(() => {
        const timer = setTimeout(() => {
            loadConversations(50, search || undefined);
        }, 300);
        return () => clearTimeout(timer);
    }, [search, loadConversations]);

    // 点击任意位置关闭菜单
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [contextMenu]);

    const handleGoHome = useCallback(() => {
        setActiveConversation(null);
        loadConversations();
    }, [setActiveConversation, loadConversations]);

    const handleNewChat = useCallback(() => {
        newChat();
    }, [newChat]);

    const handleRefresh = useCallback(() => {
        loadConversations(50, search || undefined);
    }, [loadConversations, search]);

    const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ id, x: e.clientX, y: e.clientY });
    }, []);

    const handleDelete = useCallback(async () => {
        if (!contextMenu) return;
        const id = contextMenu.id;
        setContextMenu(null);
        const ok = await deleteConversation(id);
        if (!ok) {
            console.warn('[Sidebar] 删除失败:', id);
        }
    }, [contextMenu, deleteConversation]);

    const handleExport = useCallback(async () => {
        if (!contextMenu) return;
        const id = contextMenu.id;
        setContextMenu(null);
        const md = await exportMarkdown(id);
        if (md) {
            // 创建 Blob 下载
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conversation-${id.slice(0, 8)}.md`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            console.warn('[Sidebar] 导出失败或无内容:', id);
        }
    }, [contextMenu, exportMarkdown]);

    return (
        <aside className={`sidebar ${isOpen ? 'open' : 'closed'} ${isMobile ? 'mobile' : 'desktop'}`}>
            <div className="sidebar-header">
                <button className="sidebar-logo" onClick={handleGoHome} title="回到主页">
                    <span className="logo-icon">✦</span>
                    <span className="logo-text">Antigravity</span>
                </button>
                <button className="sidebar-btn" onClick={handleNewChat} title="新建对话">
                    ＋
                </button>
            </div>

            {/* 搜索框 */}
            <div className="sidebar-search">
                <input
                    type="text"
                    className="sidebar-search-input"
                    placeholder="搜索对话..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <button className="sidebar-search-clear" onClick={() => setSearch('')}>
                        ✕
                    </button>
                )}
            </div>

            <div className="sidebar-list">
                <div className="sidebar-section-title">
                    对话列表
                    <button className="sidebar-refresh-btn" onClick={handleRefresh} title="刷新">
                        ↻
                    </button>
                </div>

                {conversations.length === 0 && (
                    <div className="sidebar-empty">
                        {search ? '无搜索结果' : '暂无对话'}
                    </div>
                )}

                {conversations.map(conv => (
                    <ChatItem
                        key={conv.id}
                        conversation={conv}
                        isActive={conv.id === activeConversationId}
                        isRunning={
                            conv.id === activeConversationId
                                ? conversationStatus === 'RUNNING'
                                : conv.status === 'RUNNING'
                        }
                        onSelect={(id) => {
                            selectConversation(id);
                            if (isMobile && onClose) {
                                onClose();
                            }
                        }}
                        onContextMenu={handleContextMenu}
                    />
                ))}
            </div>

            {/* 右键菜单 */}
            {contextMenu && (
                <div
                    className="sidebar-context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button className="context-menu-item" onClick={handleExport}>
                        导出 Markdown
                    </button>
                    <button className="context-menu-item context-menu-danger" onClick={handleDelete}>
                        删除对话
                    </button>
                </div>
            )}
        </aside>
    );
}

// ========== ChatItem ==========

interface ChatItemProps {
    conversation: ConversationSummary;
    isActive: boolean;
    isRunning: boolean;
    onSelect: (id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function ChatItem({ conversation, isActive, isRunning, onSelect, onContextMenu }: ChatItemProps) {
    const title = conversation.title
        ? truncate(conversation.title, 30)
        : conversation.id.slice(0, 8) + '...';

    return (
        <button
            className={`chat-item ${isActive ? 'active' : ''} ${isRunning ? 'running' : ''}`}
            onClick={() => onSelect(conversation.id)}
            onContextMenu={e => onContextMenu(e, conversation.id)}
        >
            <div className="chat-item-icon">
                {isRunning ? <span className="chat-item-running-dot" /> : '💬'}
            </div>
            <div className="chat-item-info">
                <div className="chat-item-title">{title}</div>
                <div className="chat-item-meta">
                    <span>{formatRelativeTime(conversation.updatedAt)}</span>
                    {isRunning && <span className="chat-item-status-badge">运行中</span>}
                </div>
            </div>
        </button>
    );
}
