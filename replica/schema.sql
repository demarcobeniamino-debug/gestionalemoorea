-- =====================================================================
-- Gestionale ristorazione (clone clean-room delle funzioni di Passepartout Menu)
-- Schema completo, identico al progetto Supabase gestionale-moorea (applicato il 25/11/2026 in 3 migrazioni)
-- Convenzioni:
--   * id uuid, created_at/updated_at timestamptz (UTC)
--   * soldi in centesimi (integer) + valuta
--   * ogni tabella ha locale_id (o gruppo_id): è la chiave delle regole RLS
--   * gli stati sono vincoli CHECK, non testo libero
-- =====================================================================

create extension if not exists btree_gist with schema extensions;   -- per i vincoli di esclusione (prenotazioni)

-- ---------------------------------------------------------------------
-- utilità
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- 1. ORGANIZZAZIONE, ACCESSO, DISPOSITIVI
-- =====================================================================
create table gruppi (                      -- la "sede": una o più attività dello stesso titolare
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table locali (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete restrict,
  nome text not null,                       -- es. "Moorea Food Club"
  ragione_sociale text not null,
  piva text not null,
  codice_fiscale text,
  indirizzo text not null,
  fuso_orario text not null default 'Europe/Rome',
  ora_cambio_giornata time not null default '05:00',  -- il servizio delle 01:30 appartiene al giorno prima
  coperto_cents integer not null default 0 check (coperto_cents >= 0),
  valuta char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on locali (gruppo_id);

-- utenti "veri" (Supabase Auth): titolare, direttore, dispositivi
create table membri (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                    -- auth.users(id)
  locale_id uuid not null references locali(id) on delete cascade,
  ruolo text not null check (ruolo in ('titolare','direttore','dispositivo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, locale_id)
);
create index on membri (locale_id);

-- operatori di sala/cucina: entrano col PIN su un dispositivo già autenticato
create table operatori (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,
  pin_hash text not null,                   -- bcrypt, mai il PIN in chiaro
  ruolo text not null check (ruolo in ('cameriere','cassiere','cucina','bar','responsabile','admin')),
  permessi jsonb not null default '{}',     -- override: {"storno":true,"sconto_max_pct":20,...}
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on operatori (locale_id);

create table dispositivi (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,                       -- "Cassa 1", "Palmare Aldo", "Monitor cucina"
  tipo text not null check (tipo in ('cassa','palmare','kitchen_monitor','monitor_clienti','totem','ponte')),
  user_id uuid,                             -- account Auth del dispositivo
  ultimo_contatto_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on dispositivi (locale_id);

-- =====================================================================
-- 2. HARDWARE: STAMPANTI COMANDE E REGISTRATORE TELEMATICO
-- =====================================================================
create table stampanti (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,                       -- "Cucina", "Bar", "RT Cassa"
  tipo text not null check (tipo in (
    'comande_escpos',                       -- termica non fiscale, TCP 9100
    'rt_epson_xml',                         -- Epson FP-81 II RT / FP-90 III RT, fpmate.cgi
    'rt_rch',                               -- RCH Print!F, web server porta 80
    'rt_custom')),
  host text not null,                       -- IP in LAN, es. 192.168.1.50
  porta integer not null,
  matricola_rt text,                        -- solo per gli RT (serve per annulli/resi e per il collegamento POS-RT)
  colonne integer not null default 48 check (colonne in (32,42,48)),
  per_preconto boolean not null default false,   -- stampante non fiscale dove escono preconti e stampe di servizio
  attiva boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tipo = 'comande_escpos') = (matricola_rt is null))
);
create index on stampanti (locale_id);
create unique index stampanti_un_preconto_per_locale on stampanti (locale_id) where per_preconto;
alter table stampanti add constraint preconto_solo_non_fiscale
  check (not per_preconto or tipo = 'comande_escpos');

create table aliquote_iva (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  descrizione text not null,                -- "10% somministrazione", "22% alcolici da asporto"
  percentuale numeric(5,2) not null,
  natura text,                              -- N1..N7 se esente/non imponibile
  reparto_rt integer not null,              -- reparto programmato sull'RT che corrisponde a questa aliquota
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, reparto_rt)
);

create table centri_produzione (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,                       -- Cucina, Bar, Pizzeria, Pasticceria
  stampante_id uuid references stampanti(id) on delete set null,
  usa_monitor boolean not null default false,
  copie integer not null default 1 check (copie between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on centri_produzione (locale_id);
create index on centri_produzione (stampante_id);

-- =====================================================================
-- 3. SALA
-- =====================================================================
create table listini (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,                       -- "Sala", "Asporto", "Pranzo", "Staff"
  canale text check (canale in ('tavolo','asporto','domicilio','qr','totem')),
  ora_da time,
  ora_a time,
  predefinito boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on listini (locale_id);

create table sale (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,                       -- "Interno", "Dehors", "Pergotenda"
  sfondo_url text,
  listino_id uuid references listini(id) on delete set null,
  ordine integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sale (locale_id);
create index on sale (listino_id);

create table tavoli (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  sala_id uuid not null references sale(id) on delete cascade,
  numero text not null,                     -- "12", "B3", "Bancone 1"
  forma text not null default 'quadrato' check (forma in ('tondo','quadrato','rettangolo','sgabello')),
  x numeric not null default 0,
  y numeric not null default 0,
  larghezza numeric not null default 1,
  altezza numeric not null default 1,
  posti integer not null default 2 check (posti > 0),
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, numero)
);
create index on tavoli (sala_id);

-- =====================================================================
-- 4. CATALOGO
-- =====================================================================
create table categorie (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  parent_id uuid references categorie(id) on delete cascade,
  nome text not null,
  colore text,
  immagine_url text,
  ordine integer not null default 0,
  centro_produzione_id uuid references centri_produzione(id) on delete set null,
  portata_predefinita integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on categorie (locale_id);
create index on categorie (parent_id);
create index on categorie (centro_produzione_id);

create table articoli (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  categoria_id uuid not null references categorie(id) on delete restrict,
  nome text not null,
  nome_breve text,                          -- per comanda e scontrino
  descrizione jsonb not null default '{}',  -- {"it":"...","en":"...","ru":"..."}
  tipo text not null default 'semplice' check (tipo in ('semplice','menu','peso')),
  unita_misura text not null default 'pz',
  aliquota_iva_id uuid not null references aliquote_iva(id) on delete restrict,
  centro_produzione_id uuid references centri_produzione(id) on delete set null,  -- override della categoria
  allergeni text[] not null default '{}',   -- i 14 allergeni Reg. UE 1169/2011
  immagine_url text,
  esaurito boolean not null default false,
  canali text[] not null default '{tavolo}',
  ordine integer not null default 0,
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allergeni <@ array['glutine','crostacei','uova','pesce','arachidi','soia','latte',
        'frutta_a_guscio','sedano','senape','sesamo','solfiti','lupini','molluschi']::text[])
);
create index on articoli (locale_id, categoria_id);
create index on articoli (categoria_id);
create index on articoli (aliquota_iva_id);
create index on articoli (centro_produzione_id);

create table prezzi_listino (
  listino_id uuid not null references listini(id) on delete cascade,
  articolo_id uuid not null references articoli(id) on delete cascade,
  prezzo_cents integer not null check (prezzo_cents >= 0),
  primary key (listino_id, articolo_id)
);
create index on prezzi_listino (articolo_id);

create table varianti (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  gruppo text,                              -- "Cottura", "Aggiunte", "Senza"
  nome text not null,                       -- "ben cotta", "+ burrata", "senza cipolla"
  delta_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on varianti (locale_id);

create table articolo_varianti (
  articolo_id uuid not null references articoli(id) on delete cascade,
  variante_id uuid not null references varianti(id) on delete cascade,
  primary key (articolo_id, variante_id)
);
create index on articolo_varianti (variante_id);

-- menu composti / degustazione: un articolo "menu" con gruppi di scelta
create table menu_componenti (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references articoli(id) on delete cascade,
  gruppo text not null,                     -- "Antipasto", "Primo", "Bevanda"
  articolo_id uuid not null references articoli(id) on delete cascade,
  supplemento_cents integer not null default 0,
  min_scelte integer not null default 1,
  max_scelte integer not null default 1,
  portata integer not null default 1
);
create index on menu_componenti (menu_id);
create index on menu_componenti (articolo_id);

-- =====================================================================
-- 5. CLIENTI, PRENOTAZIONI, LISTA D'ATTESA
-- =====================================================================
create table clienti (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,  -- condivisi tra i locali del gruppo
  nome text not null,
  cognome text,
  telefono text,
  email text,
  compleanno date,
  lingua text,
  preferenze text,
  allergeni text[] not null default '{}',
  note_allergie text,
  listino_id uuid references listini(id) on delete set null,
  sconto_pct numeric(5,2) not null default 0,
  -- dati fattura
  ragione_sociale text,
  piva text,
  codice_fiscale text,
  codice_sdi text,
  pec text,
  indirizzo_fiscale jsonb,
  consenso_marketing boolean not null default false,
  consenso_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on clienti (gruppo_id);
create index on clienti (gruppo_id, telefono);
create index on clienti (gruppo_id, lower(cognome));
create index on clienti (listino_id);

create table prenotazioni (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  cliente_id uuid references clienti(id) on delete set null,
  nome_ospite text not null,
  telefono text,
  inizio_at timestamptz not null,
  fine_at timestamptz not null,
  coperti integer not null check (coperti > 0),
  tavolo_id uuid references tavoli(id) on delete set null,
  stato text not null default 'confermata'
    check (stato in ('richiesta','confermata','arrivata','mancata','cancellata','terminata')),
  fonte text not null default 'telefono' check (fonte in ('telefono','walkin','web','thefork','portale','altro')),
  ext_id text,                              -- id sul portale, per non importarla due volte
  note text,
  allergeni text[] not null default '{}',
  caparra_cents integer not null default 0,
  penale_noshow_cents integer not null default 0,   -- es. 2500 a persona per gruppi
  garanzia_carta_ref text,                  -- id del metodo salvato presso il provider; mai i dati carta
  operatore_id uuid references operatori(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fine_at > inizio_at),
  -- due prenotazioni attive non possono occupare lo stesso tavolo nello stesso intervallo
  constraint prenotazioni_no_sovrapposizione exclude using gist (
    tavolo_id with =,
    tstzrange(inizio_at, fine_at) with &&
  ) where (tavolo_id is not null and stato in ('richiesta','confermata','arrivata'))
);
create index on prenotazioni (locale_id, inizio_at);
create index on prenotazioni (cliente_id);
create index on prenotazioni (tavolo_id);
create index on prenotazioni (operatore_id);
create unique index on prenotazioni (locale_id, fonte, ext_id) where ext_id is not null;

create table lista_attesa (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,
  telefono text,
  coperti integer not null check (coperti > 0),
  arrivo_at timestamptz not null default now(),
  notificato_at timestamptz,
  stato text not null default 'in_attesa' check (stato in ('in_attesa','notificato','seduto','andato_via')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on lista_attesa (locale_id, stato);

-- =====================================================================
-- 6. COMANDE (il cuore)
-- =====================================================================
create table comande (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  numero integer not null,                  -- progressivo del giorno di servizio, per cucina e monitor clienti
  giorno_servizio date not null,
  canale text not null default 'tavolo' check (canale in ('tavolo','banco','asporto','domicilio','qr','totem','portale')),
  tavolo_id uuid references tavoli(id) on delete restrict,
  coperti integer not null default 0 check (coperti >= 0),
  cliente_id uuid references clienti(id) on delete set null,
  prenotazione_id uuid references prenotazioni(id) on delete set null,
  operatore_id uuid references operatori(id) on delete set null,
  listino_id uuid references listini(id) on delete set null,
  stato text not null default 'aperta' check (stato in ('aperta','preconto','chiusa','annullata')),
  orario_ritiro_at timestamptz,             -- asporto/domicilio
  note text,
  allergeni_tavolo jsonb not null default '[]',  -- [{"allergene":"glutine","posto":2}]
  aperta_at timestamptz not null default now(),
  chiusa_at timestamptz,
  version integer not null default 1,       -- lock ottimistico tra palmari
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((canale = 'tavolo') = (tavolo_id is not null)),
  unique (locale_id, giorno_servizio, numero)
);
-- un tavolo ha al massimo una comanda aperta
create unique index comande_un_aperta_per_tavolo on comande (tavolo_id) where stato in ('aperta','preconto');
create index on comande (locale_id, giorno_servizio);
create index on comande (locale_id, stato);
create index on comande (cliente_id);
create index on comande (prenotazione_id);
create index on comande (operatore_id);
create index on comande (listino_id);

-- ogni "Invia" / "Marcia" crea un invio: è l'unità che la cucina riceve e stampa
create table invii_produzione (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  comanda_id uuid not null references comande(id) on delete cascade,
  tipo text not null default 'invio' check (tipo in ('invio','marcia','storno','sollecito','messaggio')),
  portata integer,
  operatore_id uuid references operatori(id) on delete set null,
  idempotency_key text not null,            -- generata dal palmare: un doppio tap non invia due volte
  created_at timestamptz not null default now(),
  unique (locale_id, idempotency_key)
);
create index on invii_produzione (comanda_id);
create index on invii_produzione (operatore_id);

create table righe_comanda (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  comanda_id uuid not null references comande(id) on delete cascade,
  articolo_id uuid not null references articoli(id) on delete restrict,
  parent_riga_id uuid references righe_comanda(id) on delete cascade,  -- componenti di un menu
  descrizione text not null,                -- copiata dall'articolo al momento dell'ordine
  quantita numeric(10,3) not null check (quantita > 0),
  prezzo_unitario_cents integer not null,
  varianti jsonb not null default '[]',     -- [{"nome":"senza cipolla","delta_cents":0}]
  note text,
  portata integer not null default 1,
  centro_produzione_id uuid references centri_produzione(id) on delete set null,
  aliquota_iva_id uuid not null references aliquote_iva(id) on delete restrict,
  allergeni text[] not null default '{}',
  posto integer,                            -- per conto "per cliente"
  omaggio boolean not null default false,
  stato text not null default 'da_inviare'
    check (stato in ('da_inviare','in_attesa_marcia','inviata','in_preparazione','pronta','servita','stornata')),
  invio_id uuid references invii_produzione(id) on delete set null,
  inviata_at timestamptz,
  stornata_da uuid references operatori(id) on delete set null,
  motivo_storno text,
  operatore_id uuid references operatori(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stato <> 'stornata' or motivo_storno is not null)
);
create index on righe_comanda (comanda_id);
create index on righe_comanda (locale_id, centro_produzione_id, stato);   -- kitchen monitor
create index on righe_comanda (articolo_id);
create index on righe_comanda (invio_id);
create index on righe_comanda (parent_riga_id);
create index on righe_comanda (centro_produzione_id);
create index on righe_comanda (aliquota_iva_id);
create index on righe_comanda (stornata_da);
create index on righe_comanda (operatore_id);

-- =====================================================================
-- 7. CODA DI STAMPA (comande e documenti fiscali)
-- Il "Ponte di cassa" sul PC del locale legge questa coda e parla con le stampanti in LAN.
-- =====================================================================
create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  stampante_id uuid not null references stampanti(id) on delete restrict,
  tipo text not null check (tipo in ('comanda','preconto','documento_commerciale','annullo','reso',
                                     'chiusura_fiscale','lettura_x','non_fiscale')),
  payload jsonb not null,                   -- dati strutturati; il ponte li traduce in ESC/POS o XML fiscale
  invio_id uuid references invii_produzione(id) on delete set null,
  documento_id uuid,                        -- fk aggiunta sotto
  stato text not null default 'in_coda'
    check (stato in ('in_coda','preso','stampato','errore','da_verificare','annullato')),
  tentativi integer not null default 0,
  preso_da uuid references dispositivi(id) on delete set null,
  preso_at timestamptz,
  esito jsonb,                              -- risposta della stampante / dell'RT
  errore text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, idempotency_key)
);
create index on print_jobs (locale_id, stato, created_at);
create index on print_jobs (stampante_id);
create index on print_jobs (invio_id);
create index on print_jobs (documento_id);
create index on print_jobs (preso_da);

-- =====================================================================
-- 8. CONTI, DOCUMENTI, PAGAMENTI
-- =====================================================================
create table documenti (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  comanda_id uuid references comande(id) on delete restrict,
  tipo text not null check (tipo in (
    'documento_commerciale',                -- lo "scontrino" emesso dall'RT
    'fattura',                              -- fattura immediata (XML FatturaPA)
    'fattura_differita',                    -- riepilogativa di sospesi / buoni pasto
    'annullo','reso',                       -- documenti commerciali di annullo/reso via RT
    'addebito_camera',                      -- verso il gestionale hotel
    'non_fiscale')),
  stato text not null default 'bozza'
    check (stato in ('bozza','in_emissione','emesso','errore','da_verificare','annullato')),
  cliente_id uuid references clienti(id) on delete restrict,
  totale_cents integer not null,
  sconto_cents integer not null default 0,
  valuta char(3) not null default 'EUR',
  quota_indice integer,                     -- alla romana: quota n. ...
  quota_di integer,                         -- ... su quote totali
  -- dati restituiti dall'RT (servono per annulli e resi)
  stampante_id uuid references stampanti(id) on delete restrict,
  rt_matricola text,
  rt_z_numero integer,
  rt_doc_numero integer,
  rt_emesso_at timestamptz,
  codice_lotteria text,
  -- fattura elettronica
  numero_fattura text,
  xml_fattura text,
  stato_sdi text check (stato_sdi in ('da_inviare','inviata','consegnata','scartata','mancata_consegna')),
  sdi_ref text,
  documento_origine_id uuid references documenti(id) on delete restrict,  -- per annulli/resi
  operatore_id uuid references operatori(id) on delete set null,
  errore text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, idempotency_key),
  check (tipo not in ('annullo','reso') or documento_origine_id is not null)
);
create unique index documenti_rt_unico on documenti (rt_matricola, rt_z_numero, rt_doc_numero)
  where rt_matricola is not null;
create unique index documenti_fattura_unica on documenti (locale_id, numero_fattura)
  where numero_fattura is not null;
create index on documenti (locale_id, created_at);
create index on documenti (comanda_id);
create index on documenti (cliente_id);
create index on documenti (stampante_id);
create index on documenti (documento_origine_id);
create index on documenti (operatore_id);

alter table print_jobs
  add constraint print_jobs_documento_fk foreign key (documento_id) references documenti(id) on delete restrict;

create table righe_documento (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documenti(id) on delete cascade,
  riga_comanda_id uuid references righe_comanda(id) on delete set null,
  descrizione text not null,
  quantita numeric(10,3) not null,
  prezzo_unitario_cents integer not null,
  importo_cents integer not null,
  aliquota_iva_id uuid references aliquote_iva(id) on delete restrict,   -- nulla per le quote alla romana
  reparto_rt integer not null
);
create index on righe_documento (documento_id);
create index on righe_documento (riga_comanda_id);
create index on righe_documento (aliquota_iva_id);

create table pagamenti (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  documento_id uuid not null references documenti(id) on delete cascade,
  tipo text not null check (tipo in ('contanti','carta','buono_pasto','prepagata','sospeso','camera','bonifico')),
  -- come l'RT classifica il pagamento (conta per corrispettivi e per l'incrocio POS-RT)
  tipo_rt text not null check (tipo_rt in ('contanti','elettronico','ticket','non_riscosso')),
  importo_cents integer not null check (importo_cents > 0),
  valuta char(3) not null default 'EUR',
  rif_pos text,                             -- id transazione del terminale
  numero_buoni integer,
  created_at timestamptz not null default now()
);
create index on pagamenti (documento_id);
create index on pagamenti (locale_id, created_at);

-- conti sospesi / a credito da fatturare
create table sospesi (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  cliente_id uuid not null references clienti(id) on delete restrict,
  documento_id uuid not null references documenti(id) on delete restrict,
  importo_cents integer not null,
  fattura_id uuid references documenti(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sospesi (locale_id, cliente_id) where fattura_id is null;
create index on sospesi (documento_id);
create index on sospesi (fattura_id);
create index on sospesi (cliente_id);

create table chiusure (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  giorno_servizio date not null,
  totali jsonb not null,                    -- per tipo documento, per pagamento, per sala, per operatore
  stampante_id uuid references stampanti(id) on delete set null,
  rt_z_numero integer,
  operatore_id uuid references operatori(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (locale_id, giorno_servizio, stampante_id)
);
create index on chiusure (stampante_id);
create index on chiusure (operatore_id);

create table audit_log (
  id bigint generated always as identity primary key,
  locale_id uuid not null references locali(id) on delete cascade,
  operatore_id uuid references operatori(id) on delete set null,
  dispositivo_id uuid references dispositivi(id) on delete set null,
  azione text not null,                     -- storno, sconto, apertura_cassetto, annullo, cambio_prezzo...
  entita text not null,
  entita_id uuid,
  prima jsonb,
  dopo jsonb,
  at timestamptz not null default now()
);
create index on audit_log (locale_id, at desc);
create index on audit_log (operatore_id);
create index on audit_log (dispositivo_id);

-- =====================================================================
-- 9. FIDELITY E MARKETING (fase 2)
-- =====================================================================
create table promozioni (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('punti','prepagata','articolo','quantita','buono')),
  regole jsonb not null,
  valida_da date,
  valida_a date,
  attiva boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on promozioni (gruppo_id);

create table carte_fidelity (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,
  cliente_id uuid not null references clienti(id) on delete cascade,
  promozione_id uuid not null references promozioni(id) on delete restrict,
  codice text not null,
  saldo_punti integer not null default 0 check (saldo_punti >= 0),
  saldo_cents integer not null default 0 check (saldo_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gruppo_id, codice)
);
create index on carte_fidelity (cliente_id);
create index on carte_fidelity (promozione_id);

create table movimenti_fidelity (
  id uuid primary key default gen_random_uuid(),
  carta_id uuid not null references carte_fidelity(id) on delete cascade,
  documento_id uuid references documenti(id) on delete set null,
  delta_punti integer not null default 0,
  delta_cents integer not null default 0,
  created_at timestamptz not null default now()
);
create index on movimenti_fidelity (carta_id);
create index on movimenti_fidelity (documento_id);

create table campagne (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,
  canale text not null check (canale in ('email','sms')),
  oggetto text,
  corpo text not null,
  filtro jsonb not null default '{}',
  pianificata_at timestamptz,
  stato text not null default 'bozza' check (stato in ('bozza','pianificata','inviata','errore')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campagne (gruppo_id);

-- =====================================================================
-- 10. MAGAZZINO E FOOD COST (fase 3)
-- =====================================================================
create table fornitori (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,
  ragione_sociale text not null,            -- MARR, Metro, Fabbrocino...
  piva text,
  email_ordini text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on fornitori (gruppo_id);

create table mag_articoli (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references gruppi(id) on delete cascade,
  nome text not null,
  um_acquisto text not null,                -- "cartone 6x1l"
  um_uso text not null,                     -- "l", "kg", "pz"
  fattore numeric(12,4) not null default 1 check (fattore > 0),   -- 1 um_acquisto = fattore um_uso
  fornitore_id uuid references fornitori(id) on delete set null,
  costo_ultimo_cents integer,               -- per um_uso
  allergeni text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on mag_articoli (gruppo_id);
create index on mag_articoli (fornitore_id);

create table scorte (
  locale_id uuid not null references locali(id) on delete cascade,
  mag_articolo_id uuid not null references mag_articoli(id) on delete cascade,
  giacenza numeric(14,3) not null default 0,
  scorta_min numeric(14,3),
  scorta_max numeric(14,3),
  updated_at timestamptz not null default now(),
  primary key (locale_id, mag_articolo_id)
);
create index on scorte (mag_articolo_id);

create table distinte (                     -- ricetta: ingredienti per una porzione
  articolo_id uuid not null references articoli(id) on delete cascade,
  mag_articolo_id uuid not null references mag_articoli(id) on delete restrict,
  quantita numeric(12,4) not null check (quantita > 0),   -- in um_uso, netta
  resa_pct numeric(5,2) not null default 100 check (resa_pct > 0 and resa_pct <= 100),  -- calo pulizia/cottura
  primary key (articolo_id, mag_articolo_id)
);
create index on distinte (mag_articolo_id);

create table movimenti_magazzino (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  tipo text not null check (tipo in ('carico','scarico','vendita','inventario','trasferimento_out','trasferimento_in','scarto')),
  data date not null,
  fornitore_id uuid references fornitori(id) on delete set null,
  rif_documento text,                       -- n. DDT / fattura fornitore
  locale_collegato_id uuid references locali(id) on delete set null,
  operatore_id uuid references operatori(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on movimenti_magazzino (locale_id, data);
create index on movimenti_magazzino (fornitore_id);
create index on movimenti_magazzino (locale_collegato_id);
create index on movimenti_magazzino (operatore_id);

create table righe_movimento (
  id uuid primary key default gen_random_uuid(),
  movimento_id uuid not null references movimenti_magazzino(id) on delete cascade,
  mag_articolo_id uuid not null references mag_articoli(id) on delete restrict,
  quantita numeric(14,3) not null,          -- in um_uso, con segno
  costo_unitario_cents integer,
  lotto text,
  scadenza date
);
create index on righe_movimento (movimento_id);
create index on righe_movimento (mag_articolo_id);

create table ordini_acquisto (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  fornitore_id uuid references fornitori(id) on delete restrict,
  stato text not null default 'bozza' check (stato in ('bozza','inviato','ricevuto_parziale','ricevuto','annullato')),
  righe jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ordini_acquisto (locale_id);
create index on ordini_acquisto (fornitore_id);

-- =====================================================================
-- 11. ASPORTO, DELIVERY, INTEGRAZIONI (fase 3-4)
-- =====================================================================
create table slot_asporto (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  giorno_settimana integer not null check (giorno_settimana between 0 and 6),
  ora_da time not null,
  ora_a time not null,
  capacita_pezzi integer not null check (capacita_pezzi > 0),
  check (ora_a > ora_da)
);
create index on slot_asporto (locale_id);

create table rider (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  nome text not null,
  telefono text,
  user_id uuid,
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on rider (locale_id);

create table consegne (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  comanda_id uuid not null unique references comande(id) on delete cascade,
  rider_id uuid references rider(id) on delete set null,
  indirizzo jsonb not null,
  stato text not null default 'da_assegnare'
    check (stato in ('da_assegnare','assegnata','in_consegna','consegnata','fallita')),
  incassato_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on consegne (locale_id, stato);
create index on consegne (rider_id);

create table integrazioni (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references locali(id) on delete cascade,
  tipo text not null check (tipo in ('thefork','plateform','sdi_intermediario','pos_terminale','sms','email','pms_hotel')),
  config jsonb not null default '{}',       -- impostazioni non segrete
  segreto_ref text,                         -- nome del secret in Supabase Vault, mai la chiave qui
  ultimo_sync_at timestamptz,
  attiva boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, tipo)
);

-- =====================================================================
-- 12. TRIGGER updated_at
-- =====================================================================
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- =====================================================================
-- 13. ACCESSO (Row Level Security)
-- Regola unica: vedi e scrivi solo i dati dei locali di cui sei membro.
-- Le operazioni delicate (invio, conto, storno, chiusura) passano da funzioni RPC
-- che controllano anche il PIN/permessi dell'operatore.
-- =====================================================================
-- Le funzioni di controllo stanno nello schema "privato", non esposto dalle API.
create schema if not exists privato;
revoke all on schema privato from public;
grant usage on schema privato to authenticated;

create or replace function privato.mio_locale(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri m where m.locale_id = l and m.user_id = (select auth.uid()));
$$;

create or replace function privato.mio_gruppo(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri m join public.locali lo on lo.id = m.locale_id
                 where lo.gruppo_id = g and m.user_id = (select auth.uid()));
$$;

revoke all on function privato.mio_locale(uuid) from public, anon;
revoke all on function privato.mio_gruppo(uuid) from public, anon;
grant execute on function privato.mio_locale(uuid) to authenticated;
grant execute on function privato.mio_gruppo(uuid) to authenticated;

do $$
declare t text;
begin
  -- tabelle con locale_id
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'locale_id'
      and table_name in (select table_name from information_schema.tables
                         where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id))',
                   t || '_locale', t);
  end loop;
  -- tabelle con gruppo_id
  foreach t in array array['clienti','promozioni','carte_fidelity','campagne','fornitori','mag_articoli'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (privato.mio_gruppo(gruppo_id)) with check (privato.mio_gruppo(gruppo_id))',
                   t || '_gruppo', t);
  end loop;
end $$;

alter table locali enable row level security;
create policy locali_membri on locali for select to authenticated using (privato.mio_locale(id));
alter table gruppi enable row level security;
create policy gruppi_membri on gruppi for select to authenticated using (privato.mio_gruppo(id));

-- tabelle figlie senza locale_id: accesso tramite il padre
alter table prezzi_listino enable row level security;
create policy prezzi_listino_via_listino on prezzi_listino for all to authenticated
  using (exists (select 1 from listini l where l.id = listino_id and privato.mio_locale(l.locale_id)))
  with check (exists (select 1 from listini l where l.id = listino_id and privato.mio_locale(l.locale_id)));

alter table articolo_varianti enable row level security;
create policy articolo_varianti_via_articolo on articolo_varianti for all to authenticated
  using (exists (select 1 from articoli a where a.id = articolo_id and privato.mio_locale(a.locale_id)))
  with check (exists (select 1 from articoli a where a.id = articolo_id and privato.mio_locale(a.locale_id)));

alter table menu_componenti enable row level security;
create policy menu_componenti_via_articolo on menu_componenti for all to authenticated
  using (exists (select 1 from articoli a where a.id = menu_id and privato.mio_locale(a.locale_id)))
  with check (exists (select 1 from articoli a where a.id = menu_id and privato.mio_locale(a.locale_id)));

alter table righe_documento enable row level security;
create policy righe_documento_via_documento on righe_documento for all to authenticated
  using (exists (select 1 from documenti d where d.id = documento_id and privato.mio_locale(d.locale_id)))
  with check (exists (select 1 from documenti d where d.id = documento_id and privato.mio_locale(d.locale_id)));

alter table movimenti_fidelity enable row level security;
create policy movimenti_fidelity_via_carta on movimenti_fidelity for all to authenticated
  using (exists (select 1 from carte_fidelity c where c.id = carta_id and privato.mio_gruppo(c.gruppo_id)))
  with check (exists (select 1 from carte_fidelity c where c.id = carta_id and privato.mio_gruppo(c.gruppo_id)));

alter table distinte enable row level security;
create policy distinte_via_articolo on distinte for all to authenticated
  using (exists (select 1 from articoli a where a.id = articolo_id and privato.mio_locale(a.locale_id)))
  with check (exists (select 1 from articoli a where a.id = articolo_id and privato.mio_locale(a.locale_id)));

alter table righe_movimento enable row level security;
create policy righe_movimento_via_movimento on righe_movimento for all to authenticated
  using (exists (select 1 from movimenti_magazzino m where m.id = movimento_id and privato.mio_locale(m.locale_id)))
  with check (exists (select 1 from movimenti_magazzino m where m.id = movimento_id and privato.mio_locale(m.locale_id)));

-- I documenti fiscali emessi non si modificano né si cancellano: si annullano con un nuovo documento.
create or replace function blocca_documento_emesso() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.stato = 'emesso' then
    raise exception 'Documento emesso: non si cancella, si annulla';
  end if;
  if tg_op = 'UPDATE' and old.stato = 'emesso'
     and (new.totale_cents, new.rt_z_numero, new.rt_doc_numero, new.tipo)
         is distinct from (old.totale_cents, old.rt_z_numero, old.rt_doc_numero, old.tipo) then
    raise exception 'Documento emesso: dati fiscali immutabili';
  end if;
  return coalesce(new, old);
end $$;
create trigger documenti_immutabili before update or delete on documenti
  for each row execute function blocca_documento_emesso();

-- =====================================================================
-- 14. REALTIME: tabelle che sala, cucina e ponte ascoltano
alter publication supabase_realtime add table comande, righe_comanda, print_jobs,
  tavoli, prenotazioni, lista_attesa, articoli, documenti;
-- =====================================================================
