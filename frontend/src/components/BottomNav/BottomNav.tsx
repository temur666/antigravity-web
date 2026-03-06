/**
 * BottomNav — 移动端底部导航栏
 *
 * 仅在移动端渲染，两个 Tab：Chat / Notes
 * 键盘弹出时自动隐藏，收回后恢复
 */
import "./BottomNav.css";
import { MessageCircle, StickyNote } from 'lucide-react';

export type TabId = 'chat' | 'notes';

interface BottomNavProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
    hidden?: boolean;
}

export function BottomNav({ activeTab, onTabChange, hidden }: BottomNavProps) {
    return (
        <nav className={`bottom-nav ${hidden ? 'bottom-nav-hidden' : ''}`}>
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
