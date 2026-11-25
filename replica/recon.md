# Recon map: Passepartout Menu (desktop Windows/cloud + client iPad/Android + app satellite)

Scope: **tutte le funzioni** di Menu: soluzione base, moduli aggiuntivi e app satellite (Comanda Smart, Menu Point, Menu MySelf, Menu App, PassDelivery). Il piano di build (vedi "Size") le ordina in fasi, con il core loop per primo.
For: uso interno nei locali di Benny (Moorea Food Club come locale pilota), pensato per agganciarsi al clone di Passepartout Welcome (gestionale hotel interno) per l'addebito in camera.
Date: 2026-11-25
Metodo: clean-room, **solo fonti pubbliche** (brochure, store, guide di terze parti). Nessun account Passepartout usato, nessun codice, nessuna API privata. I manuali completi stanno su EduPass, dietro login riservato a clienti e partner, quindi non li ho letti. I nomi delle schermate tra virgolette sono quelli citati pubblicamente. Il resto è ricostruito ed è marcato come tale.
Nota termini: la licenza Passepartout vieta di norma il reverse engineering. Se Benny ha un account Menu (anche tramite rivenditore), prima di usarlo come riferimento va letto il contratto. Fino ad allora: solo fonti pubbliche.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Brochure ufficiale Menu (gen. 2026) | https://www.passepartout.net/Resources/Asset/Documenti/Prodotti/Brochure/Brochure-Menu-2026.pdf | La fonte più completa: base, moduli, app, integrazioni, AI |
| 2 | Pieghevole Menu (rivenditore SNG) | https://sng-group.it/storage/pieghevole-menu.pdf | Versione precedente: Cribis, PassDelivery, cloud |
| 3 | App Store: Passepartout Menu (client iPad) | https://apps.apple.com/us/app/id1090900135 | Client completo: sale, tavoli, comande, conti, magazzino, statistiche. Tablet ≥ 8" |
| 4 | App Store: Comanda Smart | https://apps.apple.com/it/app/passepartout-comanda-smart/id1091293386 | Presa comanda, conti, addebito su Welcome, nuovi clienti per fattura. Voto 2,9/5 |
| 5 | App Store: Menu Point | https://apps.apple.com/app/id6479317052 | Totem/chiosco/tablet al tavolo, ordine e pagamento in autonomia |
| 6 | App Store: Menu MySelf | https://apps.apple.com/us/app/id1250462571 | Ordine da QR al tavolo, chiama cameriere, chiedi conto, asporto/domicilio |
| 7 | App Store: PassDelivery | https://apps.apple.com/mx/app/passdelivery/id1555020336 | App rider, usa la geolocalizzazione |
| 8 | Guida integrazione Plateform ↔ Menu | https://intercom.help/plateform/it/articles/9163543-impostazioni-integrazioni-passepartout-menu-guida-completa | Nomi reali delle schermate: Gestione Sala, Indagine Prenotazione, Planning prenotazioni, Dettagli Conto, Portale ristorante |
| 9 | Manuale PassAnalytics HoReCa (pubblico) | https://www.edupass.it/StreamFile/Resources/Documenti/Manuali/pbi-horeca/PAN_horeca.pdf | BI su datamart; storicamente Menu gira su SQL Server |
| 10 | Le Fonti Awards 2025 | https://www.passepartout.net/azienda/eventi-e-news/photogallery/2025/le-fonti-awards | Esiste anche "Menu Delivery", versione senza coperti |
| 11 | Slashdot listing | https://slashdot.org/software/p/Passepartout-Menu/ | Elenco categorie funzionali (waitlist, staff, food cost) |
| — | Prezzi | non pubblici | Si vende tramite rivenditori. I moduli a pagamento (magazzino, asporto, AI, BI) indicano dove sta il valore |
| — | Changelog | note di versione sugli store | Solo bugfix. Server a versioni semestrali (2025E, 2026A) |

## Core loop

