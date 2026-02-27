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

// 4. 连接后加载初始状态
wsClient.onStateChange((state) => {
  if (state === 'CONNECTED') {
    store.getState().loadStatus();
    store.getState().loadConversations();
  }
});

// ========== 挂载 React ==========

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
