/**
 * BottomNav — 移动端底部导航栏
 *
 * 仅在移动端渲染，两个 Tab：Chat / Notes
 * 纯展示组件，通过 props 接收状态和回调
 */
import { MessageCircle, StickyNote } from 'lucide-react';

export type TabId = 'chat' | 'notes';

interface BottomNavProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
    return (
        <nav className="bottom-nav">
            <button
                className={`bottom-nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => onTabChange('chat')}
                aria-label="Chat"
            >
                <MessageCircle size={22} />
                <span className="bottom-nav-label">chat</span>
            </button>
            <button
                className={`bottom-nav-item ${activeTab === 'notes' ? 'active' : ''}`}
                onClick={() => onTabChange('notes')}
                aria-label="Notes"
            >
                <StickyNote size={22} />
                <span className="bottom-nav-label">notes</span>
            </button>
        </nav>
    );
}
