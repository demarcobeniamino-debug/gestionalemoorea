# Gestionale ristorazione

App di cassa per il Moorea Food Club. Funzioni ricostruite in clean-room, prendendo come riferimento Passepartout Menu: vedi `replica/`.

```
apps/app            interfaccia React (cassa, palmare, cucina) + gusci
  src-tauri/        app Windows (Tauri): comandi tcp_send e http_post_xml
  capacitor.config  app Android per i palmari
packages/core       logica: conti, ticket ESC/POS, XML Epson RT, livello dati, coda di stampa
crates/ponte        trasporto in Rust verso stampanti (TCP 9100) ed Epson (fpmate.cgi)
```

## Provare subito (browser)

```bash
npm install
npm run dev            # http://localhost:1420
```

PIN demo: Aldo 1111 · Luca 2222 · Benny 9999. Nel browser le stampe finiscono nel pannello **Carta** (in basso a sinistra), dove puoi anche simulare una stampante spenta o la risposta dell'Epson persa.

## Database (Supabase)

Progetto **gestionale-moorea** (regione Francoforte), schema in `supabase/migrations/`, 45 tabelle con regole di accesso per locale (RLS).
Indirizzo e chiave pubblica in `apps/app/.env`. L'app usa ancora i dati in memoria: il collegamento al database è il prossimo passo.

## Test

```bash
npm test                                          # logica (20 test)
cargo test --manifest-path crates/ponte/Cargo.toml  # ponte (6 test)
```

## App Windows e Android

- **Sviluppo cassa su un PC Windows:** installa Rust e Node 22, poi `cd apps/app && npx tauri dev`.
- **Installer e APK:** su GitHub, Actions → *Rilascio* → *Run workflow* (o un tag `v0.1.0`). Produce `cassa-windows` (.msi/.exe) e `palmare-android` (.apk da installare sui palmari).

## Collaudo stampanti (prima di usarla in servizio)

1. IP fissi alle 3 Matchpower (cucina, bar, preconto) e all'Epson.
2. Inserire gli IP in `packages/core/src/seed.ts`. Dopo il backend si inseriranno dalle Impostazioni.
3. Nell'app Windows mandare un ticket di prova a ogni Matchpower: deve stampare e tagliare, con accenti ed € corretti. Se gli accenti escono sbagliati, cambiare la code page (`renderEscPos`, opzione `codePage`).
4. Epson: reparti IVA come programmati dal tecnico (`aliquote`), poi uno scontrino da 0,10 € e il suo annullo. Verificare il separatore decimale (`decimale` in `epson.ts`).
