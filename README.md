# Spartiti

Web-app leggera (HTML + JS, niente framework) per leggere e scrivere spartiti da Google Drive
su un tablet vecchio (Firefox 68, Android 4.4). Gira **solo sul tablet**: non serve il PC.

- Sfoglia le cartelle di Drive, cerca per nome, carica file (⇧) nella cartella aperta
- Google Docs leggibili (A−/A+) e modificabili (✎ → Salva)
- I link nei Doc verso file/cartelle/Doc di Drive si aprono dentro l'app
- PDF visualizzati nell'app (pdf.js), anche in modalità scura
- **⬇ Offline**: scarica la cartella o il Doc aperto, **più tutto ciò che è linkato dentro**
  (anche se sta in altre cartelle). Poi funziona senza Wi‑Fi.
- Tema chiaro/scuro (◐)
- Schermo intero: parte da solo al primo tocco dopo l'apertura (Firefox non lo permette senza un tocco).
  Il pulsante ⛶ passa fra: normale → intero → intero senza barra (☰ in alto a destra la fa riapparire).
  La scelta viene ricordata; per non averlo più all'avvio, torna a "normale" con ⛶.

## Pubblicazione (una volta)
L'app deve stare su un indirizzo HTTPS (serve per il funzionamento offline). Si usa GitHub Pages:
si pubblica solo il codice; i file restano nel tuo Drive e non passano da nessun server.

1. Repo pubblico `spartiti` con questi file, GitHub Pages attivo sul branch `main`.
   Indirizzo: `https://araleslump73.github.io/spartiti/`
2. **Client ID Google** — https://console.cloud.google.com
   - nuovo progetto → *API e servizi → Libreria* → abilita **Google Drive API**
   - *Schermata consenso OAuth*: Esterno; aggiungi il tuo account Gmail fra gli **utenti di test**
   - *Credenziali → Crea credenziali → ID client OAuth → Applicazione web*
     - Origini JavaScript autorizzate: `https://araleslump73.github.io`
     - URI di reindirizzamento autorizzati: `https://araleslump73.github.io/spartiti/` (con la `/` finale)
   - copia l'ID client in `config.js` e ripubblica
3. Sul tablet, in **Firefox**: apri l'indirizzo, accedi, poi menu → *Pagina → Aggiungi a schermata Home*.

## Note
- Il login dura un'ora; poi si rinnova da solo quando sei online (Firefox resta collegato a Google).
  Offline non serve: i file scaricati si aprono comunque.
- Le copie offline stanno nel browser: **non cancellare i dati di Firefox** per questo sito.
  Per aggiornarle: *Scaricati per l'offline → Aggiorna* (oppure riapri il Doc da online: si aggiorna da solo).
- La modifica di un Doc passa da HTML: tabelle o impaginazioni complesse possono cambiare.
  Drive conserva comunque la cronologia versioni (File → Cronologia versioni).
- Permesso richiesto: accesso completo a Drive (serve per sfogliare, caricare e modificare).

## Licenze
`pdfjs/` contiene pdf.js 2.6.347 (Mozilla, Apache 2.0, vedi `pdfjs/LICENSE`).
Usato con `isEvalSupported:false` per chiudere la vulnerabilità nota delle versioni vecchie.
