/**
 * App.tsx — 主应用组件
 *
 * 布局: Sidebar | ChatPanel
 */
import { useState, useEffect } from 'react';
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
