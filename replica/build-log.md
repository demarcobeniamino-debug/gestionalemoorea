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

## 2026-11-27 — Comanda veloce, messaggi, clienti, fatture (v0.7.0)
- Voce libera: piatto fuori menu con nome, prezzo, reparto, portata e IVA scelti al volo; non crea articoli. Le ultime 8 restano sul dispositivo ("rifai con un tocco"). Dalla ricerca: scrivi "pasta al pomodoro" → Voce libera già compilata. Nelle statistiche finiscono sotto "Fuori menu".
- Comanda più veloce: ×2…×6 per il prossimo piatto; stesso piatto toccato due volte = quantità +1 (non righe doppie); − e + sulle righe non inviate; scheda "Più usati" (i piatti che il dispositivo usa di più).
- Marcia e Sollecita per portata, direttamente nel riepilogo: ticket MARCIA/SOLLECITO grande con tavolo e piatti, solo ai reparti coinvolti. Messaggi ai reparti (dal tavolo o dalla sala): frasi pronte o testo libero, a cucina, bar o tutti. Il monitor cucina mostra gli avvisi in alto (tocca = visto) ed evidenzia il tavolo con marcia/sollecito.
- Clienti: anagrafica (contatti, compleanno, allergie, preferenze, sconto abituale, dati per la fattura, consenso), Gestione → Clienti con storico (visite, spesa, piatti preferiti, fatture). Dal tavolo: "Cliente" collega o crea; le sue allergie passano al tavolo. Al conto: sconto abituale in un tocco.
- Fatture elettroniche FatturaPA (FPR12) dallo scontrino in Cassa: scorporo IVA per aliquota al centesimo (anche con sconto), controlli su intestatario e locale, numero progressivo dal server senza buchi, XML da scaricare (nome file SDI), copia di cortesia sulla stampante dei preconti. Gestione → Fatture: dati fiscali del locale, elenco, stato (da inviare / inviata / scartata / annullata). L'invio allo SDI resta manuale (Fatture e Corrispettivi o commercialista).
- Ruolo Cassa: entra in "Cassa" per fatture e statistiche; annullo e Z restano ai responsabili.
- Ottimizzazione: bundle iniziale da 978 kB a 211 kB (Gestione, Cassa e pagine rare caricate al primo uso; librerie in pezzi separati in cache).
- Design: testata della comanda che non taglia più il numero del tavolo, icone sole su telefono, barre di portata e quantità scorrevoli.
- DB 0010 `clienti_fatture_messaggi`: `righe_comanda.articolo_id` facoltativo, `locali.dati_fiscali`, `messaggi_reparto` (+ Realtime), `invia_messaggio`, `fatture`, `emetti_fattura`.
- Test: 44 unitari; e2e verdi `prova-flusso`, `prova-gestione`, `prova-prenotazioni`, `prova-servizio` e nuovo `prova-extra` (dati fiscali → ×3 → voce libera → cliente con allergia → marcia/sollecito → messaggio → monitor → incasso → fattura con XML verificato → schede).

## 2026-11-27 — Annulla conto e registro di cassa (v0.7.1)
- Annulla conto (Tavolo → Annulla conto): motivo (Prova, Aperto per errore, Clienti andati via, Offerto dalla casa, Altro), storno "conto annullato" a cucina e bar per i piatti già inviati (si può spegnere), PIN del responsabile se lo fa un cameriere. Non si può se c'è uno scontrino emesso o in stampa: prima si annulla quello dalla Cassa. Righe stornate e conto "annullato" restano nello storico; audit_log `annullo_conto`. DB 0011 `annulla_comanda`.
- Cassa in quattro schede: Riepilogo · Invio scontrini (stato RT, contatori, ogni invio con esito; "Verifica" per gli scontrini rimasti in dubbio: "è uscito" con numero Z/documento, oppure "non è uscito" e si rifà dal conto) · Chiusure (Z degli ultimi 60 giorni con numero, incasso, esito) · Fatture (da inviare con scadenza a 12 giorni, inviate, scartate, totale del mese).
- Corretto: con il PIN sbagliato l'annullo mostrava comunque il messaggio di riuscita.
- Test: 46 unitari; e2e verdi (6 prove, nuova `prova-annulla`); annulla_comanda provato sul database in transazione annullata.

## 2026-11-27 — Collaudo stampanti al locale (v0.7.2)
- Collaudo con Benny sulle Matchpower: comande, marcia, sollecito, messaggio, preconto e prova stampa escono, veloci.
- Corretto: il pallino delle stampanti restava rosso per un errore vecchio; ora conta l'ultima stampa (gli scontrini "da verificare" restano in evidenza). Messaggio d'errore leggibile al posto di "Cucina: undefined".
- "Offerto dalla casa" non è più uno storno: il piatto resta e si serve, vale 0 € (omaggio), nessun ticket al reparto; serve il PIN del responsabile se lo fa un cameriere; si può rimettere a pagamento. Il foglio dice il reparto giusto ("Bar riceve lo storno").
- Comande più leggibili: piatti in carattere doppio e grassetto, una riga vuota fra un piatto e l'altro, varianti e note in grassetto rientrate, portate come fascia nera ("PORTATA 1", "BEVANDE", "DESSERT"), interlinea più ariosa.
- Importati da Passepartout Menu: 11 clienti (P.IVA, SDI, PEC, indirizzo) e lo storico delle chiusure giornaliere dal 13/02/2026. Lavoro in corso (non ancora visibile): banco/asporto, sospesi e camera, cassetto, caparre, metodi di pagamento, promozioni, menu fissi (DB 0012–0013 già applicati).
