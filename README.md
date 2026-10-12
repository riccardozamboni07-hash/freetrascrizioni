# Freetrascrizioni

La tua app personale per **trascrivere le lezioni**, anche di 2 ore, in pochi minuti — da iPhone, Android o computer.

- **Trascrizione veloce** con Whisper (tramite Groq), oppure **sul dispositivo** senza internet
- **Archivio delle lezioni** diviso per materia, con ricerca e i tuoi appunti
- Pulsanti per **correggere la trascrizione** o farne **appunti con Claude**
- **Tutto nei tuoi account**: nessuno, nemmeno chi ti ha installato l'app, vede le tue lezioni

Usa i piani gratuiti di Cloudflare e Groq: con Groq gratis trascrivi circa **8 ore di audio al giorno**. Resta gratuita finché lo restano questi servizi.

## Installazione (circa 10 minuti)

Ti servono tre account gratuiti: **GitHub**, **Cloudflare** e **Groq**.

1. **Crea la chiave Groq**: vai su [console.groq.com](https://console.groq.com/keys), accedi, tocca **Create API Key** e copiala.
2. **Tocca il pulsante qui sotto** e accedi a Cloudflare (e a GitHub quando te lo chiede):

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/riccardozamboni07-hash/freetrascrizioni)

3. Quando Cloudflare chiede i valori:
   - **GROQ_API_KEY** → incolla la chiave Groq
   - **PASSWORD** → scegli la password per entrare nell'app
4. Tocca **Deploy**. Dopo un minuto ti dà l'indirizzo della tua app, del tipo `freetrascrizioni.tuonome.workers.dev`.
5. Aprilo sul telefono, inserisci la password e aggiungilo alla **schermata Home**.

## Aggiornamenti

Quando esce una nuova versione: nel tuo repository su GitHub apri **Actions → Aggiorna Freetrascrizioni → Run workflow**. Le tue lezioni e la password restano come sono.

## Domande frequenti

- **Quanto costa?** Niente, finché resti nei limiti gratuiti di Groq (~8 ore di audio al giorno, 2 all'ora) e Cloudflare.
- **Chi vede le mie lezioni?** Solo tu: sono salvate nel tuo account Cloudflare.
- **Ho dimenticato la password.** Su Cloudflare: Workers e Pages → il tuo Worker → Impostazioni → Variabili e segreti → modifica `PASSWORD`.

---
Freetrascrizioni è un progetto di Riccardo Zamboni. Vedi [LICENSE](LICENSE) e [NOTICE](NOTICE).
