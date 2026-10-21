// Service worker di Freetrascrizioni: serve solo per i promemoria (notifiche) e il timer di studio.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  e.waitUntil(self.registration.showNotification('È ora di ripassare 📚', {
    body: 'Hai delle lezioni da ripassare oggi. Tocca per vedere il piano.',
    icon: '/icona-192.png', badge: '/icona-192.png', tag: 'ripasso', renotify: true,
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
});
