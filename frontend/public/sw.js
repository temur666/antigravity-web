/**
 * Service Worker — Antigravity Chat
 *
 * 策略: App Shell 缓存 + Network First
 * - 首次加载时缓存核心静态资源
 * - 后续请求优先走网络，网络失败时回退缓存
 * - API/WebSocket 请求不缓存
 */

const CACHE_NAME = 'antigravity-v1';

// 需要预缓存的 App Shell 资源（构建后的实际路径）
const APP_SHELL = [
    '/',
    '/index.html',
];

// 安装：预缓存 App Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    // 跳过等待，立即激活
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    // 立即接管所有客户端
    self.clients.claim();
});

// 请求拦截：Network First + 缓存回退
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 跳过：非 GET、WebSocket、API 请求、Chrome 扩展
    if (
        request.method !== 'GET' ||
        url.pathname.startsWith('/ws') ||
        url.pathname.startsWith('/api') ||
        url.protocol === 'chrome-extension:'
    ) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                // 网络成功 → 更新缓存
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => {
                // 网络失败 → 回退缓存
                return caches.match(request).then((cached) => {
                    if (cached) return cached;
                    // 导航请求回退到 index.html (SPA)
                    if (request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    return new Response('Offline', { status: 503 });
                });
            })
    );
});
