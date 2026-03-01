/**
 * InstallPrompt — PWA 安装提示横条
 *
 * Android Chrome: 拦截 beforeinstallprompt，点击按钮触发原生安装弹窗
 * iOS Safari: 显示手动操作指引（iOS 不支持 beforeinstallprompt）
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

/** 检测是否为 iOS Safari */
function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function InstallPrompt() {
    const [show, setShow] = useState(false);
    const [isIOSDevice, setIsIOSDevice] = useState(false);
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        // 已安装 或 用户之前关闭过 → 不显示
        if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

        // iOS: 直接显示手动指引
        if (isIOS()) {
            setIsIOSDevice(true);
            setShow(true);
            return;
        }

        // Android/Desktop: 监听 beforeinstallprompt
        const handler = (e: Event) => {
            e.preventDefault();
            deferredPromptRef.current = e as BeforeInstallPromptEvent;
            setShow(true);
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
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
                    {isIOSDevice ? (
                        <span>
                            点击底部 <span className="install-prompt-share-icon">&#x2191;&#xFE0E;</span> 分享按钮，选择「添加到主屏幕」
                        </span>
                    ) : (
                        <span>安装到桌面，获得更好体验</span>
                    )}
                </div>
                <div className="install-prompt-actions">
                    {!isIOSDevice && (
                        <button className="install-prompt-btn primary" onClick={handleInstall}>
                            安装
                        </button>
                    )}
                    <button className="install-prompt-btn dismiss" onClick={handleDismiss}>
                        {isIOSDevice ? '知道了' : '稍后'}
                    </button>
                </div>
            </div>
        </div>
    );
}
