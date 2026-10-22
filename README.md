# Freetrascrizioni

L'app per **registrare e trascrivere lezioni, corsi e riunioni**, anche di 2 ore, in pochi minuti, e trasformarle in appunti e materiale di studio — da iPhone, Android o computer.

Per chi la usa: studenti di ogni tipo (scuola, università, concorsi, lingue), chi si forma per lavoro (corsi, webinar, certificazioni) e chi deve tenere traccia delle riunioni.

- **Registra** con pausa, ripresa e il tasto **⭐ Importante**, oppure **carica** un audio o un video; trascrizione veloce con Whisper (Groq) o sul dispositivo
- **Si salva da sola** nell'archivio: argomento e titolo li sceglie l'AI
- **Appunti con l'AI** in paragrafi con i titoli; per le riunioni anche **decisioni e cose da fare**. Si parte anche da **PDF, Word, slide, foto** o testo incollato
- **Studia**: flashcard, interrogazione **orale**, simulazione dello **scritto** con voto, **scheda di ripasso**, **esercizi** con soluzione, **mappa**, **Chiedi** alle tue registrazioni, **glossario** automatico
- **Oggi**: piano di ripasso verso l'esame, cerchi giornalieri, serie 🔥 con salva-serie e traguardi, timer di studio, **orario settimanale** con avvisi
- **Promemoria** con notifiche (su iPhone dall'app sulla schermata Home), **🔊 ascolta** gli appunti, funziona **anche offline**
- **Archivio** per materia o argomento, ricerca, **dispensa** in Word o PDF, **condivisione** in sola lettura
- **Versione pubblica** con registrazione (email o Google), pannello amministratore con statistiche, segnalazioni ed errori: vedi [PUBBLICA.md](PUBBLICA.md)
- **Tutto nei tuoi account**: nessuno, nemmeno chi ti ha installato l'app, vede le tue registrazioni

Usa i piani gratuiti di Cloudflare e Groq: con Groq gratis trascrivi circa **8 ore di audio al giorno**. Resta gratuita finché lo restano questi servizi.

## Installazione (circa 15 minuti)

### 1. Crea gli account (usa la stessa email per tutti)
1. **Groq**: [console.groq.com](https://console.groq.com)
2. **GitHub**: [github.com/signup](https://github.com/signup)
3. **Cloudflare**: [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Poi conferma l'email.

### 2. Crea la chiave Groq
4. Apri [console.groq.com/keys](https://console.groq.com/keys) e tocca **Create API Key**.
5. **Copia subito la chiave** (`gsk_…`): Groq la mostra **una volta sola**.

### 3. Installa l'app su Cloudflare
6. Tocca il pulsante qui sotto e accedi a Cloudflare:

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/riccardozamboni07-hash/freetrascrizioni)

7. Alla voce **Git account** tocca **Select** → **Connect GitHub**.
8. Su GitHub autorizza l'app **Cloudflare Workers and Pages** e scegli **All repositories**.
9. Tornato su Cloudflare, spunta **Create private Git repository**.
10. **Scorri in basso** fino alle variabili:
    - **GROQ_API_KEY** → incolla la chiave del punto 5
    - **PASSWORD** → scegli la password per entrare nell'app
11. Tocca **Deploy** e aspetta 1-2 minuti, finché nel log compare **"Success! Build completed."**

### 4. Trova l'indirizzo della tua app
12. Nel log cerca la riga **"Deployed freetrascrizioni triggers"**: sotto c'è l'indirizzo, del tipo `https://freetrascrizioni.tuonome.workers.dev`.
13. Se non lo trovi: apri [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **freetrascrizioni** → **Domains & Routes**.

### 5. Sul telefono
14. Apri l'indirizzo in **Safari** (iPhone) o **Chrome** (Android).
15. Inserisci la **password** del punto 10.
16. Aggiungi l'app alla schermata Home:
    - **iPhone**: Condividi → **Aggiungi alla schermata Home**
    - **Android**: menu ⋮ → **Aggiungi a schermata Home**
17. Registra qualche secondo di voce e premi **Trascrivi** per controllare che tutto funzioni.

## Domande frequenti

- **Quanto costa?** Niente, finché resti nei limiti gratuiti di Groq (~8 ore di audio al giorno, 2 all'ora) e Cloudflare.
- **Chi vede le mie registrazioni?** Solo tu: sono salvate nel tuo account Cloudflare.
- **Ho dimenticato la password.** Su Cloudflare: [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → freetrascrizioni → Settings → Variables and Secrets → modifica `PASSWORD`.

---
Freetrascrizioni è un progetto di Riccardo Zamboni. Vedi [LICENSE](LICENSE) e [NOTICE](NOTICE).
