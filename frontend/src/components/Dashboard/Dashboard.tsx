/**
 * Dashboard — 任务仪表盘
 *
 * 首屏：无对话选中时展示。
 * 展示引擎连接状态、进行中任务、最近完成任务。
 * 数据源：store.conversations (已有)
 */
import { useAppStore } from '@/store';
import { formatRelativeTime, truncate } from '@/utils/format';
import type { ConversationSummary } from '@/types';

const RECENT_LIMIT = 15;

export function Dashboard() {
    const lsConnected = useAppStore(s => s.lsConnected);
    const lsInfo = useAppStore(s => s.lsInfo);
    const conversations = useAppStore(s => s.conversations);
    const selectConversation = useAppStore(s => s.selectConversation);
    const newChat = useAppStore(s => s.newChat);
    const loadConversations = useAppStore(s => s.loadConversations);

    const running = conversations.filter(c => c.status === 'RUNNING');
    const recent = conversations
        .filter(c => c.status !== 'RUNNING')
        .slice(0, RECENT_LIMIT);

    return (
        <div className="dashboard">
            {/* 引擎状态 */}
            <div className="dashboard-engine">
                <span className={`engine-dot ${lsConnected ? 'online' : 'offline'}`} />
                <span className="engine-label">
                    {lsConnected
                        ? `引擎已连接  Port:${lsInfo?.port}  PID:${lsInfo?.pid}`
                        : '引擎未连接'
                    }
                </span>
            </div>

            {/* 进行中 */}
            <section className="dashboard-section">
                <div className="dashboard-section-header">
                    <h2>进行中 ({running.length})</h2>
                    <button
                        className="dashboard-action-btn"
                        onClick={() => loadConversations()}
                        title="刷新"
                    >
                        ↻
                    </button>
                </div>

                {running.length === 0 && (
                    <div className="dashboard-empty">
                        当前没有正在进行的任务
                    </div>
                )}

                <div className="dashboard-grid">
                    {running.map(conv => (
                        <TaskCard
                            key={conv.id}
                            conversation={conv}
                            onSelect={selectConversation}
                        />
                    ))}
                </div>
            </section>

            {/* 最近完成 */}
            <section className="dashboard-section">
                <div className="dashboard-section-header">
                    <h2>最近完成</h2>
                    <button
                        className="dashboard-action-btn new-chat-btn"
                        onClick={() => newChat()}
                        title="新建对话"
                    >
                        + 新任务
                    </button>
                </div>

                {recent.length === 0 && (
                    <div className="dashboard-empty">
                        暂无历史任务
                    </div>
                )}

                <div className="dashboard-grid">
                    {recent.map(conv => (
                        <TaskCard
                            key={conv.id}
                            conversation={conv}
                            onSelect={selectConversation}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

// ========== TaskCard ==========

interface TaskCardProps {
    conversation: ConversationSummary;
    onSelect: (id: string) => void;
}

function TaskCard({ conversation, onSelect }: TaskCardProps) {
    const isRunning = conversation.status === 'RUNNING';
    const title = conversation.title
        ? truncate(conversation.title, 50)
        : conversation.id.slice(0, 8) + '...';

    return (
        <button
            className={`task-card ${isRunning ? 'running' : ''}`}
            onClick={() => onSelect(conversation.id)}
        >
            <div className="task-card-top">
                <span className={`task-status-badge ${isRunning ? 'badge-running' : 'badge-idle'}`}>
                    {isRunning ? 'RUNNING' : 'IDLE'}
                </span>
                {conversation.stepCount != null && conversation.stepCount > 0 && (
                    <span className="task-step-count">
                        {conversation.stepCount} 步
                    </span>
                )}
            </div>
            <div className="task-card-title">{title}</div>
            <div className="task-card-meta">
                <span>{formatRelativeTime(conversation.updatedAt)}</span>
                {conversation.workspace && (
                    <span className="task-workspace">
                        {conversation.workspace.split('/').pop()}
                    </span>
                )}
            </div>
        </button>
    );
}
