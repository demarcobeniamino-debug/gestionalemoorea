# Build log

Decisione del 25/11: **app, non sito.** Cassa su PC touch Windows (Tauri, con il ponte stampanti dentro), palmari Android (Capacitor), back office anche web.
**25/11 pomeriggio: collegata a Supabase.** Due modalità: *locale* (database vero, tempo reale) e *demo* (dati in memoria). Le operazioni delicate sono funzioni del server, idempotenti e testate su Postgres locale e sul progetto.

| ID | data | stato | cosa manca | più difficile del previsto |
| --- | --- | --- | --- | --- |
| core | 2026-11-25 | fatto | — | Code page delle Matchpower: PC858 è un'ipotesi, si conferma al collaudo. Separatore decimale dell'Epson (`,` o `.`) configurabile, da confermare |
| ponte (Rust) | 2026-11-25 | fatto | collaudo su hardware vero | Distinguere "non inviato" da "inviato ma risposta persa": è quello che evita il doppio scontrino |
| S01 Accesso | 2026-11-25 | parziale | PIN verificati lato server (hash), blocco persistente | — |
| S03 Sala | 2026-11-25 | parziale | prenotati (servono le prenotazioni), editor sale (S04), tempo reale tra dispositivi | — |
| S05 Apertura tavolo | 2026-11-25 | fatto | — | — |
| S06 Comanda | 2026-11-25 | parziale | pulsante "marcia" per singola portata, sposta/unisci tavoli (S16), menu composti (S08), vendita a peso (S09) | Tocco lungo vs tocco: servono pointer events + tasto destro + tastiera |
| S07 Varianti e note | 2026-11-25 | fatto | gruppi di varianti obbligatori | — |
| S10 Invio produzione | 2026-11-25 | parziale | marcia da interfaccia | — |
| S11 Cucina | 2026-11-25 | fatto | suono all'arrivo, messaggi sala↔cucina | — |
| S13–S15 Conto e pagamento | 2026-11-25 | parziale | divisione per piatti/posto, più metodi sullo stesso scontrino da UI, sconti, fattura | Quote alla romana con IVA diverse: ripartite per reparto, resto sull'ultima |
| Storno | 2026-11-25 | fatto | — | — |
| Preconto | 2026-11-25 | fatto | — | — |
| /design | 2026-11-25 | fatto | — | — |

Verifiche:
- 20 test del core (vitest), compreso il flusso completo, guasto stampante e risposta Epson persa;
- 6 test del ponte Rust contro stampanti/Epson finti in TCP;
- flusso end-to-end in Chrome (cassa 1280×800 e palmare 390×844), zero errori in console;
- guscio Tauri: `cargo check` ok su Linux; l'installer Windows si costruisce in GitHub Actions (non compilabile qui).

Screenshot in `replica/clone-screens/`.

## 25/11: database collegato e rifinitura design

| cosa | stato | note |
| --- | --- | --- |
| Funzioni server (PIN, apri tavolo, invio, storno, preconto, incasso, coda stampa, esiti, inizializzazione) | fatto | testate su Postgres 16 locale e sul progetto Supabase (in transazione annullata) |
| App su Supabase (cache + Realtime, RPC, accesso dispositivo) | fatto, da collaudare | la prova end-to-end col database vero si fa al primo collegamento di Benny: la creazione di un account di prova direttamente nelle tabelle utenti è stata bloccata, giustamente |
| Solo la cassa stampa | fatto | coda presa con `for update skip locked`; un browser col database vero non stampa |
| Design: Geist, icone Phosphor, movimento (pressione 0.97, fogli dal basso, avvisi), categorie più calme, colonna "In sala adesso", stati vuoti | fatto | `/design-taste-frontend` applicata solo nelle parti valide per un gestionale; launcher di `/impeccable` non disponibile qui |
| Schermata per cambiare i PIN | da fare | i PIN iniziali (1111, 2222, 9999) vanno cambiati prima del servizio |

## 2026-11-26 — Pannello Gestione (v0.3.0)
- Gestione per i responsabili: Articoli (prezzo, IVA, reparto, allergeni, varianti, ricetta con food cost), Categorie (colore, reparto, uscita, ordine), Varianti, Sale e tavoli (pianta a trascinamento), Scorte, Movimenti (carico, scarico, scarto, inventario), Fornitori.
- Database: `registra_movimento` (RPC), scarico automatico dalle ricette alla chiusura del conto (`privato.scarica_vendita` da `esito_lavoro`), Realtime esteso a listino e sale.
- Archivio comune (`@gr/core/gestione`): in memoria per la demo, Supabase per il locale. Test: 26 unitari, e2e `scripts/prova-gestione.mjs` + `prova-flusso.mjs` verdi.
- Versione web su GitHub Pages (`.github/workflows/web.yml`).

