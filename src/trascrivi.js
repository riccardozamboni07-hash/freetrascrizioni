// Cloudflare Pages Function: /api/trascrivi
// Riceve un pezzo di audio (MP3 o WAV, max ~90 s) dall'app, lo inoltra a Groq
// (Whisper large-v3-turbo) e restituisce il testo. La chiave GROQ_API_KEY è una
// variabile segreta del progetto Cloudflare: non arriva mai al browser.

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 5 * 1024 * 1024;
const LINGUE = new Set(['it', 'en']);

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
  const name = type.includes('mpeg') ? 'pezzo.mp3' : 'pezzo.wav';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), name);
  form.append('model', MODEL);
  form.append('language', lang);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (lang === 'it') form.append('prompt', 'Lezione universitaria in italiano.');

  let res;
  try {
    res = await fetch(GROQ_URL, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  } catch {
    return json(502, { error: 'Il servizio di trascrizione non risponde.' });
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 20;
    return json(429, { error: 'Troppe richieste: riprovo tra poco.', retryAfter: wait }, { 'retry-after': String(wait) });
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.log('Groq', res.status, detail);
    // tetto di spesa mensile di Groq raggiunto
    if (detail.includes('blocked_api_access')) return json(503, { error: 'Fondi del mese esauriti.', code: 'fondi-esauriti' });
    return json(502, { error: `Errore del servizio di trascrizione (${res.status}).` });
  }
  const data = await res.json().catch(() => ({}));
  return json(200, { text: (data.text || '').trim() });
}
