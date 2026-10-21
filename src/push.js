// Promemoria con le notifiche push del browser (Web Push con chiavi VAPID).
// Le chiavi si creano da sole la prima volta e restano nell'archivio: non serve configurare niente.
// La notifica parte "vuota" (senza contenuto cifrato): è il service worker (public/sw.js) a mostrare il testo.

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export async function creaChiaviVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', k.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { pubblica: b64u(pub), privata: JSON.stringify(jwk) };
}

async function firmaVapid(endpoint, chiavi, contatto) {
  const aud = new URL(endpoint).origin;
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const dati = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contatto || 'mailto:freetrascrizioni@example.com' });
  const key = await crypto.subtle.importKey('jwk', JSON.parse(chiavi.privata), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(dati));
  return dati + '.' + b64u(firma);
}

// Invia una notifica a un'iscrizione. Restituisce 'ok', 'scaduta' (da cancellare) oppure 'errore'.
export async function inviaPush(iscrizione, chiavi, contatto) {
  try {
    const jwt = await firmaVapid(iscrizione.endpoint, chiavi, contatto);
    const res = await fetch(iscrizione.endpoint, {
      method: 'POST',
      headers: { TTL: '43200', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${chiavi.pubblica}`, 'Content-Length': '0' },
    });
    if (res.status === 404 || res.status === 410) return 'scaduta';
    if (!res.ok) { console.log('Push', res.status, (await res.text().catch(() => '')).slice(0, 200)); return 'errore'; }
    return 'ok';
  } catch (e) { console.log('Push errore', String(e)); return 'errore'; }
}

export const chiaveValida = s => { try { return daB64u(s).length === 65; } catch (_) { return false; } };
