# Freetrascrizioni

La tua app personale per **trascrivere le lezioni**, anche di 2 ore, in pochi minuti — da iPhone, Android o computer.

- **Trascrizione veloce** con Whisper (tramite Groq), oppure **sul dispositivo** senza internet
- **Scegli la materia** prima di trascrivere: i termini tecnici vengono riconosciuti meglio
- **Archivio delle lezioni** diviso per materia, con filtri, ricerca, i tuoi appunti e **download di tutti gli appunti di una materia**
- Pulsanti per **correggere la trascrizione** o farne **appunti con Claude**, con istruzioni adatte alla materia e gli appunti delle lezioni precedenti
- **Flashcard** a risposta multipla create dalla lezione: punteggio finale, risposte sbagliate con quella corretta, salvate nell'archivio
- **Tutto nei tuoi account**: nessuno, nemmeno chi ti ha installato l'app, vede le tue lezioni

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
17. Tocca **"Prova con l'esempio"** per controllare che tutto funzioni.

## Domande frequenti

- **Quanto costa?** Niente, finché resti nei limiti gratuiti di Groq (~8 ore di audio al giorno, 2 all'ora) e Cloudflare.
- **Chi vede le mie lezioni?** Solo tu: sono salvate nel tuo account Cloudflare.
- **Ho dimenticato la password.** Su Cloudflare: [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → freetrascrizioni → Settings → Variables and Secrets → modifica `PASSWORD`.

---
Freetrascrizioni è un progetto di Riccardo Zamboni. Vedi [LICENSE](LICENSE) e [NOTICE](NOTICE).
