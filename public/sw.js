/* Service worker for Chola Seva Tracker: only shows the Monday/Friday reminder.
   The push has no data; the text comes from /api/reminder when it arrives.
   No fetch handler, so the site itself is never cached here. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let title = 'Chola seva tomorrow';
    let body = 'Tap to share the plan on WhatsApp.';
    try {
      const res = await fetch('/api/reminder', { cache: 'no-store' });
      if (res.ok) {
        const r = await res.json();
        if (r.title) title = r.title;
        if (r.body) body = r.body;
      }
    } catch (e) {
      // Offline: show the generic reminder.
    }
    await self.registration.showNotification(title, {
      body,
      tag: 'chola-reminder',
      renotify: true,
      data: { url: '/?share=1' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
