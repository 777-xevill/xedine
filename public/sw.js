/*
 * Xedine service worker. Two jobs. (1) The till (ARCHITECTURE.md "Offline POS"): a till or kitchen screen that
 * is reloaded, or reopened after a crash, while the internet is down still opens. Orders themselves
 * are queued in IndexedDB by the app (src/modules/pos/outbox.ts), not here.
 *
 * - Navigations to /pos and /kds: network first, cached copy when offline.
 * - /_next/static/*: content-hashed and immutable, so cache first.
 * - Everything else (the dashboard, Supabase API calls, other origins) is left alone.
 */
const CACHE = 'xedine-till-v1';
const TILL_PAGES = ['/pos', '/kds'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isTillPage = (url) =>
  TILL_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // A redirect means the device's login expired; never cache the sign-in page as the till.
    if (response.ok && !response.redirected) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/*
 * Offer notifications (ADR 0048). The server sends {title, body, url, tag} encrypted; show it, and open the
 * customer's member card when they tap it. A message that cannot be read still shows something, because
 * the browser requires every push to show a notification.
 */
self.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    note = {};
  }
  const title = typeof note.title === 'string' && note.title ? note.title : 'Xedine';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof note.body === 'string' ? note.body : '',
      icon: '/brand/logo-192.png',
      badge: '/brand/logo-64.png',
      tag: typeof note.tag === 'string' ? note.tag : undefined,
      data: { url: typeof note.url === 'string' ? note.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin);
  // Only a link on this site: a push never sends the phone somewhere else.
  const target = url.origin === self.location.origin ? url.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      const open = all.find((c) => c.url === target && 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && isTillPage(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    // Only the till's own chunks are kept, so dashboard visits don't grow the cache deploy after deploy.
    event.respondWith(
      (async () => {
        const client = event.clientId ? await self.clients.get(event.clientId) : null;
        if (client && isTillPage(new URL(client.url))) return cacheFirst(request);
        return (await caches.match(request)) ?? fetch(request);
      })(),
    );
    return;
  }
  // The till's icons and fonts are small; keep them so an offline reload still looks right.
  if (url.pathname.startsWith('/brand/')) event.respondWith(cacheFirst(request));
});
