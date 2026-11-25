# Architecture: gestionale ristorazione interno (ricostruzione delle funzioni di Passepartout Menu)

Data: 2026-11-25 · Input: `recon.md`, `features.csv` · Schema: `schema.sql` (testato su Postgres 16: 45 tabelle, vincoli verificati)

Requisito fisso di Benny: **le stampanti di produzione stampano la comanda, la cassa emette lo scontrino**, cioè il documento commerciale tramite registratore telematico (RT).

## Stack

| layer | choice | why |
| --- | --- | --- |
| **app di cassa** (PC touch Windows) | **Tauri 2**: app desktop Windows che contiene l'interfaccia React. Il **ponte** verso stampanti ed Epson è un piccolo modulo Rust (`tcp_send`, `http_post_xml`) | Un'app vera, a schermo intero e avviata col PC, che parla direttamente con Matchpower ed Epson in LAN. Niente mini‑PC dedicato. Installer leggero, con aggiornamenti automatici |
| **palmari e monitor cucina** (Android) | **Capacitor**: la stessa interfaccia React come app Android, installata da APK | Nessun costo di store. Vibrazione, schermo sempre acceso, suono. I palmari non stampano: mettono i lavori in coda e li stampa la cassa |
| back office | la stessa app anche come **sito web** (Vercel) | Incassi, prenotazioni e articoli si controllano da casa o dal telefono |
| interfaccia | React + Vite + TypeScript, Tailwind con i token di `design/` | Un solo codice per tre gusci (Windows, Android, web) |
| logica condivisa | pacchetto `core` in TypeScript: conti, divisioni, testo delle comande ESC/POS, XML Epson, interfaccia dati | Formattazione e calcoli si testano senza stampanti. Il Rust trasporta solo byte |
| database | **Postgres su Supabase** | Un solo database. RLS per locale, Realtime per sala e cucina, pg_cron per i job |
| auth | Supabase Auth (titolare, direttore, ogni dispositivo) + **PIN operatore** verificato lato server | Il cameriere cambia operatore col PIN, senza email e password |
| realtime | Supabase Realtime su `comande`, `righe_comanda`, `print_jobs`, `tavoli`, `prenotazioni` | Stato dei tavoli e kitchen monitor allineati su tutti i dispositivi |
| offline (fase 2) | l'app di cassa tiene una copia SQLite e fa da server LAN per i palmari | Se cade internet si continua a lavorare. Fase 1: router con backup 4G |
| pagamenti carte | Fase 1: POS fisico separato. Fase 3: Stripe (caparre, garanzia carta, ordini online) | Vedi "collegamento POS‑RT" più sotto: nessun cavo tra POS e cassa |
| fattura elettronica | XML generato da noi, invio tramite **intermediario SDI accreditato** via API | Firma, invio e conservazione sono servizi certificati e restano fuori dal clone |
| email / SMS | Resend (email). Provider SMS in fase 2 | Conferme, auguri, report pianificati |
| jobs | pg_cron + Supabase Edge Functions | Pulizia coda, sync portali, report, promemoria |
| build | GitHub Actions: installer Windows (.msi/.exe) e APK Android a ogni rilascio | Windows si compila su una macchina Windows, quindi su runner `windows-latest` |

Niente microservizi. Decisione del 25/11: **app, non sito** — cassa Windows (Tauri, con il ponte integrato), palmari Android (Capacitor), back office anche web.

### Hardware del Moorea (confermato da Benny il 25/11)

| stampante | marca | tipo nello schema | connessione | cosa stampa |
| --- | --- | --- | --- | --- |
| Cucina | Matchpower, non fiscale | `comande_escpos` | rete, TCP 9100 (da verificare) | comande di cucina, storni, marce |
| Bar | Matchpower, non fiscale | `comande_escpos` | rete, TCP 9100 (da verificare) | comande del bar (bevande, cocktail) |
| Preconto | Matchpower, non fiscale | `comande_escpos`, `per_preconto = true` | rete, TCP 9100 (da verificare) | preconti, letture, stampe di servizio |
| Cassa | Epson, **fiscale (RT)** | `rt_epson_xml` | rete, HTTP su fpmate.cgi | scontrino (documento commerciale), annulli e resi, chiusura giornaliera |

