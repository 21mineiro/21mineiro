// Cache para o app abrir sem internet + notificações
const CACHE = 'desafios-v3';
const FILES = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg', '/icon-192.png', '/fonts/space-grotesk.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Arquivos do app: rede primeiro, cache se offline. API e login nunca passam pelo cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Desafios', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Desafios', {
    body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow(e.notification.data?.url || '/');
  }));
});
