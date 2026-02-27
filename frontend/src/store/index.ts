/**
 * store/index.ts — Store 初始化入口
 */

export { createAppStore } from './app-store';
export type { AppState, AppStore } from './app-store';
export { WSClient, WSClientState } from './ws-client';
export { useAppStore, setStoreInstance, getStoreInstance } from './hooks';
