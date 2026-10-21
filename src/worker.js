// Freetrascrizioni — Cloudflare Worker
// - serve l'app (cartella public/)
// - /api/stato: dice se chiave Groq e password sono impostate (per la schermata di primo avvio)
// - /api/trascrivi: trascrizione online con Groq, solo con la password giusta
// - /api/privato/*: verifica password, ore usate oggi e archivio delle lezioni
// Segreti da impostare su Cloudflare: GROQ_API_KEY e PASSWORD.
import { DurableObject } from 'cloudflare:workers';
import { onRequest as trascrivi } from './trascrivi.js';
import { generaFlashcard } from './flashcard.js';
import { generaTesto, leggiLavagna, rispondi, estraiGlossario, domandaOrale, valutaOrale, creaMappa, indovinaLezione } from './ai.js';
import { creaChiaviVapid, inviaPush, chiaveValida } from './push.js';
import { privacy, condizioni, paginaCondivisa } from './legale.js';
import { hashPassword, verificaPassword, sha, nuovoToken, nuovoId, leggiCookie, cookie, emailValida, googleInizio, googleFine } from './auth.js';

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS uso (giorno TEXT, chi TEXT, secondi REAL NOT NULL, PRIMARY KEY (giorno, chi))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lezioni (
      id TEXT PRIMARY KEY, materia TEXT NOT NULL, titolo TEXT NOT NULL, data TEXT NOT NULL,
      durata REAL, testo TEXT NOT NULL, appunti TEXT NOT NULL DEFAULT '', creata INTEGER, aggiornata INTEGER)`);
    // versione 1.3: flashcard salvate con la lezione (JSON)
    try { this.sql.exec(`ALTER TABLE lezioni ADD COLUMN flashcard TEXT NOT NULL DEFAULT ''`); } catch (_) {}
    // versione 1.5: statistiche per flashcard e storico dei ripassi
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fc_stat (chiave TEXT PRIMARY KEY, materia TEXT, giuste INTEGER NOT NULL DEFAULT 0, sbagliate INTEGER NOT NULL DEFAULT 0, ultima INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS profilo (k TEXT PRIMARY KEY, v TEXT)`);
    // versione 1.9: glossario per materia, esami e ripassi delle lezioni
    this.sql.exec(`CREATE TABLE IF NOT EXISTS glossario (chiave TEXT PRIMARY KEY, materia TEXT, termine TEXT, definizione TEXT, lezione TEXT, lezione_titolo TEXT, lezione_data TEXT, creato INTEGER, aggiornato INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS esami (id TEXT PRIMARY KEY, materia TEXT, nome TEXT, data TEXT, creato INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ripassi (lezione TEXT, quando INTEGER)`);
    // versione 3.0: slide/PDF e mappa per lezione, orale, studio, promemoria, condivisione
    for (const c of ["materiale TEXT NOT NULL DEFAULT ''", "mappa TEXT NOT NULL DEFAULT ''", "condiviso TEXT", "glo_len INTEGER"]) { try { this.sql.exec(`ALTER TABLE lezioni ADD COLUMN ${c}`); } catch (_) {} }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orale (quando INTEGER, materia TEXT, voto INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS studio (quando INTEGER, minuti REAL, materia TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS impostazioni (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, dati TEXT, ora INTEGER, creato INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push_utenti (utente TEXT PRIMARY KEY, ora INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS condivisi (token TEXT PRIMARY KEY, utente TEXT, lezione TEXT, creato INTEGER)`);
    // versione 1.7 (app pubblica): utenti e sessioni, usati solo dall'archivio "auth"
    this.sql.exec(`CREATE TABLE IF NOT EXISTS utenti (id TEXT PRIMARY KEY, email TEXT UNIQUE, nome TEXT, sale TEXT, hash TEXT, google TEXT, creato INTEGER, ultimo INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessioni (token TEXT PRIMARY KEY, utente TEXT, scade INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tentativi (email TEXT, quando INTEGER)`);
    // versione 1.8: limite ore per utente, blocco, accettazione di privacy e condizioni
    for (const c of ['ore_limite REAL', 'bloccato INTEGER NOT NULL DEFAULT 0', 'accettato INTEGER']) { try { this.sql.exec(`ALTER TABLE utenti ADD COLUMN ${c}`); } catch (_) {} }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fc_sessioni (id INTEGER PRIMARY KEY AUTOINCREMENT, quando INTEGER, materia TEXT, lezione TEXT, giuste INTEGER, totale INTEGER)`);
  }
  // ---------- utenti e sessioni (solo nell'archivio "auth") ----------
  utentePerEmail(email) { return this.sql.exec('SELECT * FROM utenti WHERE email = ?', email).toArray()[0] || null; }
  utentePerGoogle(sub) { return this.sql.exec('SELECT * FROM utenti WHERE google = ?', sub).toArray()[0] || null; }
  creaUtente(u) {
    this.sql.exec('INSERT INTO utenti (id, email, nome, sale, hash, google, creato, ultimo, accettato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      u.id, u.email, u.nome || '', u.sale || null, u.hash || null, u.google || null, Date.now(), Date.now(), u.accettato || null);
    return this.utentePerEmail(u.email);
  }
  elencoUtenti() {
    return this.sql.exec(`SELECT id, email, nome, creato, ultimo, google IS NOT NULL AS conGoogle, hash IS NOT NULL AS conPassword,
      ore_limite AS oreLimite, bloccato FROM utenti ORDER BY creato DESC`).toArray();
  }
  aggiornaUtente(id, { oreLimite, bloccato }) {
    this.sql.exec('UPDATE utenti SET ore_limite = ?, bloccato = ? WHERE id = ?', oreLimite, bloccato ? 1 : 0, id);
    if (bloccato) this.sql.exec('DELETE FROM sessioni WHERE utente = ?', id);
    return { ok: true };
  }
  // riepilogo d'uso di un utente (chiamato sull'archivio di quell'utente)
  riepilogo() {
    const l = this.sql.exec(`SELECT count(*) AS n, coalesce(sum(durata), 0) AS secondi FROM lezioni`).toArray()[0] || {};
    return { settimana: this.usoSettimana(), tokenOggi: this.usoOggi().flashcardToken, lezioni: l.n || 0, secondiLezioni: l.secondi || 0 };
  }
  esporta() {
    return { profilo: this.profilo().profilo, lezioni: this.sql.exec('SELECT materia, titolo, data, durata, testo, appunti, flashcard, materiale, mappa, creata, aggiornata FROM lezioni ORDER BY data').toArray() };
  }
  utentePerId(id) { return this.sql.exec('SELECT * FROM utenti WHERE id = ?', id).toArray()[0] || null; }
  cambiaPassword(id, sale, hash) { this.sql.exec('UPDATE utenti SET sale = ?, hash = ? WHERE id = ?', sale, hash, id); }
  collegaGoogle(id, sub) { this.sql.exec('UPDATE utenti SET google = ? WHERE id = ?', sub, id); }
  creaSessione(token, utente, giorni) {
    this.sql.exec('DELETE FROM sessioni WHERE scade < ?', Date.now());
    this.sql.exec('INSERT INTO sessioni (token, utente, scade) VALUES (?, ?, ?)', token, utente, Date.now() + giorni * 86400000);
  }
  sessione(token) {
    const r = this.sql.exec(`SELECT u.id, u.email, u.nome, u.google IS NOT NULL AS conGoogle, u.hash IS NOT NULL AS conPassword, u.ore_limite AS oreLimite, u.bloccato, s.scade
      FROM sessioni s JOIN utenti u ON u.id = s.utente WHERE s.token = ?`, token).toArray()[0];
    if (!r || r.scade < Date.now() || r.bloccato) return null;
    this.sql.exec('UPDATE utenti SET ultimo = ? WHERE id = ?', Date.now(), r.id);
    return r;
  }
  chiudiSessione(token) { this.sql.exec('DELETE FROM sessioni WHERE token = ?', token); }
  eliminaUtente(id) {
    for (const q of ['DELETE FROM sessioni WHERE utente = ?', 'DELETE FROM condivisi WHERE utente = ?', 'DELETE FROM push_utenti WHERE utente = ?', 'DELETE FROM utenti WHERE id = ?']) this.sql.exec(q, id);
    return { ok: true };
  }
  // massimo 10 tentativi sbagliati ogni 15 minuti per email
  troppiTentativi(email) {
    this.sql.exec('DELETE FROM tentativi WHERE quando < ?', Date.now() - 15 * 60000);
    return (this.sql.exec('SELECT count(*) AS n FROM tentativi WHERE email = ?', email).toArray()[0] || {}).n >= 10;
  }
  tentativoSbagliato(email) { this.sql.exec('INSERT INTO tentativi (email, quando) VALUES (?, ?)', email, Date.now()); }
  usoSettimana() {
    const da = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    return (this.sql.exec(`SELECT coalesce(sum(secondi), 0) AS s FROM uso WHERE chi = 'privato' AND giorno >= ? AND giorno <= '9999' AND giorno NOT LIKE 'ora:%'`, da).toArray()[0] || {}).s || 0;
  }
  // ---------- glossario ----------
  terminiMateria(materia) { return this.sql.exec('SELECT termine FROM glossario WHERE materia = ? ORDER BY termine', materia).toArray().map(r => r.termine); }
  glossario(materia) {
    return materia
      ? this.sql.exec('SELECT * FROM glossario WHERE materia = ? ORDER BY termine COLLATE NOCASE', materia).toArray()
      : this.sql.exec('SELECT materia, count(*) AS n, max(creato) AS ultimo FROM glossario GROUP BY materia ORDER BY materia').toArray();
  }
  salvaTermini(materia, lezione, termini) {
    const now = Date.now(); let nuovi = 0, aggiornati = 0;
    for (const t of termini) {
      const chiave = materia + '|' + t.termine.toLowerCase();
      const c = this.sql.exec('SELECT chiave FROM glossario WHERE chiave = ?', chiave).toArray()[0];
      if (c) { this.sql.exec('UPDATE glossario SET definizione = ?, aggiornato = ? WHERE chiave = ?', t.definizione, now, chiave); aggiornati++; }
      else {
        this.sql.exec('INSERT INTO glossario (chiave, materia, termine, definizione, lezione, lezione_titolo, lezione_data, creato, aggiornato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          chiave, materia, t.termine, t.definizione, lezione.id, lezione.titolo, lezione.data, now, now);
        nuovi++;
      }
    }
    return { nuovi, aggiornati };
  }
  materieUsate() { return this.sql.exec('SELECT materia, count(*) AS n FROM lezioni GROUP BY materia ORDER BY n DESC').toArray().map(r => r.materia).filter(m => m && m !== 'Senza materia'); }
  segnaGlossario(id, n) { this.sql.exec('UPDATE lezioni SET glo_len = ? WHERE id = ?', n, id); }
  eliminaTermine(chiave) { this.sql.exec('DELETE FROM glossario WHERE chiave = ?', chiave); return { ok: true }; }
  // ---------- esami e piano di ripasso ----------
  esami() { return this.sql.exec('SELECT * FROM esami ORDER BY data').toArray(); }
  salvaEsame(e) {
    const id = e.id || crypto.randomUUID();
    this.sql.exec(`INSERT INTO esami (id, materia, nome, data, creato) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET materia = excluded.materia, nome = excluded.nome, data = excluded.data`, id, e.materia, e.nome || '', e.data, Date.now());
    return this.esami();
  }
  eliminaEsame(id) { this.sql.exec('DELETE FROM esami WHERE id = ?', id); return this.esami(); }
  segnaRipasso(lezione) { this.sql.exec('INSERT INTO ripassi (lezione, quando) VALUES (?, ?)', lezione, Date.now()); return { ok: true }; }
  // Piano a regole: ogni giorno una quota delle lezioni non ripassate di recente, le più vecchie prima;
  // negli ultimi 2 giorni ripasso finale con le flashcard di tutta la materia.
  oggi(oggiISO) {
    const inizioOggi = new Date(oggiISO + 'T00:00:00Z').getTime() - 2 * 3600000; // circa mezzanotte italiana
    const out = [];
    for (const e of this.esami()) {
      const giorni = Math.round((new Date(e.data + 'T12:00:00Z') - new Date(oggiISO + 'T12:00:00Z')) / 86400000);
      if (giorni < 0) continue;
      const lezioni = this.sql.exec(`SELECT l.id, l.titolo, l.data, length(l.flashcard) > 2 AS conFlashcard,
          (SELECT max(quando) FROM ripassi r WHERE r.lezione = l.id) AS ultimo,
          (SELECT max(quando) FROM fc_sessioni s WHERE s.lezione = l.id) AS ultimoQuiz
        FROM lezioni l WHERE l.materia = ? ORDER BY l.data ASC, l.creata ASC`, e.materia).toArray()
        .map(l => ({ ...l, ripassata: Math.max(l.ultimo || 0, l.ultimoQuiz || 0) }));
      const fatteOggi = lezioni.filter(l => l.ripassata >= inizioOggi);
      const recenti = Date.now() - 6 * 86400000;
      const daFare = lezioni.filter(l => l.ripassata < recenti);
      const finale = giorni <= 2;
      const quota = finale ? 0 : Math.max(1, Math.ceil((daFare.length + fatteOggi.length) / Math.max(1, giorni - 2)));
      const prossime = daFare.slice(0, Math.max(0, quota - fatteOggi.length));
      const deboli = (this.sql.exec(`SELECT count(*) AS n FROM fc_stat WHERE materia = ? AND sbagliate > giuste`, e.materia).toArray()[0] || {}).n || 0;
      out.push({ esame: e, giorni, finale, quota, lezioni: [...fatteOggi.map(l => ({ ...l, fatta: true })), ...prossime.map(l => ({ ...l, fatta: false }))],
        totaleLezioni: lezioni.length, daRipassare: daFare.length, deboli });
    }
    return out;
  }
  // ---------- slide/PDF, mappa, orale, studio ----------
  salvaMateriale(id, nome, testo) {
    const l = this.leggi(id); if (!l) return null;
    const nuovo = ((l.materiale || '') + `\n\n=== ${nome} ===\n` + testo).trim().slice(0, 400000);
    this.sql.exec('UPDATE lezioni SET materiale = ?, aggiornata = ? WHERE id = ?', nuovo, Date.now(), id);
    return { ok: true, caratteri: nuovo.length };
  }
  togliMateriale(id) { this.sql.exec(`UPDATE lezioni SET materiale = '' WHERE id = ?`, id); return { ok: true }; }
  salvaMappa(id, mappa) { this.sql.exec('UPDATE lezioni SET mappa = ? WHERE id = ?', JSON.stringify(mappa), id); return { ok: true }; }
  lezioneCasuale(materia) {
    return this.sql.exec(`SELECT id, titolo, data, appunti, testo, materiale FROM lezioni WHERE materia = ? AND length(testo) > 300 ORDER BY random() LIMIT 1`, materia).toArray()[0] || null;
  }
  registraOrale(materia, voto) { this.sql.exec('INSERT INTO orale (quando, materia, voto) VALUES (?, ?, ?)', Date.now(), materia, voto); }
  registraStudio(minuti, materia) { this.sql.exec('INSERT INTO studio (quando, minuti, materia) VALUES (?, ?, ?)', Date.now(), minuti, materia || ''); return { ok: true }; }
  // Serie di giorni di studio (ripassi, quiz, orale, timer ≥10 min), in ora italiana.
  // Salva-serie: ogni 7 giorni di studio se ne guadagna uno (max 2); un giorno saltato ne consuma
  // uno invece di azzerare la serie. Tutto è ricalcolato dallo storico: niente stato da tenere.
  serie() {
    const giorno = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const piu = (g, n) => new Date(new Date(g + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
    const att = new Map();
    const add = (t, k, n = 1) => { const g = giorno(t); const a = att.get(g) || { quiz: 0, ripassi: 0, orali: 0, minuti: 0 }; a[k] += n; att.set(g, a); };
    for (const r of this.sql.exec('SELECT quando FROM fc_sessioni').toArray()) add(r.quando, 'quiz');
    for (const r of this.sql.exec('SELECT quando FROM ripassi').toArray()) add(r.quando, 'ripassi');
    for (const r of this.sql.exec('SELECT quando FROM orale').toArray()) add(r.quando, 'orali');
    for (const r of this.sql.exec('SELECT quando, minuti FROM studio').toArray()) add(r.quando, 'minuti', Number(r.minuti) || 0);
    const fatto = g => { const a = att.get(g); return !!a && (a.quiz > 0 || a.ripassi > 0 || a.orali > 0 || a.minuti >= 10); };
    const oggi = giorno(Date.now());
    const fatti = [...att.keys()].filter(fatto).sort();
    const MAX_SALVA = 2;
    let serie = 0, record = 0, salva = 0, verso = 0, usati = 0;
    const congelati = new Set();
    if (fatti.length) for (let g = fatti[0]; g <= oggi; g = piu(g, 1)) {
      if (fatto(g)) {
        serie++; verso++; record = Math.max(record, serie);
        if (verso >= 7) { verso = 0; salva = Math.min(MAX_SALVA, salva + 1); }
      } else if (g === oggi) {
        // oggi non è ancora finito
      } else if (serie > 0 && salva > 0) { salva--; usati++; congelati.add(g); }
      else { serie = 0; verso = 0; }
    }
    const dow = (new Date(oggi + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const lunedi = piu(oggi, -dow);
    const settimana = Array.from({ length: 7 }, (_, k) => {
      const g = piu(lunedi, k), a = att.get(g) || { quiz: 0, ripassi: 0, orali: 0, minuti: 0 };
      const stato = fatto(g) ? 'fatto' : congelati.has(g) ? 'congelato' : g > oggi ? 'futuro' : g === oggi ? 'oggi' : 'mancato';
      return { g, stato, oggi: g === oggi, quiz: a.quiz, ripassi: a.ripassi, orali: a.orali, minuti: Math.round(a.minuti) };
    });
    const minutiOggi = Math.round((att.get(oggi) || {}).minuti || 0);
    const orali = this.sql.exec('SELECT quando, materia, voto FROM orale ORDER BY quando DESC LIMIT 10').toArray();
    // traguardi
    const uno = q => this.sql.exec(q).toArray()[0] || {};
    const giuste = uno('SELECT coalesce(sum(giuste), 0) AS n FROM fc_sessioni').n || 0;
    const minutiTot = uno('SELECT coalesce(sum(minuti), 0) AS n FROM studio').n || 0;
    const nOrali = uno('SELECT count(*) AS n FROM orale').n || 0;
    const maxVoto = uno('SELECT coalesce(max(voto), 0) AS n FROM orale').n || 0;
    const nLezioni = uno('SELECT count(*) AS n FROM lezioni').n || 0;
    const nTermini = uno('SELECT count(*) AS n FROM glossario').n || 0;
    const T = (id, icona, nome, desc, val, max) => ({ id, icona, nome, desc, val: Math.min(Math.round(val), max), max, fatto: val >= max });
    const traguardi = [
      T('serie3', '🔥', 'Si parte', '3 giorni di fila', record, 3),
      T('serie7', '🔥', 'Una settimana', '7 giorni di fila', record, 7),
      T('serie30', '🔥', 'Un mese intero', '30 giorni di fila', record, 30),
      T('serie100', '🏆', 'Leggenda', '100 giorni di fila', record, 100),
      T('lezioni10', '📚', 'Archivio pieno', '10 lezioni salvate', nLezioni, 10),
      T('giuste100', '✅', 'Cento giuste', '100 risposte giuste alle flashcard', giuste, 100),
      T('ore10', '⏱️', 'Dieci ore', '10 ore con il timer di studio', minutiTot / 60, 10),
      T('orale1', '🎤', 'Prima interrogazione', 'Fai un’interrogazione', nOrali, 1),
      T('trenta', '🎓', 'Da trenta', 'Prendi 30 a un’interrogazione', maxVoto >= 30 ? 1 : 0, 1),
      T('glossario50', '📖', 'Vocabolario', '50 termini nel glossario', nTermini, 50),
      T('salva1', '❄️', 'Salvato in extremis', 'Un salva-serie ti ha salvato la serie', usati, 1),
    ];
    return { serie, record, oggiFatto: fatto(oggi), giorniTotali: fatti.length, minutiOggi, orali,
      salva, maxSalva: MAX_SALVA, prossimoSalva: salva >= MAX_SALVA ? 0 : 7 - verso, settimana, traguardi };
  }
  // ---------- impostazioni, promemoria, condivisione ----------
  impostazione(k) { return (this.sql.exec('SELECT v FROM impostazioni WHERE k = ?', k).toArray()[0] || {}).v || null; }
  setImpostazione(k, v) { this.sql.exec('INSERT INTO impostazioni (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v); }
  iscriviPush(sub, ora) {
    this.sql.exec('INSERT INTO push (endpoint, dati, ora, creato) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET dati = excluded.dati, ora = excluded.ora', sub.endpoint, JSON.stringify(sub), ora, Date.now());
    return this.statoPush();
  }
  disiscriviPush(endpoint) { this.sql.exec('DELETE FROM push WHERE endpoint = ?', endpoint); return this.statoPush(); }
  iscrizioni(ora) { return (ora == null ? this.sql.exec('SELECT dati FROM push') : this.sql.exec('SELECT dati FROM push WHERE ora = ?', ora)).toArray().map(r => JSON.parse(r.dati)); }
  statoPush() { const r = this.sql.exec('SELECT count(*) AS n, min(ora) AS ora FROM push').toArray()[0] || {}; return { attive: r.n || 0, ora: r.ora }; }
  segnaUtentePush(utente, ora) {
    if (ora == null) this.sql.exec('DELETE FROM push_utenti WHERE utente = ?', utente);
    else this.sql.exec('INSERT INTO push_utenti (utente, ora) VALUES (?, ?) ON CONFLICT (utente) DO UPDATE SET ora = excluded.ora', utente, ora);
  }
  utentiPush(ora) { return this.sql.exec('SELECT utente FROM push_utenti WHERE ora = ?', ora).toArray().map(r => r.utente); }
  daRipassareOggi() {
    const oggiISO = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    return this.oggi(oggiISO).reduce((n, p) => n + (p.finale ? 1 : p.lezioni.filter(l => !l.fatta).length), 0);
  }
  creaCondivisione(token, utente, lezione) { this.sql.exec('INSERT INTO condivisi (token, utente, lezione, creato) VALUES (?, ?, ?, ?)', token, utente, lezione, Date.now()); }
  condivisione(token) { return this.sql.exec('SELECT * FROM condivisi WHERE token = ?', token).toArray()[0] || null; }
  revocaCondivisione(token) { this.sql.exec('DELETE FROM condivisi WHERE token = ?', token); }
  segnaCondiviso(id, token) { this.sql.exec('UPDATE lezioni SET condiviso = ? WHERE id = ?', token, id); }
  profilo() {
    let p = {}; try { p = JSON.parse((this.sql.exec(`SELECT v FROM profilo WHERE k = 'profilo'`).toArray()[0] || {}).v || '{}'); } catch (_) {}
    const st = this.sql.exec(`SELECT count(*) AS lezioni, coalesce(sum(durata), 0) AS secondi, count(DISTINCT materia) AS materie,
      sum(length(flashcard) > 2) AS conFlashcard, sum(length(appunti) > 0) AS conAppunti FROM lezioni`).toArray()[0] || {};
    return { profilo: p, stats: st };
  }
  salvaProfilo(p) {
    this.sql.exec(`INSERT INTO profilo (k, v) VALUES ('profilo', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, JSON.stringify(p));
    return this.profilo();
  }
  eliminaTutto() {
    for (const t of ['lezioni', 'fc_stat', 'fc_sessioni', 'profilo', 'glossario', 'esami', 'ripassi', 'orale', 'studio', 'push']) this.sql.exec(`DELETE FROM ${t}`);
    return { ok: true };
  }
  flashcardMateria(materia) {
    const righe = this.sql.exec(`SELECT id, titolo, data, flashcard FROM lezioni WHERE materia = ? AND length(flashcard) > 2 ORDER BY data ASC`, materia).toArray();
    const out = [];
    for (const r of righe) {
      let carte = []; try { carte = JSON.parse(r.flashcard); } catch (_) {}
      for (const c of carte) {
        const st = this.sql.exec('SELECT giuste, sbagliate, ultima FROM fc_stat WHERE chiave = ?', chiaveCarta(c.domanda)).toArray()[0] || {};
        out.push({ ...c, lezione: r.id, lezioneTitolo: r.titolo, lezioneData: r.data, giuste: st.giuste || 0, sbagliate: st.sbagliate || 0, ultima: st.ultima || 0 });
      }
    }
    return out;
  }
  registraQuiz({ materia, lezione, risultati }) {
    const now = Date.now();
    let giuste = 0;
    for (const r of risultati) {
      const ok = r.ok ? 1 : 0; giuste += ok;
      this.sql.exec(`INSERT INTO fc_stat (chiave, materia, giuste, sbagliate, ultima) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (chiave) DO UPDATE SET giuste = giuste + excluded.giuste, sbagliate = sbagliate + excluded.sbagliate, ultima = excluded.ultima`,
        chiaveCarta(r.domanda), materia, ok, 1 - ok, now);
    }
    this.sql.exec('INSERT INTO fc_sessioni (quando, materia, lezione, giuste, totale) VALUES (?, ?, ?, ?, ?)', now, materia, lezione || '', giuste, risultati.length);
    return this.storico(materia, lezione);
  }
  storico(materia, lezione) {
    return lezione
      ? this.sql.exec('SELECT quando, giuste, totale FROM fc_sessioni WHERE lezione = ? ORDER BY quando DESC LIMIT 8', lezione).toArray().reverse()
      : this.sql.exec(`SELECT quando, giuste, totale FROM fc_sessioni WHERE materia = ? AND lezione = '' ORDER BY quando DESC LIMIT 8`, materia).toArray().reverse();
  }
  // Ricerca semplice per parole chiave: divide lezioni e appunti in brani e tiene i più pertinenti
  cerca(materia, parole, max = 16000) {
    const righe = materia
      ? this.sql.exec('SELECT titolo, materia, data, testo, appunti, materiale FROM lezioni WHERE materia = ?', materia).toArray()
      : this.sql.exec('SELECT titolo, materia, data, testo, appunti, materiale FROM lezioni').toArray();
    const brani = [];
    for (const r of righe) {
      for (const [tipo, testo, bonus] of [['appunti', r.appunti, 1.3], ['slide', r.materiale, 1.15], ['trascrizione', r.testo, 1]]) {
        if (!testo) continue;
        const t = testo.replace(/\s+/g, ' ');
        for (let i = 0; i < t.length; i += 1300) {
          const pezzo = t.slice(Math.max(0, i - 150), i + 1500), low = pezzo.toLowerCase();
          let score = 0, diverse = 0;
          for (const w of parole) { const n = low.split(w).length - 1; if (n) { diverse++; score += Math.min(n, 5); } }
          if (diverse) brani.push({ titolo: r.titolo, materia: r.materia, data: r.data, tipo, testo: pezzo, score: (score + diverse * 3) * bonus });
        }
      }
    }
    brani.sort((a, b) => b.score - a.score);
    const scelti = []; let tot = 0;
    for (const b of brani) { if (tot + b.testo.length > max) break; scelti.push(b); tot += b.testo.length; if (scelti.length >= 10) break; }
    return scelti.map(({ score, ...b }) => b);
  }
  usa(secondi) {
    const add = (g) => this.sql.exec(`INSERT INTO uso (giorno, chi, secondi) VALUES (?, 'privato', ?)
      ON CONFLICT (giorno, chi) DO UPDATE SET secondi = secondi + excluded.secondi`, g, secondi);
    add(new Date().toISOString().slice(0, 10));
    add('ora:' + new Date().toISOString().slice(0, 13));
  }
  usaToken(n) {
    this.sql.exec(`INSERT INTO uso (giorno, chi, secondi) VALUES (?, 'flashcard', ?)
      ON CONFLICT (giorno, chi) DO UPDATE SET secondi = secondi + excluded.secondi`, 'fc:' + new Date().toISOString().slice(0, 10), n);
  }
  usoOggi() {
    const get = (g) => (this.sql.exec('SELECT secondi FROM uso WHERE giorno = ?', g).toArray()[0] || {}).secondi || 0;
    return { privato: get(new Date().toISOString().slice(0, 10)), pubblico: 0, oraCorrente: get('ora:' + new Date().toISOString().slice(0, 13)), flashcardToken: get('fc:' + new Date().toISOString().slice(0, 10)) };
  }
  elenco(q) {
    const cols = 'id, materia, titolo, data, durata, creata, aggiornata, length(testo) AS caratteri, length(appunti) > 0 AS conAppunti, length(flashcard) > 2 AS conFlashcard';
    if (q) {
      const like = '%' + q.replace(/[%_]/g, '') + '%';
      return this.sql.exec(`SELECT ${cols} FROM lezioni WHERE titolo LIKE ? OR materia LIKE ? OR testo LIKE ? OR appunti LIKE ? ORDER BY data DESC, creata DESC`, like, like, like, like).toArray();
    }
    return this.sql.exec(`SELECT ${cols} FROM lezioni ORDER BY data DESC, creata DESC`).toArray();
  }
  appuntiMateria(materia) {
    return this.sql.exec(`SELECT id, titolo, data, appunti FROM lezioni WHERE materia = ? AND length(appunti) > 0
      ORDER BY data ASC, creata ASC`, materia).toArray();
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
  salvaFlashcard(id, carte) {
    if (!this.leggi(id)) return null;
    this.sql.exec('UPDATE lezioni SET flashcard = ?, aggiornata = ? WHERE id = ?', carte, Date.now(), id);
    return { ok: true };
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
const chiaveCarta = d => String(d || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
const VUOTE = new Set('della delle degli dello nella nelle negli sulla sulle come cosa sono quale quali quando dove perché perche anche questo questa questi queste quello quella hanno essere stato stata fatto fare detto ancora sempre molto tutti tutte ogni prof professore lezione lezioni spiegato spiega spiegami ha detto dice'.split(' '));
const paroleChiave = q => [...new Set(String(q).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !VUOTE.has(w)).map(w => w.length > 6 ? w.slice(0, w.length - 2) : w))].slice(0, 12);
const oggi = () => new Date().toISOString().slice(0, 10);


// ---------- Registrazione, accesso, Google (solo app pubblica) ----------
const GIORNI_SESSIONE = 60;
async function conSessione(auth, idUtente, corpo, dove) {
  const token = nuovoToken();
  await auth().creaSessione(await sha(token), idUtente, GIORNI_SESSIONE);
  const h = new Headers({ 'set-cookie': cookie('sessione', token, GIORNI_SESSIONE * 86400), 'cache-control': 'no-store' });
  if (dove) { h.set('location', dove); h.append('set-cookie', cookie('g_stato', '', 0)); return new Response(null, { status: 302, headers: h }); }
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(corpo), { status: 200, headers: h });
}
const invitoOk = (env, codice) => !env.CODICE_INVITO || String(codice || '').trim().toLowerCase() === String(env.CODICE_INVITO).trim().toLowerCase();

async function gestisciAuth(request, env, url, auth, utente) {
  const p = url.pathname;
  if (p === '/auth/google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response('Accesso con Google non configurato.', { status: 503 });
    return googleInizio(env, url, url.searchParams.get('invito') || '');
  }
  if (p === '/auth/google/callback') {
    const torna = msg => Response.redirect(url.origin + '/?errore=' + encodeURIComponent(msg), 302);
    const g = await googleFine(env, url, request);
    if (g.errore) return torna(g.errore);
    let u = await auth().utentePerGoogle(g.sub);
    if (!u && g.email && g.verificata) {
      u = await auth().utentePerEmail(g.email);
      if (u) await auth().collegaGoogle(u.id, g.sub);
    }
    if (!u) {
      if (!invitoOk(env, g.invito)) return torna('Per registrarti serve il codice di invito: scrivilo e poi tocca di nuovo «Continua con Google».');
      if (!g.email) return torna('Google non ha condiviso la tua email.');
      u = await auth().creaUtente({ id: nuovoId(), email: g.email, nome: g.nome, google: g.sub, accettato: Date.now() });
    }
    if (u.bloccato) return torna('Questo account è sospeso. Scrivi all’amministratore.');
    return conSessione(auth, u.id, null, url.origin + '/');
  }
  if (request.method !== 'POST') return json(405, { error: 'Usa POST.' });
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  if (p === '/api/auth/registrati') {
    if (!emailValida(email)) return json(400, { error: 'Email non valida.' });
    if (String(b.password || '').length < 8) return json(400, { error: 'La password deve avere almeno 8 caratteri.' });
    if (!invitoOk(env, b.invito)) return json(403, { error: 'Codice di invito non valido.', code: 'invito' });
    if (!b.accetto) return json(400, { error: 'Per registrarti accetta privacy e condizioni d’uso.', code: 'accetto' });
    if (await auth().utentePerEmail(email)) return json(409, { error: 'Esiste già un account con questa email: accedi.' });
    const { sale, hash } = await hashPassword(String(b.password));
    const u = await auth().creaUtente({ id: nuovoId(), email, nome: String(b.nome || '').trim().slice(0, 80), sale, hash, accettato: Date.now() });
    return conSessione(auth, u.id, { ok: true });
  }
  if (p === '/api/auth/accedi') {
    if (await auth().troppiTentativi(email)) return json(429, { error: 'Troppi tentativi: riprova tra 15 minuti.' });
    const u = email && await auth().utentePerEmail(email);
    if (u && u.bloccato) return json(403, { error: 'Questo account è sospeso. Scrivi all’amministratore.' });
    if (u && !u.hash) return json(400, { error: 'Questo account usa Google: tocca «Continua con Google».' });
    if (!u || !await verificaPassword(String(b.password || ''), u.sale, u.hash)) { await auth().tentativoSbagliato(email); return json(401, { error: 'Email o password errate.' }); }
    return conSessione(auth, u.id, { ok: true });
  }
  if (p === '/api/auth/password') {
    if (!utente) return json(401, { error: 'Accedi di nuovo.' });
    const u = await auth().utentePerId(utente.id);
    if (u.hash && !await verificaPassword(String(b.attuale || ''), u.sale, u.hash)) return json(401, { error: 'La password attuale non è corretta.' });
    if (String(b.nuova || '').length < 8) return json(400, { error: 'La nuova password deve avere almeno 8 caratteri.' });
    const { sale, hash } = await hashPassword(String(b.nuova));
    await auth().cambiaPassword(u.id, sale, hash);
    return json(200, { ok: true });
  }
  if (p === '/api/auth/esci') {
    const t = leggiCookie(request, 'sessione');
    if (t) await auth().chiudiSessione(await sha(t));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie('sessione', '', 0) } });
  }
  return json(404, { error: 'Richiesta sconosciuta.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const multi = env.MULTIUTENTE === 'si' || env.MULTIUTENTE === 'true';
    const auth = () => env.STORE.get(env.STORE.idFromName('auth'));
    let utente = null;
    if (multi && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) {
      const t = leggiCookie(request, 'sessione');
      if (t) utente = await auth().sessione(await sha(t));
    }
    const store = () => env.STORE.get(env.STORE.idFromName(utente ? 'u:' + utente.id : 'principale'));
    const entrato = multi ? !!utente : autorizzato(request, env);
    const oreSett = utente && utente.oreLimite != null ? utente.oreLimite : (Number(env.ORE_SETTIMANA_UTENTE) || 10);
    const admins = String(env.ADMIN_EMAIL || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
    const admin = !!(utente && admins.includes(utente.email));
    const tokenGiorno = Number(env.TOKEN_GIORNO_UTENTE) || 150000;
    const limiteAi = async () => multi && (await store().usoOggi()).flashcardToken >= tokenGiorno
      ? json(429, { error: 'Hai usato tutta l’intelligenza artificiale di oggi: riprova domani.', code: 'limite-ai' }) : null;

    // pagina pubblica, in sola lettura, degli appunti condivisi
    if (url.pathname.startsWith('/c/')) {
      const token = url.pathname.slice(3).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      const c = token ? await (multi ? auth() : env.STORE.get(env.STORE.idFromName('principale'))).condivisione(token) : null;
      const l = c ? await env.STORE.get(env.STORE.idFromName(multi ? 'u:' + c.utente : 'principale')).leggi(c.lezione) : null;
      const html = l && l.condiviso === token ? paginaCondivisa(l, multi ? url.origin : null) : paginaCondivisa(null, null);
      return new Response(html, { status: l ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-robots-tag': 'noindex' } });
    }
    if (url.pathname === '/privacy' || url.pathname === '/condizioni') {
      return new Response(url.pathname === '/privacy' ? privacy(env) : condizioni(env), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (url.pathname === '/api/stato') return json(200, {
      groq: Boolean(env.GROQ_API_KEY), password: multi || Boolean(env.PASSWORD), multiutente: multi,
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), invito: Boolean(env.CODICE_INVITO),
    });

    if (multi && (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/auth/'))) return gestisciAuth(request, env, url, auth, utente);

    if (url.pathname === '/api/trascrivi') {
      if (request.method === 'POST') {
        if (!entrato) return json(401, { error: multi ? 'Accedi per trascrivere.' : 'Password mancante o errata.' });
        if (multi && await store().usoSettimana() >= oreSett * 3600) return json(429, { error: `Hai usato le ${oreSett} ore di questa settimana.`, code: 'limite-utente' });
        if (env.GROQ_API_KEY) { const sec = secondiAudio(request); await store().usa(sec); if (multi) await auth().usa(sec); }
      }
      return trascrivi({ request, env });
    }

    if (url.pathname.startsWith('/api/privato/')) {
      if (!multi && !env.PASSWORD) return json(503, { error: 'Password non impostata.', code: 'no-password' });
      if (!entrato) return json(401, { error: multi ? 'Accedi di nuovo.' : 'Password errata.' });
      const azione = url.pathname.slice('/api/privato/'.length);
      if (['ai', 'flashcard', 'lavagna', 'chiedi', 'glossario-estrai', 'orale-domanda', 'orale-valuta', 'mappa', 'indovina'].includes(azione)) { const l = await limiteAi(); if (l) return l; }
      if (azione === 'verifica') return json(200, {
        ok: true, uso: multi ? { ...(await auth().usoOggi()), flashcardToken: (await store().usoOggi()).flashcardToken } : await store().usoOggi(), limitePubblicoOre: null,
        limiteGroq: { orePerGiorno: 8, orePerOra: 2, tokenFlashcardGiorno: multi ? tokenGiorno : 500000, tokenFlashcardMinuto: 30000 },
        utente: utente ? { email: utente.email, nome: utente.nome, conGoogle: !!utente.conGoogle, conPassword: !!utente.conPassword, admin } : null,
        settimana: multi ? { usate: await store().usoSettimana(), limite: oreSett * 3600, tokenOggi: (await store().usoOggi()).flashcardToken } : null,
      });
      // tutti gli appunti salvati di una materia, in ordine di data (per Claude e per "Scarica appunti")
      if (azione === 'appunti' && request.method === 'GET') {
        const materia = (url.searchParams.get('materia') || '').trim().slice(0, 80);
        return materia ? json(200, await store().appuntiMateria(materia)) : json(400, { error: 'Manca la materia.' });
      }
      // flashcard: "flashcard" le crea dal testo con Groq, "flashcard-salva" le salva nella lezione
      if (azione === 'flashcard' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || typeof b.testo !== 'string' || b.testo.trim().length < 200) return json(400, { error: 'Il testo è troppo corto per creare flashcard.' });
        const r = await generaFlashcard(env, { testo: b.testo.slice(0, 1_500_000), materia: String(b.materia || '').slice(0, 80), quante: b.quante });
        if (r.token) await store().usaToken(r.token);
        if (r.status === 200) r.body.uso = await store().usoOggi();
        return json(r.status, r.body);
      }
      // appunti / trascrizione corretta creati nell'app, una parte della lezione per richiesta
      if (azione === 'ai' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || typeof b.testo !== 'string' || !b.testo.trim()) return json(400, { error: 'Testo mancante.' });
        const r = await generaTesto(env, {
          tipo: b.tipo === 'aggiusta' ? 'aggiusta' : 'appunti', testo: b.testo.slice(0, 40000),
          materia: String(b.materia || '').slice(0, 80), data: String(b.data || '').slice(0, 40),
          parte: Number(b.parte) || 1, totale: Number(b.totale) || 1, lavagna: String(b.lavagna || '').slice(0, 8000), materiale: String(b.materiale || '').slice(0, 9000),
        });
        if (r.token) await store().usaToken(r.token);
        if (r.status === 200) r.body.uso = await store().usoOggi();
        return json(r.status, r.body);
      }
      // ---------- slide/PDF, mappa, orale, studio, serie ----------
      const corpo = async () => request.json().catch(() => null);
      const conToken = async (r) => { if (r.token) await store().usaToken(r.token); return r; };
      if (azione === 'materiale') {
        if (request.method === 'POST') {
          const b = await corpo();
          if (!b || typeof b.id !== 'string' || typeof b.testo !== 'string' || !b.testo.trim()) return json(400, { error: 'Nessun testo trovato nel file.' });
          const r = await store().salvaMateriale(b.id.slice(0, 64), String(b.nome || 'Materiale').slice(0, 120), b.testo.slice(0, 300000));
          return r ? json(200, r) : json(404, { error: 'Salva prima la lezione.' });
        }
        if (request.method === 'DELETE') return json(200, await store().togliMateriale(String(url.searchParams.get('id') || '').slice(0, 64)));
      }
      if (azione === 'indovina' && request.method === 'POST') {
        const b = await corpo();
        const testo = String(b?.testo || '').slice(0, 8000);
        if (testo.trim().length < 80) return json(400, { error: 'Testo troppo corto.' });
        const materie = await store().materieUsate();
        const r = await conToken(await indovinaLezione(env, { testo, materie }));
        return json(r.status, r.body);
      }
      if (azione === 'mappa' && request.method === 'POST') {
        const b = await corpo();
        const l = b && typeof b.id === 'string' ? await store().leggi(b.id.slice(0, 64)) : null;
        if (!l) return json(404, { error: 'Salva prima la lezione.' });
        const testo = [(l.appunti && l.appunti.length > 500 ? l.appunti : l.testo), l.materiale ? '\n\nSlide del professore:\n' + l.materiale.slice(0, 12000) : ''].join('');
        const r = await conToken(await creaMappa(env, { materia: l.materia, titolo: l.titolo, testo }));
        if (r.status === 200) await store().salvaMappa(l.id, r.body.mappa);
        return json(r.status, r.body);
      }
      if (azione === 'orale-domanda' && request.method === 'POST') {
        const b = await corpo();
        const materia = String(b?.materia || '').trim().slice(0, 80);
        const l = materia ? await store().lezioneCasuale(materia) : null;
        if (!l) return json(404, { error: 'Non ci sono lezioni salvate di questa materia.' });
        const testo = [(l.appunti && l.appunti.length > 500 ? l.appunti : l.testo), l.materiale ? '\n\n' + l.materiale.slice(0, 8000) : ''].join('');
        const r = await conToken(await domandaOrale(env, { materia, titolo: l.titolo, testo, gia: Array.isArray(b.gia) ? b.gia.map(String) : [] }));
        if (r.status === 200) r.body.lezione = { id: l.id, titolo: l.titolo, data: l.data };
        return json(r.status, r.body);
      }
      if (azione === 'orale-valuta' && request.method === 'POST') {
        const b = await corpo();
        const l = b && typeof b.lezione === 'string' ? await store().leggi(b.lezione.slice(0, 64)) : null;
        if (!l) return json(404, { error: 'Lezione non trovata.' });
        const testo = [(l.appunti && l.appunti.length > 500 ? l.appunti : l.testo), l.materiale ? '\n\n' + l.materiale.slice(0, 6000) : ''].join('');
        const r = await conToken(await valutaOrale(env, { materia: l.materia, titolo: l.titolo, testo, domanda: String(b.domanda || '').slice(0, 600),
          punti: Array.isArray(b.punti) ? b.punti.map(String).slice(0, 6) : [], risposta: String(b.risposta || '') }));
        if (r.status === 200) await store().registraOrale(l.materia, r.body.voto);
        return json(r.status, r.body);
      }
      if (azione === 'studio' && request.method === 'POST') {
        const b = await corpo();
        const minuti = Math.max(1, Math.min(180, Number(b?.minuti) || 0));
        return json(200, await store().registraStudio(minuti, String(b?.materia || '').slice(0, 80)));
      }
      if (azione === 'serie' && request.method === 'GET') return json(200, await store().serie());
      // ---------- promemoria (notifiche push) ----------
      const globale = () => multi ? auth() : store();
      const chiaviVapid = async () => {
        let k = await globale().impostazione('vapid');
        if (!k) { k = JSON.stringify(await creaChiaviVapid()); await globale().setImpostazione('vapid', k); }
        return JSON.parse(k);
      };
      if (azione === 'push-chiave' && request.method === 'GET') return json(200, { chiave: (await chiaviVapid()).pubblica, stato: await store().statoPush() });
      if (azione === 'push-iscrivi' && request.method === 'POST') {
        const b = await corpo();
        const sub = b?.iscrizione;
        if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return json(400, { error: 'Iscrizione non valida.' });
        const ora = Number.isFinite(Number(b.ora)) && b.ora !== '' && b.ora != null ? Math.max(0, Math.min(23, Math.round(Number(b.ora)))) : 18;
        const st = await store().iscriviPush({ endpoint: sub.endpoint.slice(0, 1000), keys: sub.keys || {} }, ora);
        if (multi) await auth().segnaUtentePush(utente.id, ora);
        return json(200, st);
      }
      if (azione === 'push-disiscrivi' && request.method === 'POST') {
        const b = await corpo();
        const st = await store().disiscriviPush(String(b?.endpoint || '').slice(0, 1000));
        if (multi && !st.attive) await auth().segnaUtentePush(utente.id, null);
        return json(200, st);
      }
      if (azione === 'push-prova' && request.method === 'POST') {
        const chiavi = await chiaviVapid(); let ok = 0;
        for (const sub of await store().iscrizioni(null)) { const r = await inviaPush(sub, chiavi, env.CONTATTO_EMAIL && 'mailto:' + env.CONTATTO_EMAIL); if (r === 'ok') ok++; if (r === 'scaduta') await store().disiscriviPush(sub.endpoint); }
        return json(200, { inviate: ok });
      }
      // ---------- condivisione degli appunti ----------
      if (azione === 'condividi') {
        if (request.method === 'POST') {
          const b = await corpo();
          const l = b && typeof b.id === 'string' ? await store().leggi(b.id.slice(0, 64)) : null;
          if (!l) return json(404, { error: 'Salva prima la lezione.' });
          if (l.condiviso) return json(200, { token: l.condiviso, url: url.origin + '/c/' + l.condiviso });
          const token = nuovoToken().slice(0, 22);
          await globale().creaCondivisione(token, utente ? utente.id : '', l.id);
          await store().segnaCondiviso(l.id, token);
          return json(200, { token, url: url.origin + '/c/' + token });
        }
        if (request.method === 'DELETE') {
          const id = String(url.searchParams.get('id') || '').slice(0, 64);
          const l = await store().leggi(id);
          if (l?.condiviso) { await globale().revocaCondivisione(l.condiviso); await store().segnaCondiviso(id, null); }
          return json(200, { ok: true });
        }
      }
      if (azione === 'esporta' && request.method === 'GET') return json(200, await store().esporta());
      if (azione === 'glossario-estrai' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        const l = b && typeof b.id === 'string' ? await store().leggi(b.id.slice(0, 64)) : null;
        if (!l) return json(404, { error: 'Salva prima la lezione.' });
        const testo = (l.appunti && l.appunti.length > 500 ? l.appunti : l.testo) || '';
        if (testo.length < 300) return json(400, { error: 'La lezione è troppo corta per un glossario.' });
        // al salvataggio automatico non rifà il glossario se la lezione è cambiata poco (risparmia AI)
        if (b.auto && l.glo_len && Math.abs(testo.length - l.glo_len) < Math.max(400, l.glo_len * 0.15)) return json(200, { nuovi: 0, aggiornati: 0, materia: l.materia, saltato: true });
        const r = await estraiGlossario(env, { testo, materia: l.materia, esistenti: await store().terminiMateria(l.materia) });
        if (r.token) await store().usaToken(r.token);
        if (r.status !== 200) return json(r.status, r.body);
        const esito = await store().salvaTermini(l.materia, l, r.body.termini);
        await store().segnaGlossario(l.id, testo.length);
        return json(200, { ...esito, materia: l.materia, uso: await store().usoOggi() });
      }
      if (azione === 'glossario') {
        if (request.method === 'GET') return json(200, await store().glossario((url.searchParams.get('materia') || '').trim().slice(0, 80)));
        if (request.method === 'DELETE') return json(200, await store().eliminaTermine(String(url.searchParams.get('chiave') || '').slice(0, 300)));
      }
      if (azione === 'esami') {
        if (request.method === 'GET') return json(200, await store().esami());
        if (request.method === 'POST') {
          const b = await request.json().catch(() => null);
          if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.data) || !String(b.materia || '').trim()) return json(400, { error: 'Servono materia e data.' });
          return json(200, await store().salvaEsame({ id: typeof b.id === 'string' ? b.id.slice(0, 64) : undefined, materia: String(b.materia).trim().slice(0, 80), nome: String(b.nome || '').trim().slice(0, 80), data: b.data }));
        }
        if (request.method === 'DELETE') return json(200, await store().eliminaEsame(String(url.searchParams.get('id') || '').slice(0, 64)));
      }
      if (azione === 'oggi' && request.method === 'GET') {
        const d = url.searchParams.get('data');
        return json(200, await store().oggi(/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : oggi()));
      }
      if (azione === 'ripassata' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || typeof b.id !== 'string') return json(400, { error: 'Manca la lezione.' });
        return json(200, await store().segnaRipasso(b.id.slice(0, 64)));
      }
      if (azione.startsWith('admin/')) {
        if (!admin) return json(403, { error: 'Solo per l’amministratore.' });
        if (azione === 'admin/utenti' && request.method === 'GET') {
          const utenti = await auth().elencoUtenti();
          const dettagli = await Promise.all(utenti.map(u => Promise.resolve().then(() => env.STORE.get(env.STORE.idFromName('u:' + u.id)).riepilogo()).catch(() => ({}))));
          const def = Number(env.ORE_SETTIMANA_UTENTE) || 10, settimana = Date.now() - 7 * 86400000;
          return json(200, {
            utenti: utenti.map((u, i) => ({ ...u, ...dettagli[i], limite: u.oreLimite != null ? u.oreLimite : def })),
            totali: { utenti: utenti.length, attivi7: utenti.filter(u => u.ultimo > settimana).length, oggi: await auth().usoOggi() },
            predefinito: def,
          });
        }
        if (azione === 'admin/elimina' && request.method === 'POST') {
          const b = await request.json().catch(() => null);
          const u = b && typeof b.id === 'string' ? await auth().utentePerId(b.id.slice(0, 64)) : null;
          if (!u) return json(404, { error: 'Utente non trovato.' });
          if (u.id === utente.id) return json(400, { error: 'Per eliminare il tuo account usa «Elimina account» nel profilo.' });
          if (String(b.conferma || '').trim().toLowerCase() !== u.email) return json(400, { error: 'Per confermare scrivi l’email esatta dell’utente.' });
          // cancella prima tutti i suoi dati (lezioni, flashcard, profilo, promemoria…), poi l'account e le sessioni
          await env.STORE.get(env.STORE.idFromName('u:' + u.id)).eliminaTutto();
          await auth().eliminaUtente(u.id);
          return json(200, { ok: true });
        }
        if (azione === 'admin/aggiorna' && request.method === 'POST') {
          const b = await request.json().catch(() => null);
          if (!b || typeof b.id !== 'string') return json(400, { error: 'Dati mancanti.' });
          const ore = b.oreLimite === null || b.oreLimite === '' ? null : Math.max(0, Math.min(200, Number(b.oreLimite)));
          if (ore !== null && Number.isNaN(ore)) return json(400, { error: 'Numero di ore non valido.' });
          return json(200, await auth().aggiornaUtente(b.id.slice(0, 64), { oreLimite: ore, bloccato: !!b.bloccato }));
        }
        return json(404, { error: 'Richiesta sconosciuta.' });
      }
      if (azione === 'profilo') {
        if (request.method === 'GET') return json(200, await store().profilo());
        if (request.method === 'POST') {
          const b = await request.json().catch(() => null);
          if (!b) return json(400, { error: 'Dati mancanti.' });
          const campo = (k, n = 120) => String(b[k] || '').trim().slice(0, n);
          const foto = typeof b.foto === 'string' && b.foto.startsWith('data:image/') && b.foto.length < 300_000 ? b.foto : '';
          return json(200, await store().salvaProfilo({ nome: campo('nome'), cognome: campo('cognome'), email: campo('email'), telefono: campo('telefono', 40), professione: campo('professione'), foto }));
        }
      }
      if (azione === 'elimina-tutto' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (b?.conferma !== 'ELIMINA') return json(400, { error: 'Conferma mancante.' });
        await store().eliminaTutto();
        if (!multi) return json(200, { ok: true });
        await auth().eliminaUtente(utente.id);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie('sessione', '', 0) } });
      }
      if (azione === 'lavagna' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        const imm = Array.isArray(b?.immagini) ? b.immagini.filter(x => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 5) : [];
        if (!imm.length) return json(400, { error: 'Nessuna foto.' });
        const r = await leggiLavagna(env, { immagini: imm, materia: String(b.materia || '').slice(0, 80) });
        if (r.token) await store().usaToken(r.token);
        return json(r.status, r.body);
      }
      if (azione === 'flashcard-materia' && request.method === 'GET') {
        const materia = (url.searchParams.get('materia') || '').trim().slice(0, 80);
        if (!materia) return json(400, { error: 'Manca la materia.' });
        return json(200, { carte: await store().flashcardMateria(materia), storico: await store().storico(materia, '') });
      }
      if (azione === 'quiz' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || !Array.isArray(b.risultati)) return json(400, { error: 'Dati mancanti.' });
        const risultati = b.risultati.slice(0, 200).map(r => ({ domanda: String(r.domanda || ''), ok: !!r.ok })).filter(r => r.domanda);
        return json(200, { storico: await store().registraQuiz({ materia: String(b.materia || '').slice(0, 80), lezione: typeof b.lezione === 'string' ? b.lezione.slice(0, 64) : '', risultati }) });
      }
      if (azione === 'chiedi' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        const domanda = String(b?.domanda || '').trim().slice(0, 1000);
        if (!domanda) return json(400, { error: 'Scrivi una domanda.' });
        const materia = String(b.materia || '').trim().slice(0, 80);
        const parole = paroleChiave(domanda + ' ' + (Array.isArray(b.storia) ? b.storia.filter(m => m.ruolo === 'io').slice(-1).map(m => m.testo).join(' ') : ''));
        const passaggi = parole.length ? await store().cerca(materia, parole) : [];
        const r = await rispondi(env, { domanda, passaggi, storia: Array.isArray(b.storia) ? b.storia : [] });
        if (r.token) await store().usaToken(r.token);
        if (r.status === 200) r.body.fonti = passaggi.map(p => ({ titolo: p.titolo, materia: p.materia, data: p.data, tipo: p.tipo }));
        return json(r.status, r.body);
      }
      if (azione === 'flashcard-salva' && request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || typeof b.id !== 'string' || !Array.isArray(b.carte)) return json(400, { error: 'Dati mancanti.' });
        const r = await store().salvaFlashcard(b.id.slice(0, 64), JSON.stringify(b.carte.slice(0, 100)).slice(0, 200_000));
        return r ? json(200, r) : json(404, { error: 'Lezione non trovata.' });
      }
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

  // Ogni ora: manda il promemoria a chi l'ha chiesto per quest'ora e ha lezioni da ripassare oggi
  async scheduled(event, env, ctx) {
    const multi = env.MULTIUTENTE === 'si' || env.MULTIUTENTE === 'true';
    const ora = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
    const globale = env.STORE.get(env.STORE.idFromName(multi ? 'auth' : 'principale'));
    const k = await globale.impostazione('vapid');
    if (!k) return;
    const chiavi = JSON.parse(k), contatto = env.CONTATTO_EMAIL ? 'mailto:' + env.CONTATTO_EMAIL : undefined;
    const archivi = multi ? (await globale.utentiPush(ora)).map(u => 'u:' + u) : ['principale'];
    for (const nome of archivi) {
      const st = env.STORE.get(env.STORE.idFromName(nome));
      const subs = await st.iscrizioni(ora);
      if (!subs.length) continue;
      const serie = await st.serie();
      if (!(await st.daRipassareOggi()) && !(serie.serie >= 2 && !serie.oggiFatto)) continue;
      for (const sub of subs) { if (await inviaPush(sub, chiavi, contatto) === 'scaduta') await st.disiscriviPush(sub.endpoint); }
    }
  },
};
