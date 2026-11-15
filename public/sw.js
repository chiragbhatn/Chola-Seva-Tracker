/* Service worker for Chola Seva Tracker: only shows the reminder notifications.
   Pushes carry no data; /api/notification says what to show:
     - Monday/Friday 7 pm: tomorrow's location, opens the WhatsApp share screen
     - Tuesday/Saturday 8 pm: today's chola isn't logged yet, opens the log sheet
   No fetch handler, so the site itself is never cached here. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let n = { title: 'Chola Seva Tracker', body: 'Open the tracker for the next Hanuman day.', url: '/', tag: 'chola-reminder' };
    try {
      const res = await fetch('/api/notification', { cache: 'no-store' });
      if (res.ok) n = { ...n, ...(await res.json()) };
    } catch (e) {
      // Offline: show the generic reminder.
    }
    await self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify: true,
      data: { url: n.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
