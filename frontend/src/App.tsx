/**
 * App.tsx — 主应用组件
 *
 * 布局: Sidebar | ChatPanel
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { Dashboard } from './components/Dashboard/Dashboard';
import { InstallPrompt } from './components/InstallPrompt/InstallPrompt';
import { ModelSelector } from './components/Header/ModelSelector';
import { Rows3, BookOpen } from 'lucide-react';
import { useAppStore } from '@/store';

export default function App() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const activeConversationId = useAppStore(s => s.activeConversationId);
  const viewMode = useAppStore(s => s.viewMode);
  const toggleViewMode = useAppStore(s => s.toggleViewMode);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setShowSidebar(false);
      } else {
        setShowSidebar(true);
      }
    };

    // Initial check
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── 移动端触摸滑动切换侧边栏 ──
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const sidebarOpenRef = useRef(showSidebar);
  sidebarOpenRef.current = showSidebar;

  const EDGE_ZONE = 30;       // 左侧边缘触发区 (px)
  const SWIPE_THRESHOLD = 50; // 滑动阈值 (px)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    // 打开手势：必须从左边缘起始；关闭手势：侧边栏已打开时任意位置起始
    if (!sidebarOpenRef.current && t.clientX > EDGE_ZONE) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    // 水平位移必须大于垂直位移，避免与正常滚动冲突
    if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < SWIPE_THRESHOLD) return;

    if (dx > 0 && !sidebarOpenRef.current) {
      setShowSidebar(true);
    } else if (dx < 0 && sidebarOpenRef.current) {
      setShowSidebar(false);
    }
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, onTouchStart, onTouchEnd]);

  return (
    <div className="app">
      {/* 遮罩层 (仅移动端且侧边栏打开时显示) */}
      {isMobile && showSidebar && (
        <div
          className="sidebar-backdrop"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* 侧边栏 */}
      <Sidebar isOpen={showSidebar} isMobile={isMobile} onClose={() => setShowSidebar(false)} />

      {/* 主区域 */}
      <main className="main-area">
        {/* Header */}
        <header className="app-header">
          <button
            className={`header-btn ${showSidebar ? 'active' : ''}`}
            onClick={() => setShowSidebar(!showSidebar)}
            title="切换侧边栏"
          >
            ☰
          </button>
          <ModelSelector position="header" />
          <button
            className={`header-btn ${viewMode === 'paged' ? 'active' : ''}`}
            onClick={toggleViewMode}
            title={viewMode === 'scroll' ? '切换到翻页模式' : '切换到滚动模式'}
          >
            {viewMode === 'scroll' ? <Rows3 size={16} /> : <BookOpen size={16} />}
          </button>
        </header>

        {/* 内容区 */}
        <div className="main-content">
          {activeConversationId ? <ChatPanel /> : <Dashboard />}
        </div>
      </main>

      {/* PWA 安装提示 */}
      <InstallPrompt />
    </div>
  );
}
