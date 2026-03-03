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

const SIDEBAR_WIDTH = 300;      // 与 CSS .sidebar width 一致
const EDGE_ZONE = 30;           // 左侧边缘触发区 (px)
const SNAP_RATIO = 0.4;         // 拖过 40% 即吸附
const VELOCITY_THRESHOLD = 0.3; // px/ms，快速滑动直接吸附

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
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── 移动端触摸跟手拖拽侧边栏 ──
  const sidebarOpenRef = useRef(showSidebar);
  sidebarOpenRef.current = showSidebar;

  const draggingRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const directionLockedRef = useRef<'h' | 'v' | null>(null);

  const getSidebarEl = () => document.querySelector<HTMLElement>('.sidebar.mobile');
  const getBackdropEl = () => document.querySelector<HTMLElement>('.sidebar-backdrop');

  /** 实时设置 sidebar 位移（-300 ~ 0） */
  const applySidebarOffset = useCallback((offsetX: number) => {
    const sidebar = getSidebarEl();
    const backdrop = getBackdropEl();
    if (sidebar) {
      sidebar.style.transition = 'none';
      sidebar.style.transform = `translateX(${offsetX}px)`;
    }
    if (backdrop) {
      const progress = (offsetX + SIDEBAR_WIDTH) / SIDEBAR_WIDTH; // 0~1
      backdrop.style.transition = 'none';
      backdrop.style.opacity = `${Math.max(0, Math.min(1, progress))}`;
      backdrop.style.pointerEvents = progress > 0.05 ? 'auto' : 'none';
    }
  }, []);

  /** 恢复 CSS transition */
  const restoreTransition = useCallback(() => {
    const sidebar = getSidebarEl();
    const backdrop = getBackdropEl();
    if (sidebar) sidebar.style.transition = '';
    if (backdrop) backdrop.style.transition = '';
  }, []);

  /** 清除 inline style，交还 CSS class 控制 */
  const clearInlineStyles = useCallback(() => {
    const sidebar = getSidebarEl();
    const backdrop = getBackdropEl();
    if (sidebar) { sidebar.style.transition = ''; sidebar.style.transform = ''; }
    if (backdrop) { backdrop.style.transition = ''; backdrop.style.opacity = ''; backdrop.style.pointerEvents = ''; }
  }, []);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    const isOpen = sidebarOpenRef.current;
    if (!isOpen && t.clientX > EDGE_ZONE) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    directionLockedRef.current = null;
    draggingRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;

    // 方向锁定
    if (!directionLockedRef.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      directionLockedRef.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    if (directionLockedRef.current === 'v') return;

    draggingRef.current = true;

    const isOpen = sidebarOpenRef.current;
    const baseOffset = isOpen ? 0 : -SIDEBAR_WIDTH;
    const rawOffset = baseOffset + dx;
    const clampedOffset = Math.max(-SIDEBAR_WIDTH, Math.min(0, rawOffset));
    applySidebarOffset(clampedOffset);
  }, [applySidebarOffset]);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current || !draggingRef.current) {
      touchStartRef.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dt = e.timeStamp - touchStartRef.current.t;
    touchStartRef.current = null;
    draggingRef.current = false;
    directionLockedRef.current = null;

    const velocity = Math.abs(dx) / (dt || 1);
    const isOpen = sidebarOpenRef.current;
    const baseOffset = isOpen ? 0 : -SIDEBAR_WIDTH;
    const currentOffset = Math.max(-SIDEBAR_WIDTH, Math.min(0, baseOffset + dx));
    const progress = (currentOffset + SIDEBAR_WIDTH) / SIDEBAR_WIDTH;

    let shouldOpen: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      shouldOpen = dx > 0;
    } else {
      shouldOpen = progress > SNAP_RATIO;
    }

    restoreTransition();
    if (shouldOpen) {
      applySidebarOffset(0);
      setShowSidebar(true);
    } else {
      applySidebarOffset(-SIDEBAR_WIDTH);
      setShowSidebar(false);
    }
    setTimeout(clearInlineStyles, 350);
  }, [applySidebarOffset, restoreTransition, clearInlineStyles]);

  useEffect(() => {
    if (!isMobile) return;
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, onTouchStart, onTouchMove, onTouchEnd]);

  return (
    <div className="app">
      {/* 遮罩层 — 移动端始终渲染，通过 opacity/pointer-events 控制 */}
      {isMobile && (
        <div
          className={`sidebar-backdrop ${showSidebar ? 'visible' : ''}`}
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* 侧边栏 */}
      <Sidebar isOpen={showSidebar} isMobile={isMobile} onClose={() => setShowSidebar(false)} />

      {/* 主区域 */}
      <main className="main-area">
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

        <div className="main-content">
          {activeConversationId ? <ChatPanel /> : <Dashboard />}
        </div>
      </main>

      <InstallPrompt />
    </div>
  );
}
