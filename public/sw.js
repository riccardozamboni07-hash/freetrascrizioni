// Service worker di Freetrascrizioni: serve per i promemoria (notifiche) e il timer di studio.
// La notifica push arriva vuota: il testo lo chiediamo al server con un'impronta (hash) dell'iscrizione.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PREDEFINITA = { titolo: 'È ora di ripassare 📚', testo: 'Hai delle lezioni da ripassare oggi. Tocca per vedere il piano.', url: '/?tab=oggi' };

async function messaggio(){
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return PREDEFINITA;
    const h = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint)));
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('/api/notifica?e=' + h, { signal: ctrl.signal, cache: 'no-store' });
    const m = r.ok ? await r.json() : null;
    return m && m.titolo ? m : PREDEFINITA;
  } catch (_) { return PREDEFINITA; }
}

self.addEventListener('push', e => {
  e.waitUntil(messaggio().then(m => self.registration.showNotification(m.titolo, {
    body: m.testo, icon: '/icona-192.png', badge: '/icona-192.png',
    tag: (m.url || '').includes('registra') ? 'lezione' : 'ripasso', renotify: true, data: { url: m.url || '/' },
  })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.postMessage({ tipo: 'apri', url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
