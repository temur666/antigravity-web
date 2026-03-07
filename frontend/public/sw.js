/**
 * Service Worker — Antigravity Chat
 *
 * 缓存策略: Stale-While-Revalidate (全量)
 *   - 所有 GET 请求先从缓存秒返回（无白屏）
 *   - 同时后台发起网络请求，拿到新版本后更新缓存
 *   - 下次打开即为最新版本
 *   - /api/*, /ws, WebSocket: 不拦截
 */

const CACHE_NAME = 'antigravity-v3';

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

  // ── Stale-While-Revalidate ──
  // 1. 有缓存 → 立即返回缓存（用户零等待）
  // 2. 同时后台 fetch 最新版本 → 更新缓存
  // 3. 无缓存 → 直接 fetch
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => {
            // 网络失败，如果有缓存就用缓存兜底
            if (cached) return cached;
            if (request.mode === 'navigate') {
              return cache.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });

        // 有缓存就先返回缓存，没有就等网络
        return cached || networkFetch;
      })
    )
  );
});
