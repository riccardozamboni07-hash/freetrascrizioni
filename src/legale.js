// Pagine "Privacy" e "Condizioni d'uso" dell'app pubblica.
// Sono una base di partenza: vanno lette e, prima di un uso commerciale, fatte controllare da un esperto.
// Il contatto del titolare si imposta con la variabile CONTATTO_EMAIL (altrimenti la prima di ADMIN_EMAIL).

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(titolo, corpo) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titolo} · Astra Note</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap">
<style>
:root{--bg:#ffffff;--surface:#fff;--fg:#10201a;--muted:#5b6b63;--line:#e8ecea;--accent:#14573d}
@media (prefers-color-scheme:dark){:root{--bg:#0e1512;--surface:#16201b;--fg:#eaf3ee;--muted:#9db3a7;--line:#24332b;--accent:#6fd3a0}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 "Plus Jakarta Sans",-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px 16px}
main{max-width:720px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:22px}
h1{color:var(--accent);margin:0 0 4px;font-size:1.6rem}h2{font-size:1.1rem;margin:1.6em 0 .4em}
p,li{margin:.4em 0}.muted{color:var(--muted);font-size:.9rem}a{color:var(--accent)}
</style></head><body><main><p class="muted"><a href="/">← Torna all'app</a></p>${corpo}</main></body></html>`;
}

const contatto = env => esc(String(env.CONTATTO_EMAIL || String(env.ADMIN_EMAIL || '').split(/[,\s]+/)[0] || 'il contatto indicato dal titolare'));
const aggiornata = '22 ottobre 2026';

export function privacy(env) {
  const c = contatto(env);
  return pagina('Privacy', `<h1>Informativa sulla privacy</h1><p class="muted">Ultimo aggiornamento: ${aggiornata}</p>
<p>Questa pagina spiega quali dati tratta Astra Note, perché e quali sono i tuoi diritti, secondo il Regolamento europeo 2016/679 (GDPR).</p>
<h2>Chi è il titolare</h2>
<p>Il titolare del trattamento è Riccardo Zamboni, che gestisce l'app. Per qualsiasi richiesta: <strong>${c}</strong>.</p>
<h2>Quali dati trattiamo</h2>
<ul>
<li><strong>Account</strong>: email, nome e password (salvata solo in forma cifrata, non leggibile). Se accedi con Google: email, nome e identificativo Google.</li>
<li><strong>Profilo</strong> (facoltativo): foto, cognome, telefono e professione, solo se li inserisci tu.</li>
<li><strong>Contenuti</strong>: le trascrizioni, gli appunti, le flashcard, i risultati dei ripassi e le domande che fai all'app.</li>
<li><strong>Audio e foto della lavagna</strong>: vengono inviati al servizio di intelligenza artificiale solo per essere trascritti o letti. L'app <strong>non conserva</strong> l'audio né le foto.</li>
<li><strong>Dati di utilizzo</strong>: ore trascritte e uso dell'intelligenza artificiale, per applicare i limiti del servizio; data di iscrizione e dell'ultimo accesso.</li>
<li><strong>Dati tecnici</strong>: quante volte vengono usate le funzioni dell'app (solo conteggi) e, se qualcosa si rompe, il messaggio d'errore con versione dell'app e tipo di dispositivo. Mai i contenuti delle lezioni. Servono solo a migliorare l'app.</li>
<li><strong>Segnalazioni</strong>: i messaggi che invii con «Segnala un problema o un'idea».</li>
</ul>
<h2>Perché li trattiamo</h2>
<p>Solo per fornirti il servizio che hai chiesto registrandoti (base giuridica: esecuzione del contratto, art. 6.1.b GDPR) e per proteggerlo da abusi (legittimo interesse, art. 6.1.f). Non vendiamo i tuoi dati, non li usiamo per pubblicità e non facciamo profilazione.</p>
<h2>A chi li affidiamo</h2>
<ul>
<li><strong>Cloudflare, Inc.</strong>: ospita l'app e conserva l'archivio.</li>
<li><strong>Groq, Inc.</strong> (Stati Uniti): trascrive l'audio e genera appunti, flashcard e risposte.</li>
<li><strong>Google</strong>: solo se scegli «Continua con Google», per verificare la tua identità.</li>
</ul>
<p>Questi fornitori trattano i dati per nostro conto. Alcuni si trovano fuori dall'Unione europea: il trasferimento avviene con le garanzie previste dal GDPR (ad esempio clausole contrattuali standard o EU-US Data Privacy Framework).</p>
<h2>Copia sul tuo dispositivo</h2>
<p>Per farti consultare le lezioni anche senza connessione, l'app ne tiene una copia nella memoria del browser del tuo dispositivo. Quando esci dall'account la copia viene cancellata.</p>
<h2>Per quanto tempo</h2>
<p>Finché il tuo account è attivo. Con <strong>Profilo → Elimina account</strong> cancelli subito e per sempre account e contenuti.</p>
<h2>I tuoi diritti</h2>
<p>Puoi chiedere di accedere ai tuoi dati, correggerli, cancellarli, limitarne il trattamento, opporti e riceverli in un formato leggibile: dal profilo puoi già <strong>scaricare i tuoi dati</strong> ed <strong>eliminare l'account</strong>. Per il resto scrivi a ${c}. Puoi anche presentare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).</p>
<h2>Cookie</h2>
<p>L'app usa solo un <strong>cookie tecnico</strong> per tenerti connesso (e uno temporaneo durante l'accesso con Google). Non ci sono cookie di profilazione o di statistica, quindi non serve il tuo consenso.</p>
<h2>Età</h2>
<p>Il servizio è pensato per chi studia e per chi lavora: per usarlo devi avere almeno 14 anni.</p>`);
}

export function condizioni(env) {
  const c = contatto(env);
  return pagina('Condizioni d’uso', `<h1>Condizioni d'uso</h1><p class="muted">Ultimo aggiornamento: ${aggiornata}</p>
<h2>Il servizio</h2>
<p>Astra Note trascrive lezioni, corsi e riunioni e aiuta a studiarli e riutilizzarli con l'intelligenza artificiale (appunti, flashcard, domande). In questa fase è una <strong>versione di prova (beta)</strong> gratuita, su invito.</p>
<h2>Limiti</h2>
<p>Ogni account ha un limite di ore di trascrizione a settimana e un limite giornaliero di intelligenza artificiale, indicati nell'app. Possono cambiare durante la beta.</p>
<h2>Cosa puoi registrare</h2>
<p>Sei responsabile di quello che registri e carichi. Prima di registrare assicurati di poterlo fare: chiedi il permesso a chi parla (docente, relatore, colleghi in riunione) e rispetta le regole della tua scuola, università o azienda. Non diffondere registrazioni e trascrizioni senza autorizzazione.</p>
<h2>Uso corretto</h2>
<p>Non usare l'app per contenuti illegali, per caricare dati di altre persone senza titolo o per aggirare i limiti (ad esempio creando più account). In questi casi l'account può essere sospeso.</p>
<h2>Intelligenza artificiale</h2>
<p>Trascrizioni, appunti, flashcard e risposte sono generati automaticamente e <strong>possono contenere errori</strong>: controllali sempre sulle fonti ufficiali del corso.</p>
<h2>Garanzie</h2>
<p>Il servizio è offerto «così com'è», senza garanzia di disponibilità continua. Durante la beta possono esserci interruzioni o modifiche. Ti consigliamo di scaricare i contenuti a cui tieni.</p>
<h2>Fine del servizio</h2>
<p>Puoi eliminare l'account in qualsiasi momento dal profilo. Se la beta termina, riceverai un avviso con il tempo necessario per scaricare i tuoi dati.</p>
<h2>Contatti</h2>
<p>Per domande: <strong>${c}</strong>.</p>`);
}

// Pagina pubblica di una lezione condivisa (solo titolo, materia, data e appunti; mai l'audio)
function mdHtml(md) {
  const inl = x => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', lista = false;
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim();
    if (/^[-•*]\s+/.test(l)) { if (!lista) { html += '<ul>'; lista = true; } html += '<li>' + inl(l.replace(/^[-•*]\s+/, '')) + '</li>'; continue; }
    if (lista) { html += '</ul>'; lista = false; }
    if (!l) continue;
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    html += h ? `<h${Math.min(4, h[1].length + 1)}>${inl(h[2])}</h${Math.min(4, h[1].length + 1)}>` : '<p>' + inl(l) + '</p>';
  }
  return html + (lista ? '</ul>' : '');
}
export function paginaCondivisa(l, origineApp) {
  if (!l) return pagina('Link non valido', '<h1>Link non valido</h1><p>Questi appunti non sono più condivisi, oppure il link è sbagliato.</p>');
  const data = (() => { try { return new Date(l.data + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return l.data; } })();
  const corpo = l.appunti && l.appunti.trim() ? mdHtml(l.appunti) : '<p class="muted">Trascrizione:</p>' + String(l.testo || '').split(/\n{2,}/).map(p => '<p>' + esc(p) + '</p>').join('');
  const invito = origineApp ? `<p><a href="${esc(origineApp)}">Prova Astra Note</a>: registra lezioni, corsi e riunioni e ottieni appunti, flashcard e ripasso.</p>` : '';
  return pagina(esc(l.titolo), `<h1>${esc(l.titolo)}</h1><p class="muted">${esc(l.materia)} · ${esc(data)}</p>${corpo}
<hr style="border:none;border-top:1px solid var(--line);margin:24px 0 12px"><p class="muted">Appunti creati con Astra Note.</p>${invito}`).replace('<p class="muted"><a href="/">← Torna all\'app</a></p>', '');
}
