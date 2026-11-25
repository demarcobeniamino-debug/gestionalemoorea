# Build log

Decisione del 25/11: **app, non sito.** Cassa su PC touch Windows (Tauri, con il ponte stampanti dentro), palmari Android (Capacitor), back office anche web.
Dati ancora **in memoria** (FakeDataLayer con la stessa interfaccia del backend): il prossimo passo è `/replica-backend`.

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
