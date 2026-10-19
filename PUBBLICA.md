# Freetrascrizioni – app pubblica

La stessa app, ma con **registrazione e accesso** (email e password oppure Google): ogni utente ha il suo archivio separato e un limite di ore a settimana. La chiave Groq è una sola, la tua.

## Impostazioni
| Nome | Tipo | Cosa fa |
|---|---|---|
| `MULTIUTENTE` | variabile (già in `wrangler.jsonc`) | `si` = app pubblica |
| `ORE_SETTIMANA_UTENTE` | variabile | ore di trascrizione a settimana per utente (predefinito 10) |
| `TOKEN_GIORNO_UTENTE` | variabile | limite giornaliero dell'AI per utente (predefinito 150000) |
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