Tutte sono in rete: le pilota direttamente l'app di cassa sul PC Windows, niente cavi USB e niente mini‑PC.

**Primo collaudo, mezz'ora sul posto:**
1. Stampare il foglio di configurazione di ogni Matchpower (di solito si accende tenendo premuto FEED) e annotare IP, porta e set di caratteri.
2. Assegnare a ogni stampante un **IP fisso**, o una prenotazione DHCP sul router: se l'IP cambia, la comanda non esce.
3. Dal PC di cassa, inviare alla porta 9100 una riga di test ESC/POS con taglio carta. Se stampa e taglia, il driver comande è confermato. Se non risponde, si prova la modalità "raw" indicata sul foglio di configurazione.
4. Leggere il modello dell'Epson dall'etichetta (FP‑81 II RT o FP‑90 III RT: hanno lo stesso XML) e verificare dal browser che la pagina di stato dell'RT si apra al suo IP.
5. Chiedere al tecnico dell'RT l'elenco dei **reparti e delle aliquote** programmati, che servono per `aliquote_iva.reparto_rt`.

### Come esce la carta: comanda e scontrino

```
 Palmare / Cassa (PWA)                 Supabase (cloud)                  Ponte di cassa (LAN del locale)
 ─────────────────────                 ────────────────                  ───────────────────────────────
 [Invia] ── rpc invia_produzione ──▶  righe → 'inviata'
                                       invii_produzione (1 riga)
                                       print_jobs: 1 per centro ───────▶ Realtime / polling
                                         tipo='comanda'                  ponte_prendi_lavori()  (skip locked)
                                                                         ├─ Cucina  → ESC/POS su TCP 9100 → ✂
                                                                         └─ Bar     → ESC/POS su TCP 9100 → ✂
                                       print_jobs → 'stampato'  ◀─────── ponte_esito()

 [Scontrino] ─ rpc emetti_documento ▶  documenti 'in_emissione'
                                       print_jobs tipo='documento_commerciale' ─▶ RT Epson: XML su fpmate.cgi
                                                                              (o RT RCH: protocollo RCH/XON)
                                       documenti 'emesso' + n. Z/doc ◀── risposta RT (matricola, Z, n. doc)
                                       comanda 'chiusa', tavolo libero
```

**Stampanti comande (non fiscali).** Qualsiasi termica 80 mm di rete con ESC/POS sulla porta 9100: Epson TM‑T20/T88, oppure le RCH che possono fare anche da stampante comande. Ogni `centro_produzione` punta a una stampante, e in un invio ogni riga va al centro della sua categoria, o dell'articolo se è impostato diversamente. Il ticket stampa reparto, tavolo, coperti, cameriere, ora, numero comanda e le righe raggruppate per portata, con quantità in doppia altezza. Varianti e note vanno rientrate. Gli allergeni hanno una **fascia in negativo** ("!! CELIACO – GLUTINE !!"). Ci sono intestazioni dedicate per STORNO, MARCIA 2ª PORTATA e RISTAMPA.

**Scontrino (documento commerciale).** Lo emette sempre e solo l'RT. Il ponte gli manda gli articoli con il reparto IVA, gli sconti e i pagamenti, poi legge la risposta: numero di chiusura Z e numero del documento. Questi due numeri vengono salvati perché servono per fare annulli e resi.
- **Epson FP‑81 II RT / FP‑90 III RT**: c'è una guida pubblica Epson che descrive architettura, elementi e attributi XML del web service fpmate.cgi e della libreria JavaScript ePOS-print fiscal sviluppata per gli RT Epson. Lo si scrive seguendo quella guida ("ePOS Fiscal Print Solution Development Guide").
- **RCH Print!F**: ha un web server integrato sulla porta standard 80 e supporta i protocolli RCH, XON-XOFF, UPOS e JavaPOS, e può essere usata anche come stampante comande.
- Esiste già una libreria open source, il pacchetto npm `fiscal-printer`, che implementa Epson Fiscal ePOS-Print XML, Custom e RCH. Va valutata (licenza e qualità) prima di scrivere il client da zero.

