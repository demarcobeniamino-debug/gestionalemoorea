# Componenti — gestionale ristorazione

Base: **shadcn/ui su Radix** (accessibile, già usato da Lovable). Icone: **Lucide** (ISC). Font: **Inter** (OFL).
Niente loghi, icone, testi o colori di Passepartout. Le etichette sono scritte da zero.

Principi di servizio, che valgono per tutti i componenti:
- **Pollice prima di tutto.** Target minimo 48 px, 56 px sul palmare, tile da 88 px. Le azioni principali stanno in basso, dove arriva il pollice.
- **Lo stato non dipende solo dal colore.** Ogni stato ha anche un'icona o un testo, perché in sala la luce è bassa e c'è chi non distingue i colori.
- **Gesti distruttivi a due tempi.** Storno, annullo e svuota conto chiedono conferma o un tocco prolungato. Invia e Incassa no.
- **Feedback sotto i 100 ms.** Prima lo stato ottimistico, poi la conferma del server. Se la stampante non risponde lo si vede subito.

---

```
Pulsante (Button)
  varianti  primario (accent), conferma (success: Invia, Incassa), pericolo (danger), secondario (surface-2), fantasma
  taglie    md 48px, lg 56px (palmare e barra azioni), xl 72px (Incassa in cassa)
  stati     default, premuto (scala .98 + surface più chiaro), focus-visible (anello 2px focus), disabilitato (40% opacità + cursore), caricamento (spinner, etichetta resta per screen reader)
  token     radius md, testo lg/600, icona Lucide 20px a sinistra
  a11y      <button> vero; aria-busy durante il caricamento; il doppio tap è bloccato fino alla risposta (idempotency_key)
  usato in  ovunque
```

```
TileTavolo
  forme     tondo, quadrato, rettangolo, sgabello
  stati     libero (surface-2 + bordo tavolo-libero-bordo, icona nessuna)
            occupato (tavolo-occupato, minuti dall'apertura, coperti, importo)
            prenotato (tavolo-prenotato, ora + nome)
            conto chiesto (tavolo-conto, icona ricevuta)
            in ritardo (tavolo-ritardo, icona orologio: piatto in attesa > soglia)
            selezionato (anello 3px focus), trascinato (ombra pop, solo editor)
  contenuto numero tavolo in xl/700; riga 2 xs: coperti · minuti · € totale
  token     on-tavolo sul pieno; radius lg (tondo: pill)
  a11y      role=button, aria-label "Tavolo 12, occupato, 4 coperti, 52 minuti, 86 euro"
  usato in  S03 sala, S04 editor, S16 sposta/unisci, S18 planning
```

```
LegendaStati
  contenuto pallino + etichetta + conteggio (Liberi 8 · Occupati 11 · Prenotati 4 · Conto 2)
  stati     voce attiva = filtro sulla piantina
  usato in  S03
```

```
TabSale
  varianti  in alto su cassa/tablet, segmented control su palmare
  stati     attiva, con badge (tavoli in ritardo in quella sala)
  a11y      Radix Tabs, frecce sinistra/destra
  usato in  S03, S18
```

```
TileCategoria
  varianti  colore pieno (colore della categoria, testo scelto automaticamente per contrasto), con immagine
  stati     attiva (bordo 3px text + leggermente più chiara), vuota (nessun articolo disponibile, opaca)
  taglia    altezza 64, larghezza piena della colonna
  usato in  S06, S45, S43
```

```
TileArticolo
  contenuto nome (base/600, max 2 righe), prezzo (sm, tabular), badge allergeni (icone piccole), badge quantità già nel conto
  stati     default, premuto, esaurito (barrato + etichetta "Esaurito", non tappabile), con varianti obbligatorie (puntino accent), a peso (icona bilancia)
  gesto     tap = aggiungi 1 · tocco prolungato = varianti e note
  taglia    min 88x88, griglia auto-fill
  a11y      aria-label "Spaghettone cacio e pepe, 16 euro, contiene glutine, latte"
  usato in  S06, S45, S43
```

```
SelettorePortata
  valori    Bevande, 1ª, 2ª, 3ª, Dessert, "Insieme"
  stati     corrente (accent), già inviata (spunta), in attesa di marcia (icona pausa)
  comportamento la portata corrente si applica agli articoli aggiunti dopo; sul palmare è una barra scorrevole
  usato in  S06, S10
```

```
RigaComanda
  contenuto qta × nome, prezzo riga a destra; sotto, rientrati: varianti ("– senza cipolla", "+ burrata 3,00"), nota in corsivo; badge allergeni in giallo pieno
  stati     da inviare (bordo sinistro accent 3px), inviata (icona stampante, testo muted), in attesa di marcia (pausa), pronta (spunta success), stornata (barrata + motivo, danger), omaggio (etichetta "Omaggio", prezzo 0)
  gesti     tap = seleziona; scorri a sinistra = −1 / storna; tocco prolungato = modifica
  a11y      lista con role=list; azioni anche da menu "Altro" (non solo gesti)
  usato in  S06, S13, S14
```

```
SeparatorePortata
  contenuto etichetta portata + stato (Inviata 20:41 / In attesa / Da inviare)
  usato in  S06, S10, S13
```

```
PannelloConto
  contenuto righe raggruppate per portata, poi Coperto, Sconto/maggiorazione, Totale (display/700)
  stati     aperto, preconto stampato (etichetta), in pagamento, vuoto ("Il conto è vuoto. Scegli una categoria per iniziare.")
  azioni    barra in basso: Invia (success), Preconto, Conto
  usato in  S06, S13
```

