// Flashcard a risposta multipla generate dalla trascrizione con un modello di testo di Groq.
// Usa la stessa chiave GROQ_API_KEY della trascrizione. Piano gratuito: i modelli hanno limiti
// di "token al minuto" diversi, quindi proviamo dal più capiente e, se uno non risponde
// (limite raggiunto, modello ritirato), passiamo al successivo.

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
// [modello, caratteri massimi di lezione da inviare]
const MODELLI = [
  ['meta-llama/llama-4-scout-17b-16e-instruct', 60000],
  ['llama-3.3-70b-versatile', 24000],
  ['openai/gpt-oss-120b', 14000],
];

// Se la lezione è troppo lunga, prende pezzi distribuiti su tutta la lezione (inizio, metà, fine…)
function riduci(testo, max) {
  const t = testo.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const pezzi = 8, lung = Math.floor(max / pezzi) - 10, passo = (t.length - lung) / (pezzi - 1);
  const out = [];
  for (let i = 0; i < pezzi; i++) out.push(t.slice(Math.round(i * passo), Math.round(i * passo) + lung));
  return out.join(' […] ');
}

function istruzioni(materia, quante) {
  return `Sei un docente universitario italiano${materia ? ` di ${materia}` : ''}. Dalla trascrizione di una lezione crea ${quante} flashcard a risposta multipla per ripassare per l'esame.
Regole:
- Domande sui concetti, le definizioni, le distinzioni e gli esempi importanti della lezione, non su dettagli banali o frasi di servizio del professore.
- Ogni domanda ha 4 opzioni: 1 corretta e 3 sbagliate ma plausibili, della stessa lunghezza e dello stesso stile della corretta.
- Niente opzioni del tipo "tutte le precedenti" o "nessuna delle precedenti".
- La trascrizione automatica può contenere errori: correggi i termini tecnici evidentemente sbagliati.
- "spiegazione": una frase che spiega perché la risposta è corretta.
- Scrivi in italiano.
Rispondi SOLO con JSON in questo formato:
{"carte":[{"domanda":"...","opzioni":["...","...","...","..."],"corretta":0,"spiegazione":"..."}]}
dove "corretta" è la posizione (0-3) della risposta giusta in "opzioni".`;
}

function mescola(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Tiene solo le carte ben formate e mescola le opzioni (i modelli tendono a mettere la giusta per prima)
function pulisci(dati) {
  const carte = Array.isArray(dati?.carte) ? dati.carte : [];
  const out = [];
  for (const c of carte) {
    const opz = Array.isArray(c?.opzioni) ? c.opzioni.map(o => String(o ?? '').trim()).filter(Boolean) : [];
    const idx = Number(c?.corretta);
    if (!c?.domanda || opz.length < 2 || !(idx >= 0 && idx < opz.length) || new Set(opz).size !== opz.length) continue;
    const giusta = opz[idx];
    const nuove = mescola(opz.slice(0, 4).includes(giusta) ? opz.slice(0, 4) : [giusta, ...opz.filter(o => o !== giusta).slice(0, 3)]);
    out.push({ domanda: String(c.domanda).trim().slice(0, 500), opzioni: nuove.map(o => o.slice(0, 300)), corretta: nuove.indexOf(giusta), spiegazione: String(c.spiegazione || '').trim().slice(0, 600) });
  }
  return out;
}

function leggiJson(s) {
  try { return JSON.parse(s); } catch (_) {}
  const m = String(s || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

export async function generaFlashcard(env, { testo, materia, quante }) {
  if (!env.GROQ_API_KEY) return { status: 503, body: { error: 'Manca la chiave Groq.', code: 'no-key' } };
  const n = Math.min(Math.max(Number(quante) || 15, 5), 30);
  const modelli = env.GROQ_MODELLO_FLASHCARD ? [[env.GROQ_MODELLO_FLASHCARD, 24000], ...MODELLI] : MODELLI;
  let attesa = 0, ultimoErrore = '';
  for (const [modello, max] of modelli) {
    const body = {
      model: modello,
      messages: [
        { role: 'system', content: istruzioni(materia, n) },
        { role: 'user', content: 'Trascrizione della lezione:\n\n' + riduci(testo, max) },
      ],
      temperature: 0.4,
      max_completion_tokens: 6000,
      response_format: { type: 'json_object' },
    };
    if (modello.startsWith('openai/')) body.reasoning_effort = 'low';
    let res;
    try {
      res = await fetch(GROQ_CHAT, { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) { ultimoErrore = 'rete'; continue; }
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const carte = pulisci(leggiJson(data?.choices?.[0]?.message?.content));
      if (carte.length >= 3) return { status: 200, body: { carte, modello } };
      ultimoErrore = 'risposta non valida'; continue;
    }
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.log('Groq flashcard', modello, res.status, detail);
    if (res.status === 401 || detail.includes('invalid_api_key')) return { status: 502, body: { error: 'Chiave Groq non valida.', code: 'chiave-groq' } };
    if (detail.includes('blocked_api_access')) return { status: 503, body: { error: 'Fondi del mese esauriti.', code: 'fondi-esauriti' } };
    if (res.status === 429) attesa = Math.max(attesa, Number(res.headers.get('retry-after')) || 30);
    ultimoErrore = 'HTTP ' + res.status;
  }
  if (attesa) return { status: 429, body: { error: 'Limite di Groq raggiunto per ora.', retryAfter: attesa } };
  return { status: 502, body: { error: 'Non riesco a creare le flashcard (' + ultimoErrore + ').' } };
}