**Collegamento POS‑RT (obbligo 2026).** Non serve nessuna integrazione software tra POS e cassa: il collegamento avviene esclusivamente tramite un'associazione informatica tra i numeri di matricola dei dispositivi, senza dialogo diretto o scambio dati in tempo reale tra i due strumenti. Si fa una volta sul portale "Fatture e Corrispettivi": si seleziona il registratore telematico dall'elenco delle matricole attive, si seleziona il POS da collegare e si indica l'indirizzo dell'unità locale. La sola cosa che il clone deve fare bene è registrare sullo scontrino il pagamento come **elettronico** quando si paga con la carta (campo `pagamenti.tipo_rt`).

## Schema

Tabelle: **45** (fase 1: 30, poi fidelity, magazzino, asporto e integrazioni). Accesso: **Postgres RLS** per locale e per gruppo (`mio_locale()`, `mio_gruppo()`). Le operazioni sensibili (invio, conto, storno, sconto, annullo, chiusura) passano solo da funzioni RPC, che controllano il permesso dell'operatore e scrivono nell'`audit_log`.

Vincoli che risolvono problemi a livello di database, non di interfaccia (testati):
- `comande_un_aperta_per_tavolo`: due palmari non possono aprire lo stesso tavolo due volte.
- `prenotazioni_no_sovrapposizione` (exclusion constraint con gist): niente doppia prenotazione sullo stesso tavolo nella stessa fascia.
- `idempotency_key` univoca su `invii_produzione`, `print_jobs` e `documenti`: un doppio tap o una rete lenta non stampano due comande né emettono due scontrini.
- `documenti_rt_unico` (matricola, Z, numero): un documento fiscale non può esistere due volte.
- Trigger `documenti_immutabili`: uno scontrino emesso non si modifica e non si cancella, si annulla con un nuovo documento.
- Soldi in centesimi più valuta, orari `timestamptz` in UTC, `giorno_servizio` calcolato con l'ora di cambio giornata (05:00): il conto delle 01:30 appartiene alla sera prima.

Tabelle per area:
- **Organizzazione**: gruppi, locali, membri, operatori, dispositivi.
- **Hardware**: stampanti, aliquote_iva (con reparto RT), centri_produzione.
- **Sala e catalogo**: listini, sale, tavoli, categorie, articoli, prezzi_listino, varianti, articolo_varianti, menu_componenti.
- **Clienti**: clienti, prenotazioni, lista_attesa.
- **Servizio**: comande, invii_produzione, righe_comanda, print_jobs.
- **Cassa**: documenti, righe_documento, pagamenti, sospesi, chiusure, audit_log.
- **Fase 2+**: promozioni, carte_fidelity, movimenti_fidelity, campagne, fornitori, mag_articoli, scorte, distinte, movimenti_magazzino, righe_movimento, ordini_acquisto, slot_asporto, rider, consegne, integrazioni.

## API

