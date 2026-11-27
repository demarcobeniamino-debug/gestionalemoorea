-- v0.7: voci libere in comanda, messaggi ai reparti (marcia, sollecito), clienti in comanda, fatture elettroniche.

-- ---------------------------------------------------------------------
-- Voce libera: una riga senza articolo ("pasta al pomodoro" fuori menu).
-- ---------------------------------------------------------------------
alter table public.righe_comanda alter column articolo_id drop not null;
alter table public.righe_comanda drop constraint if exists righe_comanda_libera_check;
alter table public.righe_comanda add constraint righe_comanda_libera_check
  check (articolo_id is not null or length(trim(descrizione)) > 0);

-- Dati fiscali del locale per le fatture (regime, indirizzo scomposto, REA…).
alter table public.locali add column if not exists dati_fiscali jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Messaggi ai reparti: testo libero, marcia di una portata, sollecito.
-- Escono sulla stampante del reparto e sul monitor.
-- ---------------------------------------------------------------------
create table if not exists public.messaggi_reparto (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  centro_id uuid references public.centri_produzione(id) on delete set null,
  comanda_id uuid references public.comande(id) on delete set null,
  tipo text not null check (tipo in ('messaggio','marcia','sollecito')),
  testo text not null default '',
  portata int,
  operatore_id uuid references public.operatori(id) on delete set null,
  visto_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (locale_id, idempotency_key)
);
create index if not exists messaggi_reparto_recenti on public.messaggi_reparto (locale_id, created_at desc);
alter table public.messaggi_reparto enable row level security;
drop policy if exists messaggi_reparto_locale on public.messaggi_reparto;
create policy messaggi_reparto_locale on public.messaggi_reparto for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));
alter publication supabase_realtime add table public.messaggi_reparto;

-- p_reparti: [{centro_id, stampante_id|null, payload|null}] — un messaggio per reparto, stampa se c'è la stampante.
create or replace function public.invia_messaggio(
  p_locale uuid, p_comanda uuid, p_tipo text, p_testo text, p_portata int, p_operatore uuid, p_key text, p_reparti jsonb)
returns setof public.messaggi_reparto
language plpgsql set search_path = '' as $$
declare r jsonb; i int := 0; k text;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  if p_tipo = 'messaggio' and length(trim(coalesce(p_testo, ''))) = 0 then raise exception 'TESTO_MANCANTE'; end if;
  for r in select * from jsonb_array_elements(p_reparti) loop
    i := i + 1; k := p_key || ':' || i;
    insert into public.messaggi_reparto (locale_id, centro_id, comanda_id, tipo, testo, portata, operatore_id, idempotency_key)
    values (p_locale, (r->>'centro_id')::uuid, p_comanda, p_tipo, coalesce(p_testo, ''), p_portata, p_operatore, k)
    on conflict (locale_id, idempotency_key) do nothing;
    if r->>'stampante_id' is not null then
      insert into public.print_jobs (locale_id, stampante_id, tipo, payload, idempotency_key)
      values (p_locale, (r->>'stampante_id')::uuid, 'comanda', r->'payload', k)
      on conflict (locale_id, idempotency_key) do nothing;
    end if;
  end loop;
  return query select * from public.messaggi_reparto where locale_id = p_locale and idempotency_key like p_key || ':%';
end $$;

-- ---------------------------------------------------------------------
-- Fatture elettroniche (FatturaPA). Il numero lo dà il server, in ordine e senza buchi per anno.
-- L'XML arriva dalla cassa con il segnaposto __NUMERO__.
-- ---------------------------------------------------------------------
create table if not exists public.fatture (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  anno int not null,
  numero int not null,
  data date not null,
  cliente_id uuid references public.clienti(id) on delete set null,
  documento_id uuid references public.documenti(id) on delete set null,
  comanda_id uuid references public.comande(id) on delete set null,
  imponibile_cents int not null,
  iva_cents int not null,
  totale_cents int not null,
  dati jsonb not null default '{}'::jsonb,
  xml text not null,
  stato text not null default 'da_inviare' check (stato in ('da_inviare','inviata','scartata','annullata')),
  idempotency_key text not null,
  operatore_id uuid references public.operatori(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale_id, anno, numero),
  unique (locale_id, idempotency_key)
);
create index if not exists fatture_cliente on public.fatture (cliente_id);
alter table public.fatture enable row level security;
drop policy if exists fatture_locale on public.fatture;
create policy fatture_locale on public.fatture for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));

create or replace function public.emetti_fattura(
  p_locale uuid, p_cliente uuid, p_documento uuid, p_comanda uuid, p_data date,
  p_imponibile int, p_iva int, p_totale int, p_dati jsonb, p_xml text, p_key text, p_operatore uuid)
returns public.fatture
language plpgsql set search_path = '' as $$
declare f public.fatture; v_anno int := extract(year from p_data); v_num int;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  select * into f from public.fatture where locale_id = p_locale and idempotency_key = p_key;
  if f.id is not null then return f; end if;
  if p_documento is not null and exists (select 1 from public.fatture where documento_id = p_documento and stato <> 'annullata') then
    raise exception 'FATTURA_GIA_EMESSA';
  end if;
  perform pg_advisory_xact_lock(hashtext('fatture:' || p_locale::text || ':' || v_anno));
  select coalesce(max(numero), 0) + 1 into v_num from public.fatture where locale_id = p_locale and anno = v_anno;
  insert into public.fatture (locale_id, anno, numero, data, cliente_id, documento_id, comanda_id, imponibile_cents, iva_cents,
                              totale_cents, dati, xml, idempotency_key, operatore_id)
  values (p_locale, v_anno, v_num, p_data, p_cliente, p_documento, p_comanda, p_imponibile, p_iva, p_totale,
          p_dati, replace(p_xml, '__NUMERO__', v_num::text), p_key, p_operatore)
  returning * into f;
  return f;
end $$;