Il cameriere prende la comanda al tavolo (da palmare o cassa). La comanda parte verso i centri di produzione divisa per portate, la cucina la evade dal kitchen monitor e la cassa chiude il conto (unico o diviso) emettendo il documento fiscale tramite registratore telematico. A fine giornata, chiusura e statistiche.

## Screens

Le schermate S01–S24 formano la soluzione base. Da S25 in poi ci sono moduli e app.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Login operatore | avvio app / cambio operatore | Autenticazione con PIN o password, scelta locale | tastierino PIN, selettore locale | vuoto, errore PIN, utente bloccato |
| S02 | Home / cruscotto | dopo login | Accesso ai moduli e KPI del giorno | tile moduli, KPI coperti/incasso | ricostruita |
| S03 | Gestione Sala (piantina) | Home → Sala | Piantina interattiva, stato dei tavoli, cambio sala | canvas sala, tile tavolo, tab sale, legenda stati | libero, occupato, prenotato (blu), conto chiesto, sala vuota |
| S04 | Editor sale e tavoli | Configurazione → Sale | Disegno della sala: sfondo, tavoli, posti, listino per sala | canvas drag&drop, pannello proprietà | vuoto, in modifica, errore sovrapposizione |
| S05 | Apertura tavolo / coperti | tap su tavolo libero | Indica i coperti, associa cliente o prenotazione | stepper coperti, ricerca cliente | prenotazione da chiudere (prompt) |
| S06 | Presa comanda | tavolo aperto → Comanda | Inserimento articoli per categoria e portata | griglia categorie (colori/immagini), griglia articoli, righe comanda, selettore portata | vuota, piena, articolo esaurito, offline palmare |
| S07 | Varianti e note articolo | tap lungo su riga | Varianti +/- con prezzo, note libere, cottura | lista varianti, tastiera note | nessuna variante, prezzo variante |
| S08 | Menu fisso / degustazione | articolo di tipo menu | Scelta dei componenti di un menu composto | step per componente, contatore scelte | scelta incompleta |
| S09 | Vendita a peso / quantità | articolo a peso | Inserimento di peso o quantità e unità di misura | tastierino, lettura bilancia | bilancia scollegata |
| S10 | Invio in produzione / portate | Comanda → Invia | Invio totale o per portata ("marcia"), ristampa | lista portate, stato inviato/da inviare | parziale, errore stampante |
| S11 | Kitchen monitor | dispositivo cucina | Comande per centro di produzione, piatto pronto, messaggi | ticket card, timer, filtri centro, chat | vuoto, in ritardo (colore), evaso |
| S12 | Monitor clienti | schermo pubblico | Stato degli ordini (in preparazione / pronto) | due colonne numeri ordine | vuoto, pronto (evidenza) |
| S13 | Dettagli Conto | tavolo → Conto | Riepilogo del conto, sconti, maggiorazioni, coperto | righe conto, totali, azioni | aperto, sospeso |
| S14 | Divisione conto | Dettagli Conto → Dividi | Alla romana, per piatti, per cliente, più documenti | colonne trascinabili, selettore n. persone | resto non ripartito |
| S15 | Pagamento / emissione documento | Dettagli Conto → Scontrino/Fattura | Pagamenti multipli, documento commerciale, fattura | tastierino importo, tipi pagamento, resto | RT offline, POS rifiutato, pagamento parziale |
| S16 | Spostamento / unione tavoli | menu contestuale tavolo | Sposta comanda, unisci tavoli, trasferisci righe | dialog tavolo destinazione | tavolo occupato |
| S17 | Indagine Prenotazione | Prenotazioni → Indagine | Ricerca e filtro delle prenotazioni | tabella, filtri data/stato/fonte | vuota, mancata (no-show) |
| S18 | Planning prenotazioni | Prenotazioni → Planning | Vista calendario/timeline per tavolo e fascia | griglia tavoli × ore, card prenotazione | piena, sovrapposizione |
| S19 | Scheda prenotazione | nuova / apri prenotazione | Dati ospite, coperti, tavolo, note, allergie, caparra | form, assegnazione tavolo, "Salva e Chiudi" | nuova, confermata, arrivata, mancata, cancellata |
| S20 | Anagrafica cliente (CRM) | Clienti → scheda | Preferenze, listino, sconti, storico, dati fattura | tab anagrafica/storico/promo, campi fiscali | nuovo, duplicato, P.IVA non valida |
| S21 | Promozioni e fidelity | Clienti → Promozioni | Carte punti, prepagate, sconti a quantità, buoni | lista promo, regole, saldo carta | scaduta, saldo insufficiente |
| S22 | Campagne SMS/email | Clienti → Marketing | Gruppi clienti, invii, auguri di compleanno | segmenti, editor messaggio, pianificazione | bozza, inviata, errore invio |
| S23 | Chiusura giornaliera | Back office → Chiusura | Riepilogo incassi per documento, pagamento e sala | report, conferma chiusura, stampa | conti aperti (blocco), già chiusa |
| S24 | Conti emessi / sospesi | Back office → Conti | Fatturazione di sospesi, fatture riepilogative, fatture su scontrino, buoni pasto | tabella documenti, azione fattura | nessun sospeso |
| S25 | Statistiche e report | Analisi → Statistiche | Indagini su qualsiasi dato, salvate, pianificate, inviate per email | builder filtri, grafici, export, pianificatore | vuoto, in elaborazione |
| S26 | Registro operazioni | Analisi → Log | Chi ha fatto cosa e quando (storni, sconti, aperture cassetto) | tabella audit filtrabile | vuoto |
| S27 | Anagrafica articoli | Configurazione → Articoli | Articoli, categorie e sottocategorie, prezzi per listino, IVA, allergeni, immagini | albero categorie, form articolo | esaurito, non visibile |
| S28 | Listini | Configurazione → Listini | Listini per sala, fascia oraria, asporto, cliente | tabella prezzi, regole validità | conflitto fasce |
| S29 | Centri di produzione e stampanti | Configurazione → Produzione | Routing categorie → cucina/bar/pizzeria, stampanti, monitor | mapping, test stampa | stampante offline |
| S30 | Operatori e permessi | Configurazione → Utenti | Ruoli e permessi per collaboratore | matrice permessi | — |
| S31 | Configurazione locale / fiscale | Configurazione → Azienda | Dati azienda, RT, aliquote IVA, pagamenti, coperto | form, test RT | RT non raggiungibile |
| S32 | Magazzino: articoli e giacenze | Magazzino → Giacenze | Scorte, minimo/massimo, lotti, scadenze | tabella giacenze, badge sotto scorta | sotto scorta, scaduto |
| S33 | Distinta base / ricetta | articolo → Ingredienti | Ingredienti per piatto, scarico automatico da vendita, food cost | righe ingrediente con q.tà e costo | margine negativo |
| S34 | Documenti di magazzino | Magazzino → Movimenti | Carichi (DDT fornitore), scarichi, inventario, trasferimenti tra locali | form documento righe | bozza, confermato |
| S35 | Ordini fornitore / sede | Magazzino → Ordini | Proposta d'ordine da fabbisogno, ordini alla sede centrale | proposta auto, invio | nessun fabbisogno |
| S36 | Fabbisogno di produzione | Magazzino → Fabbisogni | Calcolo giornaliero, settimanale, mensile o per evento dagli ingredienti | selettore periodo, risultato | — |
| S37 | Fornitori | Magazzino → Fornitori | Anagrafica fornitori (+ arricchimento da P.IVA) | form, lookup P.IVA | — |
| S38 | Asporto: presa ordine | Asporto → Nuovo | Ordine telefonico o al banco, orario di ritiro, cliente, indirizzo | ricerca cliente (caller-ID), selettore slot | slot saturo |
| S39 | Asporto: planning slot / capacità | Asporto → Planning | Capacità produttiva per fascia, invio automatico in cucina | timeline slot, barra saturazione | saturo |
| S40 | Delivery: dispatch rider | Asporto → Consegne | Assegnazione ordini a rider, stato consegna | lista ordini, lista rider, mappa | nessun rider |
| S41 | App rider (PassDelivery) | app mobile | Ordini assegnati, navigazione, consegnato/incassato | card ordine, mappa, azioni | offline, GPS negato |
| S42 | Portali esterni | Menu → "Portale ristorante" | Credenziali portali prenotazioni e delivery, test, sync manuale | form credenziali, "Test Credenziali", "Sincronizza Prenotazioni" | errore credenziali |
| S43 | QR menu / ordine al tavolo (MySelf) | QR sul tavolo | Menu, ordine di gruppo, chiama cameriere, chiedi conto, stato ordine | lista categorie, carrello, pulsanti azione | tavolo chiuso, articolo esaurito |
| S44 | Ordine online asporto/domicilio | web/app | Menu, orario, indirizzo, pagamento con carta | checkout, slot, mappa zone | zona non servita, slot pieno |
| S45 | Totem / chiosco (Menu Point) | totem | Menu multilingua, filtro allergeni, foto, ordine, pagamento | griglia prodotti grandi, carrello, pagamento | timeout inattività, pagamento fallito |
| S46 | Lista d'attesa (Menu App) | Menu App → Attesa | Walk-in in coda, notifica all'ospite quando il tavolo è pronto | lista, stima attesa, invio SMS | coda vuota |
| S47 | Prenotazione online (widget) | sito / link | L'ospite prenota da web, con regole sui gruppi e caparra | calendario, fasce, form, garanzia carta | nessuna disponibilità |
| S48 | Addebito in camera (Welcome) | Dettagli Conto → Addebita camera | Ribalta il conto sul folio della camera dell'hotel | ricerca camera/ospite | camera in partenza, non trovata |
| S49 | Fatturazione elettronica | Back office → FE | XML, invio e ricezione SDI, notifiche | lista fatture, stati SDI | scartata, consegnata |
| S50 | Contabilità | Contabilità | Registri IVA, liquidazioni, F24, scadenzario | registri, export al commercialista | — |
| S51 | Multi locale / sede | Sede → Locali | Locali, sincronizzazione articoli e listini, consolidati | lista locali, stato sync | locale offline |
| S52 | Dashboard BI | Analisi → BI | Dashboard per locale/rete, report pianificati PDF/Excel | widget KPI, grafici | — |
| S53 | Assistente AI | pulsante globale | Domande sul software, traduzione menu, descrizioni piatti, previsioni | chat, azioni AI su articoli | — |

