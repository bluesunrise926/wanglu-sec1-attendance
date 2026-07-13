// Service Worker — 老王客家莊五權總店打卡系統 PWA
// v1：網路優先策略，確保永遠載入最新版本
const CACHE_NAME = 'wanglu-sec1-v1';
const CACHE_FILES = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] 清除舊快取:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Firebase、googleapis、gstatic 請求完全不走快取
  if (e.request.url.includes('firebase') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic')) {
    return;
  }

  // app.js 和 style.css 永遠從網路取得最新版（不快取）
  if (e.request.url.includes('app.js') || e.request.url.includes('style.css')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 其他資源：網路優先，失敗才用快取
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
