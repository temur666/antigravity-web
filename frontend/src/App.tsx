/**
 * App.tsx — 主应用组件
 *
 * 布局: Sidebar | ChatPanel
 *       StatusBar (底部)
 */
import { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { StatusBar } from './components/StatusBar/StatusBar';

export default function App() {
  const [showSidebar, setShowSidebar] = useState(true);

  return (
    <div className="app">
      {/* 侧边栏 */}
      {showSidebar && <Sidebar />}

      {/* 主区域 */}
      <main className="main-area">
        {/* Header */}
        <header className="app-header">
          <button
            className="header-btn"
            onClick={() => setShowSidebar(!showSidebar)}
            title="切换侧边栏"
          >
            ☰
          </button>
          <div className="header-title">Antigravity Chat</div>
          {/* Placeholder or empty div to maintain title centering if flex is space-between */}
          <div style={{ width: 36 }}></div>
        </header>

        {/* 内容区 */}
        <div className="main-content">
          <ChatPanel />
        </div>

        {/* 状态栏 */}
        <StatusBar />
      </main>
    </div>
  );
}
