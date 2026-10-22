// Cloudflare Pages Function: /api/trascrivi
// Riceve un pezzo di audio (MP3 o WAV, max ~90 s) dall'app, lo inoltra a Groq
// (Whisper large-v3-turbo) e restituisce il testo. La chiave GROQ_API_KEY è una
// variabile segreta del progetto Cloudflare: non arriva mai al browser.

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 5 * 1024 * 1024;
const LINGUE = new Set(['it', 'en']);

// Parole tipiche per materia: vengono date a Whisper come "suggerimento" (prompt, max ~224 token),
// così scrive meglio termini tecnici e nomi propri. L'ordine conta: le voci più specifiche prima.
const VOCABOLARIO = [
  ['diritto pubblico', 'Costituzione, Corte costituzionale, Parlamento, Presidente della Repubblica, Consiglio dei ministri, decreto-legge, decreto legislativo, legge delega, riserva di legge, gerarchia delle fonti, regolamento, Stato di diritto, sovranità popolare, referendum abrogativo, regioni, autonomie locali, Unione europea'],
  ['diritto privato', 'Codice civile, negozio giuridico, contratto, obbligazione, capacità giuridica, capacità di agire, diritti reali, proprietà, usufrutto, possesso, usucapione, responsabilità extracontrattuale, risarcimento del danno, nullità, annullabilità, rescissione, risoluzione'],
  ['filosofia del diritto', 'giusnaturalismo, giuspositivismo, Kelsen, Hart, Bobbio, Dworkin, Radbruch, norma fondamentale, validità, efficacia, ordinamento giuridico, Hobbes, Locke, Rousseau, Kant'],
  ['economia aziendale', 'bilancio d\'esercizio, stato patrimoniale, conto economico, partita doppia, Dare e Avere, ammortamento, ratei e risconti, rimanenze, patrimonio netto, capitale sociale, reddito d\'esercizio, fabbisogno finanziario, costi fissi, costi variabili, break-even point, IVA'],
  ['economia politica', 'domanda, offerta, equilibrio di mercato, elasticità, utilità marginale, costo opportunità, curva di indifferenza, vincolo di bilancio, concorrenza perfetta, monopolio, oligopolio, PIL, inflazione, moneta, tasso di interesse'],
  ['microeconomia', 'domanda, offerta, equilibrio di mercato, elasticità, utilità marginale, costo opportunità, curva di indifferenza, vincolo di bilancio, concorrenza perfetta, monopolio, oligopolio, surplus del consumatore'],
  ['macroeconomia', 'PIL, inflazione, disoccupazione, moneta, tasso di interesse, politica monetaria, politica fiscale, BCE, moltiplicatore keynesiano, IS-LM, bilancia dei pagamenti, debito pubblico'],
  ['algebra lineare', 'matrice, determinante, vettore, spazio vettoriale, sottospazio, base, dimensione, rango, autovalore, autovettore, applicazione lineare, nucleo, immagine, sistema lineare, Gauss, Cramer, Rouché-Capelli'],
  ['statistica', 'media, mediana, moda, varianza, scarto quadratico medio, distribuzione normale, probabilità, campione, popolazione, intervallo di confidenza, test d\'ipotesi, regressione, correlazione'],
  ['matematica', 'funzione, dominio, limite, derivata, integrale, teorema, dimostrazione, ipotesi, tesi, continuità, asintoto, logaritmo, esponenziale, successione, serie'],
];
function suggerimento(lang, materiaGrezza) {
  const materia = String(materiaGrezza || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (lang !== 'it') return materia ? `Topic: ${materia}.` : '';
  if (!materia) return 'Registrazione in italiano.';
  const m = materia.toLowerCase();
  const voce = VOCABOLARIO.find(([k]) => m.includes(k));
  return `Argomento: ${materia}.` + (voce ? ` Termini: ${voce[1]}.` : '');
}
export { suggerimento };

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

// Solo richieste dalla pagina dell'app stessa (stesso dominio), per non far usare la quota ad altri siti.
function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin).hostname, self = new URL(request.url).hostname;
    return o === self || o === 'localhost' || o === '127.0.0.1';
  } catch { return false; }
}

export async function onRequest({ request, env }) {
  const key = env.GROQ_API_KEY;
  // GET = controllo rapido: l'app chiede se la modalità online è attiva
  if (request.method === 'GET') return json(200, { online: Boolean(key) });
  if (request.method !== 'POST') return json(405, { error: 'Usa POST.' });
  if (!originAllowed(request)) return json(403, { error: 'Origine non consentita.' });
  if (!key) return json(503, { error: 'La trascrizione online non è ancora configurata.', code: 'no-key' });

  const url = new URL(request.url);
  const lang = LINGUE.has(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'it';
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json(400, { error: 'Audio vuoto.' });
  if (audio.byteLength > MAX_BYTES) return json(413, { error: 'Pezzo di audio troppo grande.' });

  const type = request.headers.get('content-type') || 'audio/wav';
  // estensione giusta per Groq (le risposte a voce dell'orale arrivano come m4a/webm/ogg)
  const name = type.includes('mpeg') ? 'pezzo.mp3' : type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'pezzo.m4a'
    : type.includes('webm') ? 'pezzo.webm' : type.includes('ogg') ? 'pezzo.ogg' : 'pezzo.wav';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), name);
  form.append('model', MODEL);
  form.append('language', lang);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', suggerimento(lang, url.searchParams.get('materia')));

  let res;
  try {
    res = await fetch(GROQ_URL, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  } catch {
    return json(502, { error: 'Il servizio di trascrizione non risponde.' });
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 20;
    return json(429, { error: 'Il servizio di trascrizione è molto usato in questo momento.', code: 'groq-limite', retryAfter: wait }, { 'retry-after': String(wait) });
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.log('Groq', res.status, detail);
    // tetto di spesa mensile di Groq raggiunto
    if (detail.includes('blocked_api_access')) return json(503, { error: 'Fondi del mese esauriti.', code: 'fondi-esauriti' });
    // chiave Groq sbagliata, incompleta o cancellata
    if (res.status === 401 || detail.includes('invalid_api_key')) return json(502, { error: 'Chiave Groq non valida.', code: 'chiave-groq' });
    return json(502, { error: `Errore del servizio di trascrizione (${res.status}).` });
  }
  const data = await res.json().catch(() => ({}));
  return json(200, { text: (data.text || '').trim() });
}