RPC = funzione Postgres chiamata con `supabase.rpc()`, transazionale. EF = Edge Function. PONTE = endpoint HTTP del ponte, raggiungibile solo in LAN.

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| EF POST /operatore/sessione | Verifica il PIN e rilascia una sessione operatore breve | dispositivo | pin | operatore, permessi, scadenza | tutti |
| RPC apri_tavolo | Apre la comanda sul tavolo (fallisce se è già aperto) | cameriere | tavolo_id, coperti, prenotazione_id? | comanda | F01 F03 |
| RPC aggiungi_righe | Aggiunge articoli con varianti, note e portata. Copia prezzo, IVA, allergeni e centro | cameriere | comanda_id, version, righe[] | righe, version | F01 |
| RPC invia_produzione | Invia tutto o una portata. Crea un `invio` e un print_job per centro di produzione | cameriere | comanda_id, portata?, idempotency_key | invio_id, jobs[] | F01 F06 |
| RPC marcia | Fa partire una portata in attesa (stampa "MARCIA") | cameriere | comanda_id, portata, key | invio_id | F01 |
| RPC storna_riga | Storna con motivo. Se la riga era già inviata, stampa uno STORNO in cucina | responsabile | riga_id, motivo, key | riga | F01 |
| RPC aggiorna_stato_riga | In preparazione / pronta / servita (kitchen monitor) | cucina, bar | riga_ids[], stato | — | F06 |
| RPC messaggio_produzione | Messaggio libero da cucina a sala o viceversa (anche stampato) | tutti | centro_id, testo | — | F06 |
| RPC sposta_comanda | Sposta la comanda su un altro tavolo | cameriere | comanda_id, tavolo_id | comanda | F01 |
| RPC unisci_comande | Unisce due tavoli in una comanda | cameriere | da_id, a_id | comanda | F01 |
| RPC trasferisci_righe | Sposta righe tra comande | cameriere | riga_ids[], comanda_id | — | F01 F02 |
| RPC preconto | Stampa non fiscale del conto, stato preconto | cameriere, cassiere | comanda_id, key | job | F01 |
| RPC emetti_documento | Crea il documento (intero, alla romana, per righe o per posto) e lo mette in coda all'RT | cassiere | comanda_id, quota, righe?, pagamenti[], tipo, cliente_id?, lotteria?, key | documento (in_emissione) | F01 F02 F13 |
| RPC annulla_documento | Documento commerciale di annullo o reso, riferito a Z e numero dell'originale | responsabile | documento_id, motivo, righe?, key | documento | F01 |
| RPC riapri_conto | Riapre una comanda dopo un annullo | responsabile | comanda_id | comanda | F01 |
| RPC ristampa | Ristampa una comanda o un preconto (marcato RISTAMPA). Non vale per gli scontrini | cameriere | job_id | job | F01 |
| RPC ponte_prendi_lavori | Il ponte prende i lavori in coda (`for update skip locked`) | ponte | stampante_ids[], max | jobs[] | F01 |
| RPC ponte_esito | Il ponte registra l'esito. Per gli RT salva matricola, Z, numero e ora, poi chiude documento e comanda | ponte | job_id, ok, esito | — | F01 |
| RPC ponte_heartbeat | Il ponte segnala lo stato suo, delle stampanti e dell'RT (carta, coperchio, rete) | ponte | stato | — | tutti |
| RPC chiusura_giornaliera | Verifica che non ci siano conti aperti, calcola i totali, mette in coda la chiusura fiscale sull'RT | responsabile | giorno, key | chiusura | F11 |
| RPC lettura_x | Lettura giornaliera non fiscale | cassiere | stampante_id | job | F11 |
| RPC fattura_sospesi | Fattura differita riepilogativa di sospesi o buoni pasto | direttore | cliente_id, sospesi[] | documento | F16 |
| EF POST /fattura/xml | Genera l'XML FatturaPA di un documento | cassiere | documento_id | xml | F13 |
| EF POST /fattura/invia | Invia all'SDI tramite l'intermediario | direttore | documento_id | stato_sdi | F13 |
| REST tabelle (RLS) | CRUD su sale, tavoli, categorie, articoli, listini, varianti, stampanti, centri, operatori, clienti | direttore | — | — | S04 S27–S31 |
| RPC crea_prenotazione | Crea una prenotazione (il vincolo blocca le sovrapposizioni) | cameriere | dati | prenotazione | F03 |
| RPC cambia_stato_prenotazione | Arrivata, mancata, cancellata, con penale no‑show | cameriere | id, stato | — | F03 |
| RPC lista_attesa_* | Aggiungi, notifica, fai sedere | cameriere | — | — | F05 |
| EF POST /pubblico/prenota | Widget web pubblico, con rate limit e captcha | pubblico | dati, slot | richiesta | F04 |
| EF POST /camera/addebita | Addebita il conto sul folio del gestionale hotel interno | cassiere | comanda_id, camera | ok | F14 |
| RPC report_* | Incassi per giorno, sala, operatore, articolo, IVA | direttore | filtri | righe | S25 |

