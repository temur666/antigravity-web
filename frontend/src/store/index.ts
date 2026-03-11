/**
 * store/index.ts — Store 初始化入口
 */

export { createAppStore } from './app-store';
export type { AppState, AppStore } from './app-store';
export { SSEClient, SSEClientState } from './sse-client';
export { api } from './api-client';
// WSClient 保留导出，测试文件和过渡期代码仍需使用，阶段三统一删除
export { WSClient, WSClientState } from './ws-client';
export { useAppStore, setStoreInstance, getStoreInstance } from './hooks';
