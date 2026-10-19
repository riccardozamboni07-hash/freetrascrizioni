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

// Chiamata a Groq con modelli di riserva: se uno è al limite o non esiste più, prova il successivo.
async function chat(env, modelli, messages, { temperature = 0.3, maxOut = 8000 } = {}) {
  if (!env.GROQ_API_KEY) return { status: 503, body: { error: 'Manca la chiave Groq.', code: 'no-key' } };
  let attesa = 0, ultimoErrore = '';
  for (const modello of modelli) {
    const body = { model: modello, messages, temperature, max_completion_tokens: maxOut };
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
    console.log('Groq', modello, res.status, detail);
    if (res.status === 401 || detail.includes('invalid_api_key')) return { status: 502, body: { error: 'Chiave Groq non valida.', code: 'chiave-groq' } };
    if (detail.includes('blocked_api_access')) return { status: 503, body: { error: 'Fondi del mese esauriti.', code: 'fondi-esauriti' } };
    if (res.status === 429) attesa = Math.max(attesa, Number(res.headers.get('retry-after')) || 30);
    ultimoErrore = 'HTTP ' + res.status;
  }
  if (attesa) return { status: 429, body: { error: 'Limite di Groq raggiunto per ora.', retryAfter: attesa } };
  return { status: 502, body: { error: 'Il servizio non risponde (' + ultimoErrore + ').' } };
}
const modelliTesto = env => (env.GROQ_MODELLO_TESTO ? [env.GROQ_MODELLO_TESTO, ...MODELLI] : MODELLI);
const MODELLI_VISTA = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];

export async function generaTesto(env, { tipo, testo, materia, data, parte, totale, lavagna }) {
  let system = tipo === 'aggiusta' ? istruzioniAggiusta(materia) : istruzioniAppunti(materia, data, parte, totale);
  if (tipo !== 'aggiusta' && lavagna) system += `

FOTO DELLA LAVAGNA
Qui sotto c'è il contenuto delle foto della lavagna di questa lezione, già trascritto. Usalo per completare e correggere gli appunti: integra schemi, formule e definizioni al punto giusto. Se lavagna e trascrizione sono in contrasto (soprattutto sui numeri) prevale la lavagna: segnala la correzione nei punti da verificare. Usa solo la parte che riguarda il pezzo di lezione che stai scrivendo.
<lavagna>
${lavagna}
</lavagna>`;
  return chat(env, modelliTesto(env), [
    { role: 'system', content: system },
    { role: 'user', content: (tipo === 'aggiusta' ? 'Trascrizione da correggere:\n\n' : 'Trascrizione:\n\n') + testo },
  ], { temperature: tipo === 'aggiusta' ? 0.1 : 0.3 });
}

// Legge le foto della lavagna (massimo 5 per volta) e le trascrive in testo
export async function leggiLavagna(env, { immagini, materia }) {
  const content = [{ type: 'text', text: `Sono foto della lavagna di una lezione universitaria${materia ? ` di ${materia}` : ''}. Trascrivi fedelmente in testo tutto quello che c'è scritto: titoli, definizioni, schemi (come elenchi puntati con rientri), tabelle, formule e calcoli passo per passo, numeri esatti. Una sezione "Foto N" per ogni foto. Se una parte è illeggibile scrivi [illeggibile], non indovinare. Rispondi solo con la trascrizione, in italiano.` }];
  for (const url of immagini) content.push({ type: 'image_url', image_url: { url } });
  return chat(env, env.GROQ_MODELLO_VISTA ? [env.GROQ_MODELLO_VISTA, ...MODELLI_VISTA] : MODELLI_VISTA, [{ role: 'user', content }], { temperature: 0.1, maxOut: 4000 });
}

// Risponde a una domanda usando solo i passaggi delle lezioni trovati nell'archivio
export async function rispondi(env, { domanda, passaggi, storia }) {
  const fonti = passaggi.map((p, i) => `[${i + 1}] ${p.titolo} · ${p.materia} · ${p.data} (${p.tipo})\n${p.testo}`).join('\n\n---\n\n');
  const messages = [{ role: 'system', content: `Sei un tutor universitario. Rispondi alle domande dello studente usando SOLO i brani delle sue lezioni qui sotto (trascrizioni e appunti). Regole:
- Rispondi in italiano, in modo chiaro e completo ma senza giri di parole, in prosa; elenchi solo se servono.
- Dopo ogni informazione indica da dove viene con il numero del brano tra parentesi quadre, es. [2].
- Se i brani non contengono la risposta, dillo chiaramente ("Nelle tue lezioni non trovo…") e non inventare. Puoi aggiungere una tua spiegazione generale solo se la segnali come "Fuori dalle lezioni:".
- La trascrizione è automatica: correggi mentalmente i termini evidentemente sbagliati.

BRANI DELLE LEZIONI
${fonti || '(nessun brano trovato)'}` }];
  for (const m of (storia || []).slice(-4)) messages.push({ role: m.ruolo === 'io' ? 'user' : 'assistant', content: String(m.testo || '').slice(0, 4000) });
  messages.push({ role: 'user', content: domanda });
  return chat(env, modelliTesto(env), messages, { temperature: 0.2, maxOut: 2500 });
}
