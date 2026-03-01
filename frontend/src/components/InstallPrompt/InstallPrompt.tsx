/**
 * InstallPrompt — PWA 安装提示横条
 *
 * Android Chrome: 拦截 beforeinstallprompt，点击按钮触发原生安装弹窗
 * iOS Safari: 显示手动操作指引
 * 华为/其他浏览器: 通用"添加到桌面"指引（兜底）
 * 已安装 / 用户关闭后不再显示（localStorage 记忆）
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

/** 检测是否已经以 standalone 模式运行（已安装） */
function isStandalone(): boolean {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
    );
}

/** 检测是否为 iOS */
function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/** 检测是否为移动设备 */
function isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|HarmonyOS|Huawei/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 0 && window.innerWidth <= 768);
}

type PromptMode = 'native' | 'ios' | 'generic';

export function InstallPrompt() {
    const [show, setShow] = useState(false);
    const [mode, setMode] = useState<PromptMode>('generic');
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
    const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // 已安装 或 用户之前关闭过 → 不显示
        if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

        // 非移动设备 → 不显示（桌面端用户不需要安装提示）
        if (!isMobileDevice()) return;

        // iOS: 直接显示手动指引
        if (isIOS()) {
            setMode('ios');
            setShow(true);
            return;
        }

        // 非 iOS 移动设备：监听 beforeinstallprompt
        let gotPrompt = false;

        const handler = (e: Event) => {
            e.preventDefault();
            gotPrompt = true;
            deferredPromptRef.current = e as BeforeInstallPromptEvent;
            setMode('native');
            setShow(true);
            // 收到原生事件，取消兜底
            if (fallbackTimerRef.current) {
                clearTimeout(fallbackTimerRef.current);
                fallbackTimerRef.current = null;
            }
        };

        window.addEventListener('beforeinstallprompt', handler);

        // 兜底：2 秒内没收到 beforeinstallprompt → 显示通用指引
        // （华为浏览器、Firefox、Samsung Internet 等不触发此事件）
        fallbackTimerRef.current = setTimeout(() => {
            if (!gotPrompt) {
                setMode('generic');
                setShow(true);
            }
        }, 2000);

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
            if (fallbackTimerRef.current) {
                clearTimeout(fallbackTimerRef.current);
            }
        };
    }, []);

    const handleInstall = useCallback(async () => {
        const prompt = deferredPromptRef.current;
        if (!prompt) return;

        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
            setShow(false);
        }
        deferredPromptRef.current = null;
    }, []);

    const handleDismiss = useCallback(() => {
        setShow(false);
        localStorage.setItem(DISMISS_KEY, '1');
    }, []);

    if (!show) return null;

    const renderMessage = () => {
        switch (mode) {
            case 'ios':
                return (
                    <span>
                        点击底部 <span className="install-prompt-share-icon">&#x2191;&#xFE0E;</span> 分享按钮，选择「添加到主屏幕」
                    </span>
                );
            case 'native':
                return <span>安装到桌面，获得更好体验</span>;
            case 'generic':
                return <span>点击浏览器菜单，选择「添加到桌面」即可安装</span>;
        }
    };

    return (
        <div className="install-prompt">
            <div className="install-prompt-content">
                <img
                    className="install-prompt-icon"
                    src="/icons/icon-192.png"
                    alt="Antigravity Chat"
                    width={40}
                    height={40}
                />
                <div className="install-prompt-text">
                    <strong>Antigravity Chat</strong>
                    {renderMessage()}
                </div>
                <div className="install-prompt-actions">
                    {mode === 'native' && (
                        <button className="install-prompt-btn primary" onClick={handleInstall}>
                            安装
                        </button>
                    )}
                    <button className="install-prompt-btn dismiss" onClick={handleDismiss}>
                        {mode === 'native' ? '稍后' : '知道了'}
                    </button>
                </div>
            </div>
        </div>
    );
}
