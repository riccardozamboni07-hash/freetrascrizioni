// Freetrascrizioni — Cloudflare Worker
// - serve l'app (cartella public/)
// - /api/stato: dice se chiave Groq e password sono impostate (per la schermata di primo avvio)
// - /api/trascrivi: trascrizione online con Groq, solo con la password giusta
// - /api/privato/*: verifica password, ore usate oggi e archivio delle lezioni
// Segreti da impostare su Cloudflare: GROQ_API_KEY e PASSWORD.
import { DurableObject } from 'cloudflare:workers';
import { onRequest as trascrivi } from './trascrivi.js';

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS uso (giorno TEXT, chi TEXT, secondi REAL NOT NULL, PRIMARY KEY (giorno, chi))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lezioni (
      id TEXT PRIMARY KEY, materia TEXT NOT NULL, titolo TEXT NOT NULL, data TEXT NOT NULL,
      durata REAL, testo TEXT NOT NULL, appunti TEXT NOT NULL DEFAULT '', creata INTEGER, aggiornata INTEGER)`);
  }
  usa(secondi) {
    const add = (g) => this.sql.exec(`INSERT INTO uso (giorno, chi, secondi) VALUES (?, 'privato', ?)
      ON CONFLICT (giorno, chi) DO UPDATE SET secondi = secondi + excluded.secondi`, g, secondi);
    add(new Date().toISOString().slice(0, 10));
    add('ora:' + new Date().toISOString().slice(0, 13));
  }
  usoOggi() {
    const get = (g) => (this.sql.exec('SELECT secondi FROM uso WHERE giorno = ?', g).toArray()[0] || {}).secondi || 0;
    return { privato: get(new Date().toISOString().slice(0, 10)), pubblico: 0, oraCorrente: get('ora:' + new Date().toISOString().slice(0, 13)) };
  }
  elenco(q) {
    const cols = 'id, materia, titolo, data, durata, creata, aggiornata, length(testo) AS caratteri, length(appunti) > 0 AS conAppunti';
    if (q) {
      const like = '%' + q.replace(/[%_]/g, '') + '%';
      return this.sql.exec(`SELECT ${cols} FROM lezioni WHERE titolo LIKE ? OR materia LIKE ? OR testo LIKE ? OR appunti LIKE ? ORDER BY data DESC, creata DESC`, like, like, like, like).toArray();
    }
    return this.sql.exec(`SELECT ${cols} FROM lezioni ORDER BY data DESC, creata DESC`).toArray();
  }
  leggi(id) { return this.sql.exec('SELECT * FROM lezioni WHERE id = ?', id).toArray()[0] || null; }
  salva(l) {
    const now = Date.now(), id = l.id || crypto.randomUUID(), old = this.leggi(id);
    this.sql.exec(`INSERT INTO lezioni (id, materia, titolo, data, durata, testo, appunti, creata, aggiornata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET materia = excluded.materia, titolo = excluded.titolo, data = excluded.data,
        durata = excluded.durata, testo = excluded.testo, appunti = excluded.appunti, aggiornata = excluded.aggiornata`,
      id, l.materia, l.titolo, l.data, l.durata || 0, l.testo, l.appunti || '', old ? old.creata : now, now);
    return this.leggi(id);
  }
  elimina(id) { this.sql.exec('DELETE FROM lezioni WHERE id = ?', id); return { ok: true }; }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
function stessaPassword(a, b) {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
const autorizzato = (request, env) => stessaPassword(request.headers.get('x-chiave'), env.PASSWORD);
function secondiAudio(request) {
  const len = Number(request.headers.get('content-length')) || 0;
  const type = request.headers.get('content-type') || '';
  const sec = type.includes('mpeg') ? len * 8 / 32000 : Math.max(0, len - 44) / 32000;
  return Math.max(10, sec);   // Groq conta almeno 10 secondi per richiesta
}
const oggi = () => new Date().toISOString().slice(0, 10);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const store = () => env.STORE.get(env.STORE.idFromName('principale'));

    if (url.pathname === '/api/stato') return json(200, { groq: Boolean(env.GROQ_API_KEY), password: Boolean(env.PASSWORD) });

    if (url.pathname === '/api/trascrivi') {
      if (request.method === 'POST') {
        if (!autorizzato(request, env)) return json(401, { error: 'Password mancante o errata.' });
        if (env.GROQ_API_KEY) await store().usa(secondiAudio(request));
      }
      return trascrivi({ request, env });
    }

    if (url.pathname.startsWith('/api/privato/')) {
      if (!env.PASSWORD) return json(503, { error: 'Password non impostata.', code: 'no-password' });
      if (!autorizzato(request, env)) return json(401, { error: 'Password errata.' });
      const azione = url.pathname.slice('/api/privato/'.length);
      if (azione === 'verifica') return json(200, { ok: true, uso: await store().usoOggi(), limitePubblicoOre: null, limiteGroq: { orePerGiorno: 8, orePerOra: 2 } });
      if (azione === 'lezioni') {
        if (request.method === 'GET') {
          const id = url.searchParams.get('id');
          if (id) { const l = await store().leggi(id); return l ? json(200, l) : json(404, { error: 'Lezione non trovata.' }); }
          return json(200, await store().elenco((url.searchParams.get('q') || '').trim().slice(0, 100)));
        }
        if (request.method === 'POST') {
          const b = await request.json().catch(() => null);
          if (!b || typeof b.testo !== 'string' || !b.testo.trim()) return json(400, { error: 'Testo mancante.' });
          return json(200, await store().salva({
            id: typeof b.id === 'string' ? b.id.slice(0, 64) : undefined,
            materia: String(b.materia || 'Senza materia').trim().slice(0, 80) || 'Senza materia',
            titolo: String(b.titolo || 'Lezione').trim().slice(0, 160) || 'Lezione',
            data: /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : oggi(),
            durata: Number(b.durata) || 0,
            testo: b.testo.slice(0, 1_500_000),
            appunti: String(b.appunti || '').slice(0, 1_500_000),
          }));
        }
        if (request.method === 'DELETE') {
          const id = url.searchParams.get('id');
          return id ? json(200, await store().elimina(id)) : json(400, { error: 'Manca la lezione da eliminare.' });
        }
      }
      return json(404, { error: 'Richiesta sconosciuta.' });
    }

    if (url.pathname === '/privato' || url.pathname === '/privato/') return Response.redirect(new URL('/', url), 302);
    return env.ASSETS.fetch(request);
  },
};