## Flows

```
F01 Servizio al tavolo (core loop)
    S03 sala -> S05 coperti -> S06 comanda (+S07 varianti) -> S10 invia per portate
    -> S11 cucina segna pronto -> S13 dettagli conto -> S15 pagamento -> S03 tavolo libero
    happy path clicks: ~12 per un tavolo da 2 con 4 articoli (numero da battere)
    edge: articolo esaurito durante la presa, palmare offline, stampante cucina offline,
          RT non risponde, cliente cambia tavolo, aggiunte dopo il primo invio

F02 Conto diviso
    S13 -> S14 (alla romana / per piatti / per cliente) -> S15 × n documenti
    edge: centesimi di resto, uno paga con carta e uno contanti, uno vuole la fattura

F03 Prenotazione telefonica -> arrivo
    S18 planning -> S19 nuova prenotazione (tavolo, allergie, caparra) -> Salva e Chiudi
    -> giorno X: S03 tavolo blu -> S05 conferma coperti, chiudi prenotazione -> F01
    edge: no-show dopo 15 min (stato mancata + penale), gruppo >9 con garanzia carta,
          celiaci (flag allergene che si propaga alla comanda), overbooking

F04 Prenotazione da portale (TheFork / Plateform / widget proprio)
    sync -> S17 indagine -> S19 assegna tavolo -> S03 -> "Recupera prenotazioni portali" -> F01
    -> a chiusura conto, rimanda a portale coperti e spesa
    edge: cancellata sul portale dopo la sync, tavolo non mappato

F05 Walk-in con lista d'attesa
    S46 aggiungi in coda -> SMS "tavolo pronto" -> S03 -> F01

F06 Cucina
    S11 riceve il ticket -> (inizia) -> pronto -> messaggio alla sala -> evaso
    edge: portata "in attesa di marcia", piatto rifatto, ticket stornato dopo l'invio

F07 Asporto telefonico
    S38 caller-ID -> cliente -> articoli -> orario ritiro (S39 capacità) -> invio automatico
    all'orario -> S12 pronto -> S15 pagamento al ritiro
    edge: slot saturo, cliente non ritira

F08 Domicilio con rider
    S44 / S38 -> S39 -> S40 assegna rider -> S41 consegnato + incassato -> chiusura rider

F09 Ordine dal tavolo con QR
    S43 scansione -> carrello di gruppo -> invia (al cameriere per conferma o direttamente) -> S11
    -> chiedi conto -> S15
    edge: tavolo non aperto, ordine di uno sconosciuto (QR fotografato)

F10 Totem
    S45 lingua -> filtro allergeni -> carrello -> paga -> scontrino -> S12 numero ordine

F11 Chiusura giornaliera
    S23 verifica conti aperti -> riepiloghi -> conferma -> chiusura RT -> export contabile
    edge: tavolo ancora aperto, sospesi da fatturare

F12 Carico merce e food cost
    S34 carico DDT -> S32 giacenze aggiornate -> vendite scaricano da S33 -> S35 proposta d'ordine
    edge: unità diverse (cartone vs kg), resa/calo di cottura

F13 Fattura a cliente business
    S15 fattura -> S20 nuovo cliente (P.IVA, lookup) -> S49 XML -> SDI

F14 Ospite dell'hotel al ristorante
    S13 -> S48 addebito camera -> folio nel clone Welcome

F15 Fidelity
    S05/S13 riconosci cliente -> promo automatica -> S15 accumula punti / scala prepagata

F16 Fine mese
    S24 fatture riepilogative sospesi -> S25 statistiche -> S52 BI -> S50 export commercialista
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button touch grande | primary, secondary, danger, categoria (colore) | default, pressed, disabled, loading | ovunque (target ≥ 48px) |
| Tile tavolo | tondo, quadrato, rettangolare, sgabello bar | libero, occupato, prenotato, conto chiesto, sporco, unito | S03, S04, S16 |
| Tile categoria / articolo | colore, immagine, testo | normale, esaurito, con varianti | S06, S45, S43 |
| Riga comanda | articolo, variante, nota, separatore portata | da inviare, inviata, stornata, omaggio | S06, S10, S13 |
| Selettore portata | 1ª…nª, bevande, "insieme" | attivo, inviata, in attesa di marcia | S06, S10 |
| Tastierino numerico | PIN, quantità, peso, importo | — | S01, S09, S15 |
| Ticket cucina | per tavolo, per asporto | nuovo, in lavorazione, pronto, in ritardo | S11 |
| Pannello totali | conto, sottoconto | sconto, maggiorazione, coperto | S13, S14, S15 |
| Selettore pagamento | contanti, carta, buono pasto, prepagata, credito/sospeso, camera | — | S15 |
| Tabella dati | ordinabile, filtrabile, esportabile | vuota, loading, paginata | S17, S24, S26, S32… |
| Timeline / planning | tavoli × ore, slot asporto | — | S18, S39 |
| Form anagrafica | cliente, fornitore, articolo | validazione, duplicato | S19, S20, S27, S37 |
| Modal / dialog | conferma, scelta tavolo, varianti | — | ovunque |
| Toast / banner | successo, errore stampante, RT offline, sync | — | ovunque |
| Badge stato | prenotazione, SDI, giacenza | — | S17, S32, S49 |
| Grafico | barre, linee, torta, KPI tile | — | S02, S25, S52 |
| Menu contestuale tavolo | sposta, unisci, recupera prenotazione, preconto | — | S03 |

## Inferred data model

```
Locale        id, nome, ragione_sociale, piva, indirizzo, sede_id(nullable), config_fiscale(json)
              evidence: brochure "multi locale", S31 | confidence: high

