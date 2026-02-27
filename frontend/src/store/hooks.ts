/**
 * React hooks — 桥接 zustand vanilla store 到 React 组件
 */

import { useStore as useZustandStore } from 'zustand';
import type { AppState, AppStore } from './app-store';

// 全局 store 实例，由 initStore 初始化
let storeInstance: AppStore | null = null;

export function setStoreInstance(store: AppStore): void {
    storeInstance = store;
}

export function getStoreInstance(): AppStore {
    if (!storeInstance) throw new Error('Store not initialized. Call setStoreInstance first.');
    return storeInstance;
}

/**
 * 主 hook — 选择性订阅 store 的部分状态
 *
 * @example
 * const steps = useAppStore(s => s.steps);
 * const { sendMessage, newChat } = useAppStore(s => ({ sendMessage: s.sendMessage, newChat: s.newChat }));
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
    return useZustandStore(getStoreInstance(), selector);
}
