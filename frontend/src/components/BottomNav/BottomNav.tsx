/**
 * BottomNav — 移动端底部导航栏
 *
 * 仅在移动端渲染，两个 Tab：Chat / Notes
 * 键盘弹出时自动隐藏，收回后恢复
 */
import { useState, useEffect } from 'react';
import { MessageCircle, StickyNote } from 'lucide-react';

export type TabId = 'chat' | 'notes';

interface BottomNavProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
}

/** 键盘弹出检测阈值 (px)：视口高度缩小超过此值视为键盘弹出 */
const KEYBOARD_THRESHOLD = 150;

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        // 初始全高度（无键盘时）
        let fullHeight = window.innerHeight;

        const handleResize = () => {
            const currentHeight = vv.height;
            const diff = fullHeight - currentHeight;
            setKeyboardVisible(diff > KEYBOARD_THRESHOLD);
        };

        // 屏幕旋转等场景需要更新 fullHeight
        const handleWindowResize = () => {
            // 只在键盘未弹出时更新 fullHeight
            if (vv.height >= window.innerHeight - 50) {
                fullHeight = window.innerHeight;
            }
        };

        vv.addEventListener('resize', handleResize);
        window.addEventListener('resize', handleWindowResize);

        return () => {
            vv.removeEventListener('resize', handleResize);
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    return (
        <nav className={`bottom-nav ${keyboardVisible ? 'bottom-nav-hidden' : ''}`}>
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