Operatore     id, locale_id, nome, pin_hash, ruolo_id, attivo
Ruolo         id, nome, permessi(json)
              evidence: brochure "permessi per collaboratore" | confidence: high

Sala          id, locale_id, nome, sfondo_url, listino_id
Tavolo        id, sala_id, numero, forma, x, y, posti, stato
              evidence: brochure, guida Plateform (numero tavolo = id esterno) | confidence: high

Categoria     id, parent_id, nome, colore, immagine, ordine, centro_produzione_id
Articolo      id, categoria_id, nome, descrizione(i18n), tipo(semplice|menu|peso|variante),
              um, aliquota_iva, allergeni[], immagine, esaurito, visibile_canali[]
PrezzoListino listino_id, articolo_id, prezzo
Listino       id, nome, validita(sala|fascia_oraria|canale|cliente)
Variante      id, nome, delta_prezzo, gruppo   (ArticoloVariante n-n)
MenuComposto  articolo_id, componenti[{gruppo, scelte[], min, max}]
              evidence: brochure (categorie illimitate, peso/UM, menu degustazione) | confidence: high (varianti e menu composti: medium)

CentroProduzione id, locale_id, nome, stampante, monitor
              evidence: brochure "centri di produzione", kitchen monitor | confidence: high

Prenotazione  id, locale_id, cliente_id, data_ora, coperti, tavolo_id, stato
              (richiesta|confermata|arrivata|mancata|cancellata|terminata), fonte(telefono|web|portale),
              ext_id, note, allergie, caparra, garanzia_carta
              evidence: guida Plateform (stati, Recupera prenotazioni portali) | confidence: high