```
BarraAzioni
  layout    fissa in basso, altezza 72, 2-4 pulsanti lg; l'azione principale è la più larga e a destra
  usato in  S06, S13, S15, palmare ovunque
```

```
Tastierino (Keypad)
  varianti  PIN (cifre nascoste, nessun tasto decimale), quantità, peso (3 decimali), importo (virgola, 00)
  tasti     64x64, testo xl; Cancella, ⌫, OK
  stati     errore PIN (vibrazione + "PIN non corretto", 3 tentativi poi attesa)
  a11y      input reale nascosto per tastiere fisiche; aria-live per errori
  usato in  S01, S09, S15
```

```
FoglioVarianti (Sheet)
  varianti  bottom sheet sul palmare, dialog a destra su cassa
  contenuto gruppi di varianti (chip selezionabili, con prezzo), nota libera, quantità, portata, allergeni del cliente
  stati     scelta obbligatoria mancante (gruppo evidenziato danger + testo)
  a11y      Radix Dialog, focus intrappolato, Esc chiude
  usato in  S07, S08
```

```
TicketCucina
  contenuto testata: tavolo/n. asporto in xl, cameriere, minuti trascorsi; righe per portata; varianti; fascia ALLERGENI piena (allergene/on-allergene) in cima se presente
  stati     nuovo (bordo accent + suono breve), in lavorazione, pronto parziale (righe spuntate), pronto (success, scivola via), in ritardo (bordo danger, timer rosso), storno (fascia danger "STORNO")
  gesti     tap riga = pronta; tap testata = tutto pronto; tocco prolungato = messaggio alla sala
  a11y      tasti grandi; colonna leggibile a 2 m (testo minimo 20)
  usato in  S11
```

```
AnteprimaTicketCarta
  scopo     mostra a schermo cosa esce dalla Matchpower (48 colonne, 80 mm)
  token     carta/inchiostro, font mono; doppia altezza = testo 2x
  usato in  S29 configurazione stampanti, test stampa
```

```
SelettorePagamento
  valori    Contanti, Carta, Buono pasto, Prepagata, Sospeso, Camera
  stati     scelto, parzialmente usato (importo sotto), disabilitato (es. Camera senza integrazione)
  comportamento più pagamenti sullo stesso documento; resto calcolato in grande
  usato in  S15
```

```
DivisoreConto
  modalità  Alla romana (stepper persone), Per piatti (due colonne, tap per spostare), Per posto (righe col numero posto)
  stati     resto non ripartito (warning), quota pagata (spunta)
  usato in  S14
```

```
StatoStampanti (indicatore)
  contenuto pallino per stampante: Cucina, Bar, Preconto, Cassa RT
  stati     ok, lavori in coda (numero), errore ("Cucina: carta finita"), offline; per l'RT anche "da verificare"
  posizione header, sempre visibile; tap = dettaglio e ristampa
  a11y      aria-live=polite sui cambi di stato
  usato in  tutte le schermate di servizio
```

```
Toast / Banner
  varianti  successo (2 s), info, errore (resta finché non si chiude), bloccante (banner in alto: "Internet assente — le comande stampano in locale")
  a11y      Radix Toast, aria-live
  usato in  ovunque
```

```
Dialog di conferma
  uso       storno, annullo scontrino, chiusura giornaliera, svuota conto
  contenuto cosa succede e se è reversibile; pulsante pericolo a destra; per annullo/chiusura richiede PIN responsabile
  usato in  S06, S13, S23
```

```
TabellaDati
  varianti  densa (back office), comoda
  stati     vuota (testo + azione), caricamento (righe scheletro), errore, paginata; ordinamento per colonna; filtri in alto
  a11y      <table> vera, intestazioni con aria-sort
  usato in  S17, S24, S25, S26, S27, S32, S34
```

```
Campi modulo (Input, Select, Textarea, Switch, DatePicker, TimePicker)
  stati     default, focus, errore (bordo danger + messaggio sotto), disabilitato, sola lettura
  token     altezza 48, bordo border-input, radius md
  a11y      label sempre visibile (niente solo placeholder), aria-describedby per errori
  usato in  S19, S20, S27–S31, S37
```

```
Planning (timeline)
  layout    righe = tavoli, colonne = quarti d'ora 12:00–15:30 e 18:30–23:30
  card      prenotazione (nome, coperti, icone allergeni, caparra); trascinabile
  stati     sovrapposizione rifiutata (bordo danger + messaggio dal vincolo DB), mancata (barrata)
  usato in  S18, S39
```

```
TileKPI
  contenuto etichetta xs, valore xl tabular, variazione vs stesso giorno settimana scorsa
  usato in  S02, S25, S52
```

```
Navigazione
  servizio  header 56: locale, sala, operatore (tap = cambia operatore), StatoStampanti, orologio
  ufficio   sidebar 240 con sezioni: Sala, Cassa, Prenotazioni, Clienti, Articoli, Magazzino, Report, Impostazioni
  palmare   tab bar in basso: Sala, Comanda, Prenotazioni, Altro
```

## Stati vuoti e messaggi (testi nostri)

| dove | testo |
| --- | --- |
| Sala senza tavoli | "Questa sala non ha ancora tavoli. Disegnala in Impostazioni → Sale." |
| Conto vuoto | "Il conto è vuoto. Scegli una categoria per iniziare." |
| Cucina senza ticket | "Nessuna comanda in attesa." |
| Stampante offline | "Cucina non risponde. Le comande restano in coda e partono appena torna." |
| RT da verificare | "Lo scontrino potrebbe essere già uscito. Controlla la carta prima di riprovare." |
| Tavolo modificato da un altro palmare | "Il tavolo 12 è stato aggiornato da Luca. Ricarico la comanda." |
