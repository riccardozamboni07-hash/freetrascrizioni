// Accesso per l'app pubblica (modalità MULTIUTENTE): password protette con PBKDF2,
// sessioni con cookie HttpOnly, accesso con Google (OAuth "authorization code").

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const casuale = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const nuovoId = () => casuale(12);

export async function hashPassword(password, sale = casuale(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sale), iterations: 100000 }, key, 256);
  return { sale, hash: b64u(bits) };
}
export async function verificaPassword(password, sale, hash) {
  const h = (await hashPassword(password, sale)).hash;
  let d = h.length ^ hash.length;
  for (let i = 0; i < Math.max(h.length, hash.length); i++) d |= (h.charCodeAt(i) || 0) ^ (hash.charCodeAt(i) || 0);
  return d === 0;
}
export const sha = async t => b64u(await crypto.subtle.digest('SHA-256', enc.encode(t)));
export const nuovoToken = () => casuale(32);

export function leggiCookie(request, nome) {
  const c = request.headers.get('cookie') || '';
  for (const p of c.split(';')) { const [k, ...v] = p.trim().split('='); if (k === nome) return decodeURIComponent(v.join('=')); }
  return '';
}
export function cookie(nome, valore, secondi) {
  return `${nome}=${encodeURIComponent(valore)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${secondi}`;
}
export const emailValida = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

// ---------- Google ----------
export function googleInizio(env, url, invito) {
  const stato = casuale(16);
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state: stato, prompt: 'select_account',
  });
  const h = new Headers({ location: 'https://accounts.google.com/o/oauth2/v2/auth?' + p });
  h.append('set-cookie', cookie('g_stato', stato + '|' + (invito || ''), 600));
  return new Response(null, { status: 302, headers: h });
}
// Scambia il codice con Google e restituisce { sub, email, verificata, nome, foto } oppure { errore }
export async function googleFine(env, url, request) {
  const [stato, invito] = leggiCookie(request, 'g_stato').split('|');
  if (!stato || stato !== url.searchParams.get('state')) return { errore: 'La sessione di accesso è scaduta: riprova.' };
  const code = url.searchParams.get('code');
  if (!code) return { errore: url.searchParams.get('error') === 'access_denied' ? 'Accesso con Google annullato.' : 'Accesso con Google non riuscito.' };
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/auth/google/callback', grant_type: 'authorization_code' }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.id_token) { console.log('Google token', res.status, JSON.stringify(d).slice(0, 200)); return { errore: 'Google non ha confermato l’accesso: riprova.' }; }
  // il token arriva direttamente da Google (HTTPS, con il nostro client secret): basta leggerne il contenuto
  let info = {};
  try { info = JSON.parse(atob(d.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (_) {}
  if (info.aud !== env.GOOGLE_CLIENT_ID || !info.sub) return { errore: 'Risposta di Google non valida.' };
  return { sub: info.sub, email: String(info.email || '').toLowerCase(), verificata: !!info.email_verified, nome: info.name || '', foto: info.picture || '', invito: invito || '' };
}
