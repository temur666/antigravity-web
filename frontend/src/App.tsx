/**
 * App.tsx — 主应用组件
 *
 * 布局: Sidebar | ChatPanel + ConfigPanel
 *       StatusBar (底部)
 */
import { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConfigPanel } from './components/ConfigPanel/ConfigPanel';
import { StatusBar } from './components/StatusBar/StatusBar';

export default function App() {
  const [showConfig, setShowConfig] = useState(false);
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
          <button
            className={`header-btn ${showConfig ? 'active' : ''}`}
            onClick={() => setShowConfig(!showConfig)}
            title="配置"
          >
            ⚙️
          </button>
        </header>

        {/* 内容区 */}
        <div className="main-content">
          <ChatPanel />
          {showConfig && <ConfigPanel />}
        </div>

        {/* 状态栏 */}
        <StatusBar />
      </main>
    </div>
  );
}