ListaAttesa   id, nome, telefono, coperti, ora_arrivo, notificato_at   | medium (Menu App)

Comanda       id, locale_id, tavolo_id(nullable), canale(tavolo|asporto|domicilio|qr|totem|portale),
              coperti, operatore_id, cliente_id, prenotazione_id, stato(aperta|preconto|chiusa),
              orario_ritiro, aperta_at, chiusa_at
RigaComanda   id, comanda_id, articolo_id, qta, prezzo, varianti(json), note, portata,
              stato(da_inviare|inviata|pronta|servita|stornata), cliente_tag, omaggio
              evidence: brochure (portate, piatti per cliente) | confidence: high

Documento     id, comanda_id, tipo(doc_commerciale|fattura|fattura_differita|preconto|ricevuta),
              numero, totale, rt_matricola, rt_progressivo, xml_fe, stato_sdi, cliente_id
Pagamento     id, documento_id, tipo, importo, rif_pos
              evidence: brochure (più documenti, buoni pasto, sospesi) | confidence: high

Cliente       id, nome, telefono, email, compleanno, preferenze, allergie, listino_id, sconto,
              dati_fiscali(piva, cf, sdi, pec), gruppi[], consensi_marketing
Promozione    id, tipo(punti|prepagata|articolo|quantita|buono), regole(json), validita
CartaFidelity id, cliente_id, promozione_id, saldo_punti, saldo_valore
              evidence: brochure "Gestione cliente" | confidence: high (struttura regole: guess)

