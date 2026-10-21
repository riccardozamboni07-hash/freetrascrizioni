// Service worker di Freetrascrizioni:
// - promemoria (notifiche) e timer di studio;
// - app e archivio usabili anche offline: prima prova la rete, se non c'è usa l'ultima copia salvata.
const APP = 'ft-app-v1', DATI = 'ft-dati-v1';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(APP).then(c => c.addAll(['/', '/manifest.webmanifest', '/icona-192.png', '/apple-touch-icon.png'])).catch(() => {}));
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![APP, DATI].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

// Dati che ha senso rileggere offline (mai pannello admin, mai notifiche)
const DA_SALVARE = /^\/api\/(stato$|privato\/(verifica|lezioni|serie|orario|oggi|esami|glossario|profilo|flashcard-materia|scheda|appunti)\b)/;

async function retePoiCache(req, nome){
  const cache = await caches.open(nome);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const vecchia = await cache.match(req, { ignoreVary: true });
    if (!vecchia) throw err;
    // segnala all'app che la risposta arriva dalla copia offline
    const h = new Headers(vecchia.headers); h.set('x-offline', '1');
    return new Response(await vecchia.blob(), { status: vecchia.status, headers: h });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { if (url.pathname === '/') e.respondWith(retePoiCache(new Request('/'), APP).catch(() => Response.error())); return; }
  if (DA_SALVARE.test(url.pathname)) { e.respondWith(retePoiCache(req, DATI)); return; }
  if (/\.(png|webmanifest)$/.test(url.pathname)) e.respondWith(retePoiCache(req, APP));
});

// All'uscita dall'account l'app chiede di cancellare la copia offline dei dati
self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'svuota') e.waitUntil(caches.delete(DATI));
});

// ---------- Notifiche ----------
// La notifica push arriva vuota: il testo lo chiediamo al server con un'impronta (hash) dell'iscrizione.
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
