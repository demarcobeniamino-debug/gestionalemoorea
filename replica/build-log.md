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

## 2026-11-27 — Proforma ed Elimina conto (v0.7.3)
- Proforma (Conto → "Proforma", o Tavolo → "Proforma"): per famiglia, amici, staff. Il conto si chiude senza scontrino e senza incasso, ma i piatti restano consumati e i prodotti escono dal magazzino (scarico ricette). Motivo (Famiglia, Amici, Staff, Ospite della casa, Fornitore, Altro), "per chi" facoltativo, foglio non fiscale "PROFORMA · NON INCASSATO" sulla stampante del preconto se richiesto; PIN del responsabile se lo fa un cameriere. In Cassa: "Proforma (non incassati)" con numero, valore ed elenco, fuori dall'incasso e dal conto medio; salvati anche con la chiusura. DB 0014 `comande.proforma` + `chiudi_proforma` (audit `proforma`).
- "Annulla conto" diventa "Elimina conto" ed è anche nel Conto, accanto a Proforma (oltre che nel menu del tavolo). Motivi: Aperto per errore, Prova, Clienti andati via, Conto doppio, Altro. In Cassa: "Conti eliminati".
- Test: 49 unitari; e2e verdi (prova-annulla con proforma dal conto); chiudi_proforma provato sul database in transazione annullata.

## 2026-11-27 — Banco/asporto e tavoli uniti (v0.7.4)
- Banco / Asporto (pulsante in sala): un conto senza tavolo né coperti in un tocco, nome facoltativo. In comanda "Incassa" manda in cucina/bar quello che va preparato e porta al pagamento. I conti al banco ancora aperti restano come chip sopra la piantina. Comanda, conto, monitor cucina e ticket mostrano "Banco · Marco" / "Asporto · Luca".
- Unisci tavoli: dalla sala ("Unisci tavoli", tocchi i liberi, "Apri insieme", coperti = posti totali) o dal tavolo (aggiungi liberi, oppure porta qui un tavolo già aperto, che resta occupato e unito). I tavoli uniti risultano occupati ("con 2"), portano allo stesso conto, ticket e titoli "Tavoli 2+4+8"; si separano uno a uno. DB 0015 `comande.tavoli_uniti`, `unisci_tavoli`, `separa_tavolo`, trigger che impedisce di aprire un tavolo unito.
- Corretto: "Conti eliminati" non conta più i conti assorbiti da un'unione.
- Test: 51 unitari; e2e verdi (nuova `prova-banco`); unisci/separa provati sul database in transazione annullata. Versione mobile da rifare (prossimo lavoro).

