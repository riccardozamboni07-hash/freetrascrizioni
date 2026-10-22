# Astra Note – app pubblica

La stessa app, ma con **registrazione e accesso** (email e password oppure Google): ogni utente ha il suo archivio separato e un limite di ore a settimana. La chiave Groq è una sola, la tua.

## Impostazioni
| Nome | Tipo | Cosa fa |
|---|---|---|
| `MULTIUTENTE` | variabile (già in `wrangler.jsonc`) | `si` = app pubblica |
| `ORE_SETTIMANA_UTENTE` | variabile | ore di trascrizione a settimana per utente (ora 0 = nessun limite settimanale, c'è quello giornaliero) |
| `ORE_GIORNO_UTENTE` | variabile (in `wrangler.jsonc`) | ore di trascrizione al giorno per utente (ora 1.5; 0 = nessun limite) |
| `ORE_GIORNO_TOTALE` | variabile (in `wrangler.jsonc`) | tetto di ore al giorno per tutta l'app (ora 7.5, sotto le 8 h gratis di Groq). Oltre le ~1 h 55 min nella stessa ora l'app mette in pausa le trascrizioni e riprende da sola all'ora successiva |
| `TOKEN_GIORNO_UTENTE` | variabile (in `wrangler.jsonc`) | limite giornaliero dell'AI per utente (ora 95000 = 380000 diviso 4 utenti, circa 3 appunti) |
| `TOKEN_GIORNO_TOTALE` | variabile (in `wrangler.jsonc`) | tetto giornaliero dell'AI per tutta l'app (ora 380000; 0 = nessun tetto) |
| `GROQ_API_KEY` | segreto | la tua chiave Groq (meglio a pagamento, con un tetto di spesa) |
| `CODICE_INVITO` | segreto, facoltativo | se c'è, per registrarsi serve questo codice |
| `ADMIN_EMAIL` | segreto | email (anche più di una, separate da virgola) che vedono il **Pannello amministratore** nel profilo |
| `CONTATTO_EMAIL` | segreto, facoltativo | email mostrata in Privacy e Condizioni (altrimenti la prima di `ADMIN_EMAIL`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | segreti | accesso con Google |

## Pubblicazione
Cloudflare → Workers & Pages → Create → Import a repository → `freetrascrizioni`, nome `freetrascrizioni-app`, comando di deploy `npx wrangler deploy --env pubblica`.

## Google
Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
URI di reindirizzamento autorizzato: `https://<indirizzo-app>/auth/google/callback`.

## Privacy e condizioni
Le pagine `/privacy` e `/condizioni` sono una base di partenza: leggile e, prima di farla pagare, falle controllare da un esperto.
