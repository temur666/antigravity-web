/**
 * App.tsx — 主应用组件
 *
 * 布局: Sidebar | ChatPanel
 *       StatusBar (底部)
 */
import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { Dashboard } from './components/Dashboard/Dashboard';
import { StatusBar } from './components/StatusBar/StatusBar';
import { InstallPrompt } from './components/InstallPrompt/InstallPrompt';
import { ModelSelector } from './components/Header/ModelSelector';
import { useAppStore } from '@/store';

export default function App() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const activeConversationId = useAppStore(s => s.activeConversationId);

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
          <div style={{ width: 36 }}></div>
        </header>

        {/* 内容区 */}
        <div className="main-content">
          {activeConversationId ? <ChatPanel /> : <Dashboard />}
        </div>

        {/* 状态栏 */}
        <StatusBar />
      </main>

      {/* PWA 安装提示 */}
      <InstallPrompt />
    </div>
  );
}
