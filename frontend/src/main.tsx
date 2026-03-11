/**
 * main.tsx — 应用入口
 *
 * 初始化 SSEClient + Store，然后挂载 React 应用
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SSEClient } from './store/sse-client';
import { createAppStore } from './store/app-store';
import { setStoreInstance } from './store/hooks';
import App from './App';
import './index.css';

// ========== 初始化 ==========

// 1. 创建 SSEClient
const sseClient = new SSEClient();

// 2. 创建 Store (注入 SSEClient)
const store = createAppStore(sseClient);
setStoreInstance(store);

// 3. 连接 SSE
sseClient.connect();

// 4. 重连恢复统一由 app-store 的 event_ls_status 事件处理
//    （服务端在 SSE 连接建立后立即推送 event_ls_status）

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