## 2026-11-27 — Cassa completa, Epson robusto, mobile (v0.8.0)
- Epson RT: lettura stato (carta, giornale, giornata, Z da fare, invii all'Agenzia in attesa/rifiutati, scadenza certificati, firmware) e orologio ogni 5 minuti dalla cassa; errori FPMate tradotti; FP_NO_ANSWER/LAN_TIME_OUT trattati come "da verificare" (mai ristampa automatica); codice lotteria (printRecLotteryID); Z con timeout lungo; impostazione orologio a giornata chiusa. Collaudo guidato in Gestione → Stampanti (stato, orologio, non fiscale, scontrino 0,10 €, annullo, Z).
- Cassa spenta: battito della cassa ogni 30 s (DB 0016 `ponti_stampa`, `battito_ponte`); fascia rossa sui palmari se nessuna cassa stampa; lavori fermi da più di 10 minuti diventano "sospesi" e si decide dalla cassa (stampa/scarta; lo scontrino scartato libera il conto). `decidi_lavoro`.
- Conto: metodi da Gestione (Satispay…), buoni pasto per emittente, sospeso al cliente, addebito in camera, caparra, pagamento in più modi, codice lotteria. Cassa: schede Cassetto (fondo, versamenti, prelievi, conteggio, contante atteso, apri cassetto), Sospesi (incasso successivo), Caparre; fattura riepilogativa su più scontrini.
- Gestione → Cassa: Pagamenti, Promozioni (happy hour), Menu fissi e abbinamenti. Comanda: scelta del menu fisso, consigli di abbinamento; stornando un menu si stornano i piatti.
- Menu allineato a Passepartout: 58 articoli aggiunti (amari, grappe, calici, Coravin, tapas, pasta, secondi, cocktail, serate ed eventi), prezzi corretti (San Pellegrino, Elephant, vitello tonnato, carpaccio), 323 attivi.
- Telefono: sala a griglia grande con barra in basso (Banco, Unisci, Prenotati, Altro), testata senza sbordare, conto scorrevole.
- Confronto completo con Menu: `replica/gap-passepartout.md`.
- Test: 58 unitari; e2e verdi (11 prove, nuove `prova-epson`, `prova-cassa`; `prova-banco` anche su telefono).

## 2026-11-27 — Reso parziale, ristampa, export, comande compatte (v0.8.1)
- Comande: tutto maiuscolo e più compatte. Tavolo grande, piatti alti ma non larghi (niente più righe spezzate), varianti e note subito sotto, portata come fascia nera senza righe vuote; interlinea 32. Anche marcia/sollecito/messaggi in maiuscolo.
- Reso parziale (Cassa → scontrino → Reso): righe e quantità a scelta, rimborso in contanti o sulla carta, documento REFUND con Z/numero/data/matricola dell'originale, più resi fino al totale; sconto ripartito in proporzione. Resi tolti dall'incasso e dai pagamenti nel riepilogo. DB 0017 `reso_documento` (audit `reso`).
- Ristampa comanda (Tavolo → Ristampa comanda): per reparto o tutti, solo piatti già mandati e non stornati, con "*** RISTAMPA ***".
- Per il commercialista (Cassa → Chiusure): CSV per Excel (punto e virgola, virgola decimale) con corrispettivi giorno per giorno (scontrini, contanti, elettronico, buoni, non riscosso, imponibile e IVA per aliquota, resi, annulli) ed elenco dei documenti; mese scorso o in corso.
- Corretto: la lettura dei documenti dal database trattava come scontrino ogni tipo diverso da annullo.
- Test: 61 unitari; e2e verdi (prova-cassa estesa con reso, CSV e ristampa).

## 2026-11-27 — Cassa senza internet, livello 2 (v0.8.2)
- La cassa installata salva sul disco una fotografia del servizio (listino, sale, conti aperti con righe e scontrini) a ogni cambiamento e controlla la linea ogni 10 s. Due controlli falliti: lavora da sola con la stessa logica della demo (`CassaOffline`), stampa comande e scontrini sulla rete del locale, fascia arancione "Senza internet". PIN: solo chi è già entrato su quella cassa (impronta SHA-256 sul dispositivo).
- Ritorno della linea (due controlli riusciti): manda solo il nuovo/cambiato (`datiDaSincronizzare`) con DB 0018 `importa_offline` (idempotente: conti con il primo numero libero, righe, righe tolte, scontrini già emessi con numeri RT, sospesi e caparre dal trigger, scarico magazzino, movimenti, chiusure, audit `sync_offline`). Nessuna ristampa, nessuno scontrino ripetuto. Riavvio senza linea: riprende dallo stato salvato; riavvio con linea: prima sincronizza.
- Senza linea non si fanno: caparre, incasso sospesi, fatture, clienti, impostazioni, Gestione.
- Test: 62 unitari (nuovo "cassa senza internet"); importa_offline provato sul database in transazione annullata (anche ripetuto due volte: nessun doppione).

## 2026-11-28 — POS collegato (v0.8.3)
- Protocollo 17 (ECR17) dalla documentazione pubblica Nexi "Traditional POS – LAN integration": richiesta 'P' da 167 caratteri (terminale, cassa, importo in centesimi), esito 'E'/'V' (approvato con carta mascherata, tipo lettura, autorizzazione, tipo carta; rifiutato con motivo). Cornice STX/ETX/LRC (XOR da 0x7F); se il POS risponde NAK la cassa prova l'altra variante dell'LRC e la ricorda (COLLAUDO).
- Ponte Rust `pos::scambio` (comando Tauri `pos_scambio`): richiesta → ACK → avanzamenti ignorati → esito → ACK; NON_INVIATO si può riprovare, INCERTO chiede a chi incassa se il POS ha approvato. 3 test con POS finto.
- Gestione → Pagamenti → POS: UniCredit collegato (192.168.178.88:10000, terminale 31197403, "Accetta American Express"), FlatPay a mano ("per Amex usa UniCredit") già impostati per il Moorea. Al conto, Carta → scelta del POS; con quello collegato l'importo va al POS e lo scontrino esce appena approva ("Carta UniCredit" sul documento). Solo dalla cassa installata; telefoni e FlatPay a mano.
- Test: 64 unitari; e2e prova-cassa con POS simulato.

## v0.8.4
- IP con zeri davanti (es. 192.168.178.038) ora funziona: il ponte e il salvataggio li tolgono.
- v0.8.5: "invii rifiutati" dell'Epson trattato come contatore storico: avviso rosso solo se cresce.
