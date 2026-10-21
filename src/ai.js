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
async function chat(env, modelli, messages, { temperature = 0.3, maxOut = 8000, json = false } = {}) {
  if (!env.GROQ_API_KEY) return { status: 503, body: { error: 'Manca la chiave Groq.', code: 'no-key' } };
  let attesa = 0, ultimoErrore = '';
  for (const modello of modelli) {
    const body = { model: modello, messages, temperature, max_completion_tokens: maxOut };
    if (json) body.response_format = { type: 'json_object' };
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

export async function generaTesto(env, { tipo, testo, materia, data, parte, totale, lavagna, materiale }) {
  let system = tipo === 'aggiusta' ? istruzioniAggiusta(materia) : istruzioniAppunti(materia, data, parte, totale);
  if (tipo !== 'aggiusta' && lavagna) system += `

FOTO DELLA LAVAGNA
Qui sotto c'è il contenuto delle foto della lavagna di questa lezione, già trascritto. Usalo per completare e correggere gli appunti: integra schemi, formule e definizioni al punto giusto. Se lavagna e trascrizione sono in contrasto (soprattutto sui numeri) prevale la lavagna: segnala la correzione nei punti da verificare. Usa solo la parte che riguarda il pezzo di lezione che stai scrivendo.
<lavagna>
${lavagna}
</lavagna>`;
  if (tipo !== 'aggiusta' && materiale) system += `

SLIDE E MATERIALE DEL PROFESSORE
Qui sotto c'è il testo delle slide o dei PDF del professore per questa lezione. Usalo per completare gli appunti (definizioni esatte, schemi, numeri, articoli), integrandolo al punto giusto; la lezione detta resta la base. Usa solo la parte che riguarda il pezzo che stai scrivendo.
<materiale>
${materiale}
</materiale>`;
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

// Se il testo è troppo lungo prende pezzi distribuiti su tutta la lezione
function riduci(testo, max) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const pezzi = 6, lung = Math.floor(max / pezzi) - 10, passo = (t.length - lung) / (pezzi - 1);
  const out = [];
  for (let i = 0; i < pezzi; i++) out.push(t.slice(Math.round(i * passo), Math.round(i * passo) + lung));
  return out.join(' […] ');
}

// Glossario: estrae i termini tecnici della lezione e arricchisce quelli già presenti nella materia
export async function estraiGlossario(env, { testo, materia, esistenti }) {
  const gia = (esistenti || []).slice(0, 300).join('; ');
  const r = await chat(env, modelliTesto(env), [
    { role: 'system', content: `Sei un docente universitario${materia ? ` di ${materia}` : ''}. Dal testo di una lezione estrai il GLOSSARIO: i termini tecnici, gli istituti, i concetti e le sigle che uno studente deve saper definire all'esame.
Regole:
- Da 5 a 25 termini, solo quelli davvero spiegati o usati in modo importante nella lezione; niente parole comuni.
- "definizione": 1-3 frasi chiare, fedeli a come li spiega il professore, senza inventare.
- Scrivi il termine come lo scriverebbe un manuale (iniziale maiuscola solo se nome proprio o sigla).
- Termini già presenti nel glossario della materia: ${gia || '(nessuno)'}. Se uno di questi compare nella lezione con informazioni NUOVE, includilo con "aggiorna": true e una definizione completa che unisce il vecchio e il nuovo; se non aggiunge niente, non includerlo.
- La trascrizione è automatica: correggi i termini evidentemente sbagliati.
Rispondi SOLO con JSON: {"termini":[{"termine":"...","definizione":"...","aggiorna":false}]}` },
    { role: 'user', content: 'Testo della lezione:\n\n' + riduci(testo, 40000) },
  ], { temperature: 0.2, maxOut: 4000, json: true });
  if (r.status !== 200) return r;
  let d = null;
  try { d = JSON.parse(r.body.testo); } catch (_) { const m = String(r.body.testo).match(/\{[\s\S]*\}/); if (m) try { d = JSON.parse(m[0]); } catch (_) {} }
  const termini = (Array.isArray(d?.termini) ? d.termini : [])
    .map(t => ({ termine: String(t.termine || '').trim().slice(0, 120), definizione: String(t.definizione || '').trim().slice(0, 1200) }))
    .filter(t => t.termine && t.definizione);
  return { status: 200, body: { termini }, token: r.token };
}

function leggiJsonAI(t) {
  try { return JSON.parse(t); } catch (_) {}
  const m = String(t || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

// Simulazione dell'esame orale: una domanda alla volta sul materiale di una lezione della materia
export async function domandaOrale(env, { materia, titolo, testo, gia }) {
  const r = await chat(env, modelliTesto(env), [
    { role: 'system', content: `Sei un professore universitario di ${materia || 'questa materia'} che interroga uno studente all'esame orale.
Dal materiale della lezione qui sotto fai UNA domanda d'esame, come la farebbe un professore: chiara, su un concetto importante, che richieda una risposta di 1-2 minuti (definizione + spiegazione o esempio, oppure un confronto tra due istituti/concetti).
Non fare domande già fatte: ${(gia || []).slice(-10).join(' | ') || '(nessuna)'}.
Rispondi SOLO con JSON: {"domanda":"...","punti":["punto che una buona risposta deve toccare", "..."]} con 3-5 punti.` },
    { role: 'user', content: `Lezione: ${titolo}\n\n` + riduci(testo, 24000) },
  ], { temperature: 0.7, maxOut: 800, json: true });
  if (r.status !== 200) return r;
  const d = leggiJsonAI(r.body.testo);
  if (!d?.domanda) return { status: 502, body: { error: 'Non riesco a preparare la domanda: riprova.' }, token: r.token };
  return { status: 200, body: { domanda: String(d.domanda).slice(0, 600), punti: (Array.isArray(d.punti) ? d.punti : []).map(String).slice(0, 6) }, token: r.token };
}

export async function valutaOrale(env, { materia, titolo, testo, domanda, punti, risposta }) {
  const r = await chat(env, modelliTesto(env), [
    { role: 'system', content: `Sei un professore universitario di ${materia || 'questa materia'}, giusto ma esigente. Valuti la risposta orale di uno studente (trascritta automaticamente: ignora gli errori di trascrizione e le esitazioni).
Basati sul materiale della lezione e sui punti attesi. Voto in trentesimi da 0 a 30 (30 e lode = 31), come all'università italiana; sotto 18 è insufficiente.
Rispondi SOLO con JSON: {"voto":24,"giudizio":"una frase","bene":["cosa ha detto bene"],"mancava":["cosa mancava o era sbagliato"],"modello":"una risposta da 30 in 4-6 frasi, con la terminologia del professore"}` },
    { role: 'user', content: `Lezione: ${titolo}\n\nMateriale:\n${riduci(testo, 16000)}\n\nDomanda: ${domanda}\nPunti attesi: ${(punti || []).join('; ')}\n\nRisposta dello studente:\n${String(risposta || '').slice(0, 6000) || '(nessuna risposta)'}` },
  ], { temperature: 0.2, maxOut: 1500, json: true });
  if (r.status !== 200) return r;
  const d = leggiJsonAI(r.body.testo) || {};
  const voto = Math.max(0, Math.min(31, Math.round(Number(d.voto) || 0)));
  const lista = x => (Array.isArray(x) ? x : []).map(String).slice(0, 6);
  return { status: 200, body: { voto, giudizio: String(d.giudizio || '').slice(0, 300), bene: lista(d.bene), mancava: lista(d.mancava), modello: String(d.modello || '').slice(0, 2000) }, token: r.token };
}

// Mappa concettuale della lezione: albero di concetti (massimo 3 livelli)
export async function creaMappa(env, { materia, titolo, testo }) {
  const r = await chat(env, modelliTesto(env), [
    { role: 'system', content: `Crea la MAPPA CONCETTUALE di una lezione universitaria${materia ? ` di ${materia}` : ''} per il ripasso veloce.
Regole: un concetto centrale; 3-7 rami principali; ogni ramo con 0-5 sotto-concetti; al massimo 3 livelli. Etichette brevi (max 6 parole). "nota": max 15 parole, facoltativa, solo dove aiuta (definizione lampo, esempio, collegamento). Usa la terminologia del professore, niente invenzioni.
Rispondi SOLO con JSON: {"titolo":"concetto centrale","rami":[{"titolo":"...","nota":"...","rami":[{"titolo":"...","nota":"..."}]}]}` },
    { role: 'user', content: `Lezione: ${titolo}\n\n` + riduci(testo, 30000) },
  ], { temperature: 0.3, maxOut: 2500, json: true });
  if (r.status !== 200) return r;
  const d = leggiJsonAI(r.body.testo);
  const pulisci = (n, liv) => ({ titolo: String(n?.titolo || '').slice(0, 80), nota: String(n?.nota || '').slice(0, 160),
    rami: liv < 3 && Array.isArray(n?.rami) ? n.rami.slice(0, 8).map(x => pulisci(x, liv + 1)).filter(x => x.titolo) : [] });
  if (!d?.titolo) return { status: 502, body: { error: 'Non riesco a creare la mappa: riprova.' }, token: r.token };
  return { status: 200, body: { mappa: pulisci(d, 1) }, token: r.token };
}