Rotte: **31** (fase 1: 23).
PONTE in LAN (fase 2, ripiego quando internet cade): `GET /stato`, `POST /stampa` (comanda diretta con coda locale SQLite), `POST /rt/documento`.

Webhooks in:
- intermediario SDI, notifiche su `stato_sdi`;
- Stripe (fase 3) per caparre e ordini online;
- portali di prenotazione, solo con API ufficiali.

Webhooks out: gestionale hotel per l'addebito in camera.

Jobs:
- `coda_bloccata` ogni minuto: allarme se un print_job resta "in_coda" o "preso" per più di 60 s.
- `noshow` ogni 5 minuti: segnala le prenotazioni confermate in ritardo di 15 minuti.
- `sync_portali` ogni 5 minuti (fase 2).
- `report_pianificati` alle 06:00.
- `auguri_compleanno` alle 10:00.
- `pulizia_print_jobs` di notte (archivia oltre 90 giorni).

## The parts that bite

- **Doppio scontrino (il rischio n. 1).** Il ponte manda l'XML all'RT, l'RT stampa, ma la risposta si perde (rete o timeout). Se il ponte riprovasse, verrebbero emessi due documenti fiscali. Regola: **i lavori fiscali non si riprovano mai in automatico**. Vanno in `da_verificare`, il ponte chiede all'RT il numero dell'ultimo documento e riconcilia. Le comande di cucina invece si possono riprovare, con la scritta RISTAMPA.
- **Idempotenza.** Ogni tap su Invia o Scontrino genera una chiave sul dispositivo. Con la rete lenta e il cameriere che ripreme, il database la rifiuta la seconda volta.
- **Concorrenza tra palmari.** Due camerieri sullo stesso tavolo: `version` sulla comanda (lock ottimistico) più indice univoco sulla comanda aperta. Il secondo vede "il tavolo è stato modificato, ricarico".
- **Internet giù.** L'RT continua a funzionare da solo: memorizza i corrispettivi e li trasmette dopo. In fase 1 l'app invece richiede internet, quindi serve un **router con backup 4G** (circa €100), la soluzione più economica. In fase 2 il ponte riceve comande e scontrini direttamente in LAN e sincronizza dopo. L'offline completo sui palmari si fa solo se serve davvero.
- **Stampante senza carta o spenta.** Il ponte legge lo stato. La cassa e il palmare mostrano subito "Cucina: carta finita", e il job resta in coda e riparte quando si risolve.
- **Reparti IVA.** Ogni aliquota corrisponde a un reparto programmato sull'RT (`aliquote_iva.reparto_rt`). Se non coincidono, i corrispettivi trasmessi risultano sbagliati: va verificato una volta con il tecnico dell'RT.
- **Arrotondamenti.** Nella divisione alla romana i centesimi di resto vanno sull'ultimo conto. Gli sconti si calcolano per riga e si arrotondano a 0,01 €.
- **Fuso e giornata di servizio.** UTC nel database. Il "giorno" di un incasso dipende da `ora_cambio_giornata`. Attenzione al cambio dell'ora legale.
- **Realtime.** Al riavvio un client riprende lo stato completo prima di ascoltare gli eventi, per non perdere messaggi durante la disconnessione. Il kitchen monitor si ricarica da solo ogni notte.
- **Allergeni.** La lista UE è un vincolo nel DB. L'allergene del cliente o della prenotazione viene copiato sulla comanda e stampato in evidenza: se va perso c'è un rischio sanitario, non è solo un bug.
- **Sicurezza.** I PIN sono salvati come hash. Il ponte usa un account dispositivo con soli permessi sulla coda. Nessun dato carta passa mai dal sistema. Le chiavi delle integrazioni stanno in Supabase Vault.
- **GDPR.** Consenso marketing con data. La cancellazione di un cliente lascia i documenti fiscali, con cliente anonimizzato.

