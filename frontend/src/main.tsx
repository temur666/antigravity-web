/**
 * main.tsx — 应用入口
 *
 * 初始化 WSClient + Store，然后挂载 React 应用
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WSClient } from './store/ws-client';
import { createAppStore } from './store/app-store';
import { setStoreInstance } from './store/hooks';
import App from './App';
import './index.css';

// ========== 初始化 ==========

// 1. 创建 WSClient
const wsClient = new WSClient();

// 2. 创建 Store (注入 WSClient)
const store = createAppStore(wsClient);
setStoreInstance(store);

// 3. 连接 WebSocket
wsClient.connect();

// 4. 连接 / 重连后加载状态
let wasConnected = false;
wsClient.onStateChange((state) => {
  if (state === 'CONNECTED') {
    const s = store.getState();
    s.loadStatus();
    s.loadConversations();

    // 重连时恢复活跃对话的订阅
    if (wasConnected && s.activeConversationId) {
      s.selectConversation(s.activeConversationId);
    }
    wasConnected = true;
  }
});

// ========== 挂载 React ==========

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ========== 注册 Service Worker (仅生产环境) ==========

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] Registration failed:', err);
    });
  });
}
