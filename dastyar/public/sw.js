/**
 * Service Worker — نمایش نوتیفیکیشن و کش سبک فایل‌های برنامه
 */
const CACHE = 'dastyar-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/core.js', '/js/crypto.js', '/js/components.js',
  '/js/views/today.js', '/js/views/tasks.js', '/js/views/vault.js',
  '/js/views/finance.js', '/js/views/more.js',
  '/lib/jalali.js', '/lib/dt.js', '/lib/recur.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// درخواست‌های API هرگز کش نمی‌شوند؛ فایل‌های برنامه «اول شبکه، بعد کش»
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html'))),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'دستیار', body: '' };
  try { if (event.data) data = event.data.json(); } catch { data.body = event.data?.text() || ''; }
  event.waitUntil(self.registration.showNotification(data.title || 'دستیار', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge.png',
    tag: data.tag || 'dastyar',
    dir: 'rtl',
    lang: 'fa',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: data.url || '/#/today' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/#/today';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.includes(self.location.origin)) {
        client.focus();
        client.navigate(target).catch(() => {});
        return null;
      }
    }
    return clients.openWindow(target);
  }));
});
