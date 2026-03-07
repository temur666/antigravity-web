/**
 * arkBridge.ts — ArkWebView JS Bridge 工具
 *
 * 提供前端与 HarmonyOS ArkWebView 原生层的通信接口。
 * 浏览器环境下所有调用均静默跳过，不会报错。
 */

interface ArkTheme {
  statusBarColor: string;        // 状态栏背景色，如 '#292828'
  statusBarContentColor: string; // 状态栏文字/图标颜色，'#FFFFFF' | '#000000'
}

interface ArkBridgeGlobal {
  sendNotification?: (jsonStr: string) => void;
  pickImage?: () => void;
  setTheme?: (jsonStr: string) => void;
}

declare global {
  interface Window {
    arkBridge?: ArkBridgeGlobal;
  }
}

/** 检测当前是否运行在 ArkWebView 环境中 */
export function isArkWebView(): boolean {
  return typeof window !== 'undefined' && !!window.arkBridge;
}

/**
 * 向原生层同步主题信息（状态栏颜色等）
 * 非 ArkWebView 环境下静默跳过
 */
export function setArkTheme(theme: ArkTheme): void {
  window.arkBridge?.setTheme?.(JSON.stringify(theme));
}

/**
 * 从 CSS 变量中读取当前主题色并同步给原生层
 * 这是最常用的调用方式，自动从 :root CSS 变量中提取颜色
 */
export function syncThemeToArk(): void {
  if (!isArkWebView()) return;

  const styles = getComputedStyle(document.documentElement);
  const bgColor = styles.getPropertyValue('--color-bg-base').trim() || '#292828';

  setArkTheme({
    statusBarColor: bgColor,
    statusBarContentColor: '#FFFFFF',
  });
}