Chiusura      id, locale_id, data, totali(json per documento/pagamento/sala), operatore_id
AuditLog      id, operatore_id, azione, entita, entita_id, prima, dopo, at   | high

-- moduli
MagArticolo   id, nome, um_acquisto, um_uso, fattore, scorta_min, scorta_max, costo_medio
Distinta      articolo_id, mag_articolo_id, qta, resa       (scarico automatico)
Movimento     id, tipo(carico|scarico|inventario|trasferimento|vendita), locale_id, data, righe[]
Lotto         mag_articolo_id, codice, scadenza, qta
Fornitore     id, ragione_sociale, piva, ...
OrdineAcquisto id, fornitore_id|sede, stato, righe[]
              evidence: brochure "Magazzino e produzione" | confidence: high (resa: guess)

SlotAsporto   locale_id, fascia, capacita_pezzi   | medium
Rider, Consegna(comanda_id, rider_id, stato, incassato)  | medium
IntegrazionePortale id, tipo, credenziali(enc), ultimo_sync  | high
```

Relationships: Locale 1-n Sala 1-n Tavolo; Tavolo 1-n Comanda; Comanda 1-n RigaComanda; Comanda 1-n Documento 1-n Pagamento; Cliente 1-n Prenotazione / Comanda / CartaFidelity; Articolo n-n Listino (PrezzoListino); Articolo 1-n Distinta n-1 MagArticolo; Categoria n-1 CentroProduzione; Locale n-1 Locale (sede).

## Feature matrix

See `features.csv`. Must: 40, should: 34, could: 21, skip: 8 (103 righe).

## Out of scope (cannot or should not be cloned)

- **Certificazione fiscale**: il documento commerciale lo emette il registratore telematico (RT) omologato. Il clone non diventa un RT: si collega al tuo (Epson/RCH/Custom) tramite il driver o protocollo pubblico del produttore. In alternativa si usa un servizio cloud certificato di documento commerciale online via API.
- **Firma, trasmissione e conservazione a norma della fattura elettronica**: si genera l'XML e si passa a un intermediario SDI accreditato tramite le sue API (es. Aruba, Fatture in Cloud, A-Cube, Openapi).
- **Contabilità completa e F24**: è il mestiere di Passcom e del commercialista. Si esportano solo i corrispettivi e le fatture in un formato che il commercialista importa.
- **Arricchimento Cribis**: dato a pagamento. Si può usare il servizio gratuito VIES per la validazione della P.IVA, oppure un'API commerciale a parte.
- **Rete di portali delivery** (Deliveroo/Glovo/Just Eat) e marketplace: si integrano solo se e dove esistono API ufficiali con contratto. Gli ordini non si "leggono" dai tablet dei portali.
- **TheFork**: va integrato tramite le sue API partner, se ottieni l'accesso. Altrimenti resta solo l'inserimento manuale.
- **Assistente AI sui manuali Passepartout**: i manuali sono loro. Le funzioni AI (traduzioni, descrizioni, previsioni) si rifanno con un LLM tuo.
- **Hardware e certificazioni cloud** (ISO 27001, PCI-DSS): il clone usa provider già certificati (es. Stripe/SumUp per le carte) e non tocca mai i dati delle carte.
- **Nomi, loghi, icone, testi Passepartout/Menu/MySelf**: il clone ha un nome e un design suoi (vedi /replica-brand).

## Size

Schermate 53, flussi 16, entità ~35.

Parti difficili:
1. **Offline-first in sala**: i palmari devono continuare a prendere comande se il Wi-Fi cade, con sync e risoluzione dei conflitti. Il server locale di Passepartout esiste proprio per questo.
2. **Hardware fiscale e periferiche**: driver per RT, stampanti termiche ESC/POS per le comande, cassetto, bilancia, POS carte integrato. Si fa via un piccolo "bridge" locale (servizio sul PC di cassa).
3. **Realtime multi-dispositivo**: stato tavoli e kitchen monitor sincronizzati in tempo reale su 5–15 dispositivi, con instradamento delle portate senza perdere ticket.
(Seguono: distinta base con unità di misura e scarico automatico; integrazioni portali; fatturazione elettronica; multi locale.)

Taglia: **XL nella sua interezza → da rifare a fasi** (cosa che ho già fatto qui):
- **Fase 1, L** (core loop pilotabile al Moorea): S01–S16, S23, S27–S31 più un bridge per stampanti e RT. Al Moorea sostituisce la cassa.
- **Fase 2, M**: prenotazioni, lista d'attesa e CRM (S17–S22, S46, S47), statistiche, audit, conti sospesi.
- **Fase 3, M/L**: magazzino e food cost (S32–S37), asporto e delivery (S38–S41), QR e totem (S43–S45).
- **Fase 4, M**: addebito camera con il clone Welcome (S48), FE via intermediario (S49), multi locale e BI (S51–S52), AI (S53).

Nessuna promessa di clone perfetto: l'obiettivo è parità sulle "must" e un vantaggio sulle cose che al Moorea servono davvero (gruppi con caparra, allergeni, TheFork).
