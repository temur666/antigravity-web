/**
 * Service Worker — Antigravity Chat
 *
 * 缓存策略:
 *   - /assets/* (Vite 带 content hash): Cache-First (不可变资源，永远从缓存读)
 *   - HTML / 其他: Network-First (优先网络，离线时回退缓存)
 *   - /api/*, /ws, WebSocket: 不拦截
 *
 * 这样做的好处:
 *   1. 切换 app 回来时，SW 从缓存立即响应 HTML + JS/CSS，不白屏
 *   2. 在线时 HTML 总是拿最新版本
 *   3. Hashed assets 从缓存秒读、零网络开销
 */

const CACHE_NAME = 'antigravity-v2';

// ========== Install ==========
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ========== Activate ==========
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ========== Fetch ==========
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳过: 非 GET、API、WebSocket、Chrome 扩展
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  // ── Hashed assets (Vite 构建产物): Cache-First ──
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── HTML 及其他: Network-First ──
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        })
      )
  );
});
