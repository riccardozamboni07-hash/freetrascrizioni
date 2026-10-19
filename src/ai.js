// Appunti e trascrizione corretta creati dentro l'app con un modello di testo di Groq.
// L'app manda la lezione a pezzi (una parte alla volta) e poi li rimette insieme.
// Le istruzioni degli appunti riprendono quelle di "Appunti universitari" (vedi NOTICE).

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const MODELLI = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b'];
export const SEP_VERIFICA = '@@DA_VERIFICARE@@';

function istruzioniAppunti(materia, data, parte, totale) {
  const pezzo = totale > 1
    ? `Ricevi la PARTE ${parte} di ${totale} della lezione: scrivi gli appunti solo di questa parte, senza titolo generale, senza introduzione e senza conclusione, come se continuassero la parte precedente.`
    : 'Ricevi la lezione intera.';
  return `Sei uno studente universitario modello. Trasformi la trascrizione automatica di una lezione in appunti perfetti per studiare e preparare l'esame.
Materia: ${materia || 'non indicata'}. Data: ${data}.
${pezzo}

Principi:
1. Fedeltà al professore: usa la sua terminologia e le sue definizioni, senza sinonimi tuoi.
2. Nessuna invenzione: non aggiungere contenuti, dati, articoli o formule che non sono nella lezione. Un tuo chiarimento va in una riga che inizia con "Nota:".
3. Includi tutti gli esempi del professore accanto al concetto che illustrano.
4. Cattura ogni concetto, definizione, classificazione, collegamento, eccezione e dettaglio che può essere chiesto all'esame. Elimina chiacchiere, avvisi organizzativi e ripetizioni. Segnala le indicazioni del professore sull'esame.
5. Se il professore ha parlato in modo non lineare, riordina in modo coerente senza cambiare il significato.
6. La trascrizione è automatica: correggi i termini tecnici evidentemente sbagliati. Se un numero, un nome o un dato è dubbio, non indovinare: scrivilo con [?].
Adatta la struttura alla materia: per il diritto definizioni, fonti, istituti, differenze tra figure simili e articoli citati; per l'economia aziendale definizioni, schemi e calcoli passo per passo; per la matematica definizioni, teoremi, dimostrazioni ed esercizi con i passaggi.

Formato:
- Un titolo "## " per ogni argomento, eventuali sottotitoli "### ".
- Sotto ogni titolo scrivi in PROSA, in paragrafi brevi e chiari; usa elenchi puntati "- " solo per classificazioni, requisiti o passaggi in sequenza.
- Metti in **grassetto** i termini e le definizioni chiave.
- Niente introduzioni o commenti tuoi: solo gli appunti.
- Alla fine, se ci sono dati dubbi, scrivi una riga con solo ${SEP_VERIFICA} e sotto l'elenco "- " dei punti da verificare. Se non ce ne sono, non scrivere quella riga.
Scrivi in italiano.`;
}

function istruzioniAggiusta(materia) {
  return `Correggi la trascrizione automatica di una lezione universitaria${materia ? ` di ${materia}` : ''}.
1. Correggi gli errori di riconoscimento vocale (parole sbagliate, nomi, termini tecnici) in base al contesto.
2. Sistema punteggiatura e maiuscole e dividi il testo in paragrafi leggibili.
3. Togli solo intercalari e ripetizioni inutili ("allora", "diciamo", "ok", parole ripetute).
4. NON riassumere, NON accorciare i contenuti, NON aggiungere niente: deve restare la lezione completa, con le parole del professore.
Restituisci solo il testo corretto, senza titoli, commenti o introduzioni.`;
}

export async function generaTesto(env, { tipo, testo, materia, data, parte, totale }) {
  if (!env.GROQ_API_KEY) return { status: 503, body: { error: 'Manca la chiave Groq.', code: 'no-key' } };
  const system = tipo === 'aggiusta' ? istruzioniAggiusta(materia) : istruzioniAppunti(materia, data, parte, totale);
  let attesa = 0, ultimoErrore = '';
  for (const modello of (env.GROQ_MODELLO_TESTO ? [env.GROQ_MODELLO_TESTO, ...MODELLI] : MODELLI)) {
    const body = {
      model: modello,
      messages: [{ role: 'system', content: system }, { role: 'user', content: (tipo === 'aggiusta' ? 'Trascrizione da correggere:\n\n' : 'Trascrizione:\n\n') + testo }],
      temperature: tipo === 'aggiusta' ? 0.1 : 0.3,
      max_completion_tokens: 8000,
    };
    if (modello.startsWith('openai/')) body.reasoning_effort = 'low';
    let res;
    try {
      res = await fetch(GROQ_CHAT, { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) { ultimoErrore = 'rete'; continue; }
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      const out = String(d?.choices?.[0]?.message?.content || '').trim();
      if (out) return { status: 200, body: { testo: out, modello, troncato: d?.choices?.[0]?.finish_reason === 'length' }, token: Number(d?.usage?.total_tokens) || 0 };
      ultimoErrore = 'risposta vuota'; continue;
    }
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.log('Groq testo', modello, res.status, detail);
    if (res.status === 401 || detail.includes('invalid_api_key')) return { status: 502, body: { error: 'Chiave Groq non valida.', code: 'chiave-groq' } };
    if (detail.includes('blocked_api_access')) return { status: 503, body: { error: 'Fondi del mese esauriti.', code: 'fondi-esauriti' } };
    if (res.status === 429) attesa = Math.max(attesa, Number(res.headers.get('retry-after')) || 30);
    ultimoErrore = 'HTTP ' + res.status;
  }
  if (attesa) return { status: 429, body: { error: 'Limite di Groq raggiunto per ora.', retryAfter: attesa } };
  return { status: 502, body: { error: 'Il servizio non risponde (' + ultimoErrore + ').' } };
}