## Build order

1. **Fetta verticale (circa 2 settimane)**, brutta ma vera: login dispositivo e PIN (S01), sala con 5 tavoli (S03), apertura tavolo (S05), comanda con 10 articoli (S06), Invia → **ticket stampato in cucina**, conto unico → **scontrino stampato dall'RT** con salvataggio di Z e numero (S13, S15), tavolo libero.
   Tabelle: locali, membri, operatori, dispositivi, stampanti, aliquote_iva, centri_produzione, sale, tavoli, categorie, articoli, prezzi_listino, listini, comande, invii_produzione, righe_comanda, print_jobs, documenti, righe_documento, pagamenti.
   Rotte: operatore/sessione, apri_tavolo, aggiungi_righe, invia_produzione, emetti_documento, ponte_prendi_lavori, ponte_esito.
   Ponte: driver ESC/POS per le 3 Matchpower (cucina, bar, preconto) e driver Epson fpmate.cgi per l'RT. Il driver RCH resta per altri locali.
2. **Must‑have (fase 1):**
   - varianti e note (S07), portate e marcia (S10), storni, kitchen monitor (S11), sposta e unisci (S16);
   - conto diviso e più pagamenti (S14), preconto, fattura immediata con XML (S15, S20), annulli e resi, sospesi (S24);
   - chiusura giornaliera (S23), editor sale (S04), anagrafica articoli, listini, centri, operatori e configurazione fiscale (S27–S31);
   - prenotazioni base (S17–S19), allergeni end‑to‑end, statistiche essenziali (S25), backup.
   - Test sul campo: una settimana in parallelo alla cassa attuale.
3. **Should‑have:**
   - fase 2: lista d'attesa e widget prenotazioni con caparra (S46, S47), CRM e fidelity (S20–S22), report pianificati, audit (S26), ponte con ripiego LAN, invio SDI tramite intermediario, addebito camera (S48);
   - fase 3: magazzino e food cost (S32–S37), asporto (S38, S39), QR al tavolo (S43).
4. **Could‑have, poi le migliorie** che `/replica-entrepreneur` troverà nelle recensioni:
   - delivery e rider (S40, S41), totem (S45), multi locale e BI (S51, S52), funzioni AI (S53).

## Da sapere prima di iniziare (domande per Benny)

- ~~Che RT c'è?~~ Epson fiscale, in rete. Manca solo il modello esatto dall'etichetta.
- ~~Che stampanti comande?~~ 3 Matchpower non fiscali in rete: cucina, bar, preconto.
- **IP delle 4 stampanti**, e se sono fissi.
- **Il contratto di assistenza dell'RT** permette di collegarci un software terzo? Di solito sì, ma il tecnico deve programmare reparti e IVA.

## Fonti

- Epson, manuali per gli RT FP‑81 II / FP‑90 III (fpmate.cgi, Fiscal ePOS‑Print XML, XON/XOFF): https://www.scontrinosmart.it/en/fp81ii/documents
- Epson, ePOS Fiscal Print Solution Development Guide: https://download4.epson.biz/sec_pubs/bs/pdf/ePOS%20Fiscal%20Print%20Solution%20Development%20Guide%20Rev%20T.pdf
- RCH Print!F, configurazione (web server porta 80): https://www.spiagge.it/supporto-gestionale/docs/guida-configurazione-stampante-rch-printf-fiscale-e-non-fiscale/
- RCH Print!F, scheda tecnica (protocolli RCH, XON-XOFF, uso come stampante comande): https://cincotti.altervista.org/wp-content/uploads/2019/05/PRINT-F_2018_02-vr00-1.pdf
- Libreria npm fiscal-printer: https://github.com/lyancoder/fiscal-printer
- Collegamento POS‑RT 2026: https://agendadigitale.eu/documenti/collegare-pos-e-registratore-telematico-istruzioni-per-luso e https://quifinanza.it/fisco-tasse/pos-collegato-registratore-cassa-obbligo-sanzioni/960520/amp/