## 2026-11-26 — Impostazioni stampanti (v0.4.0)
- Gestione → Stampanti: elenco, modifica (IP, porta, carta 58/76/80 mm, set di caratteri, matricola RT), reparti → stampante, stampante dei preconti.
- Ricerca automatica in rete (`ponte::scoperta`, comando Tauri `cerca_stampanti`): prova la /24 della cassa su 9100 (DLE EOT 1 per confermare ESC/POS, GS I 66/67 per marca e modello, comandi di sola lettura) e su 80 (fpmate.cgi → Epson RT, firma RCH). Provata con finte stampanti su 127.0.0.x (`cargo run --example prova_scoperta`).
- "Driver": nessun driver di sistema; il profilo (protocollo, porta, carta, set di caratteri) si imposta dal riconoscimento. "Prova caratteri" stampa la stessa riga in PC858/PC850/WPC1252/PC437 per scegliere quello giusto.
- Prove: stampa di prova ESC/POS con righello della carta; prova NON fiscale sull'Epson (`printerNonFiscal`, da confermare al collaudo).
- DB: `stampanti.codepage`, `stampanti.modello`. Test: 32 unitari TS, 9 Rust, e2e Gestione verde.

## 2026-11-27 — Prenotazioni da Moorea Table Flow (v0.5.0)
- Table Flow (Lovable, repo `moorea-table-tide`) resta il sistema delle prenotazioni. Aggiunte due rotte protette da `GESTIONALE_SYNC_SECRET`: `GET /api/public/gestionale/prenotazioni?dopo=` e `POST /api/public/gestionale/stato`.
- Gestionale: edge function `prenotazioni` (lettura a cursore + invio della coda), `importa_prenotazioni`, coda `prenotazioni_uscita` con trigger (tavolo aperto → seduto, primo invio → comanda presa, conto chiuso → completata, no show), `apri_tavolo(..., p_prenotazione)` che porta le allergie in comanda. Provato sul database in transazione annullata.
- Cassa: tavoli prenotati in sala, elenco prenotazioni (colonna e foglio sul palmare), apertura dalla prenotazione, scelta tavolo per chi non l'ha, no show. Sincronizzazione ogni minuto. Test 34 unitari, e2e `prova-prenotazioni.mjs` verde.

## 2026-11-27 — Pronto per il servizio (v0.6.0)
- Menu vero importato da mooreafoodclub.it/menu (`scripts/importa-menu.py` → `importa_menu()`): 265 articoli attivi, 17 categorie, varianti (cotture, senza glutine…), allergeni, coperto 2 €. Somma prezzi verificata col sito. Articoli tolti dal sito archiviati, non cancellati.
- Sale allineate a Table Flow: Matinee 1–12, Giardini 14–23, Mare 24–31 (24 e 31 da 4 posti).
- Servizio: sposta tavolo, unisci tavoli, sposta piatti su un altro conto; scheda del piatto con descrizione e allergeni; piatto finito ("86") su tutti i dispositivi.
- Conto: sconto in % o in euro; se non è un responsabile serve il PIN del responsabile, che resta scritto sul conto.
- Cassa e statistiche (`/cassa`, solo responsabili): incasso, coperti, conto medio, a coperto, tavoli aperti, pagamenti, per sala, per cameriere, piatti più venduti, categorie, incasso per ora/giorno (oggi, 7, 30 giorni); elenco scontrini con annullo (documento di annullo RT collegato); chiusura fiscale Z con totali salvati.
- Gestione → Personale: persone, ruoli, PIN (4–6 cifre, mai uguali), disattivazione.
- DB (0008, 0009): `importa_menu`, `sposta_comanda`, `unisci_comande`, `sposta_righe`, `operatore_salva`, `annulla_documento`, `chiusura_giornaliera`; `esito_lavoro` segna l'originale annullato e salva lo Z. Annullo e chiusura provati sul database vero in transazione annullata.
- Test: 38 unitari; e2e verdi `prova-flusso`, `prova-gestione`, `prova-prenotazioni` e nuovo `prova-servizio` (sposta → sconto con PIN → incasso 34,20 € → cassa → annullo → Z → personale).
