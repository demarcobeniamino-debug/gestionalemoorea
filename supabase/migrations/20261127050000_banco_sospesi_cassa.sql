-- v0.8: banco e asporto, sospesi e addebito in camera, movimenti di cassa, caparre,
-- metodi di pagamento su misura, promozioni, menu fissi (impostazioni del locale).

alter table public.locali add column if not exists impostazioni jsonb not null default '{}'::jsonb;
alter table public.pagamenti add column if not exists descrizione text;

-- ---------------------------------------------------------------------
-- Banco / asporto: conto senza tavolo, con un nome ("Banco", "Marco asporto").
-- ---------------------------------------------------------------------
create or replace function public.apri_banco(p_locale uuid, p_canale text, p_nome text, p_operatore uuid)
returns public.comande
language plpgsql set search_path = '' as $$
declare v_giorno date; v_numero int; c public.comande;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  if p_canale not in ('banco','asporto') then raise exception 'CANALE_NON_VALIDO'; end if;
  v_giorno := public.giorno_servizio(p_locale);
  perform pg_advisory_xact_lock(hashtext(p_locale::text || v_giorno::text));
  select coalesce(max(numero), 0) + 1 into v_numero from public.comande where locale_id = p_locale and giorno_servizio = v_giorno;
  insert into public.comande (locale_id, numero, giorno_servizio, canale, tavolo_id, coperti, operatore_id, note)
  values (p_locale, v_numero, v_giorno, p_canale, null, 0, p_operatore, nullif(trim(p_nome), ''))
  returning * into c;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Sospesi e addebiti in camera: nascono quando lo scontrino con pagamento "non riscosso" è emesso.
-- ---------------------------------------------------------------------
alter table public.sospesi alter column cliente_id drop not null;
alter table public.sospesi add column if not exists tipo text not null default 'sospeso';
alter table public.sospesi add column if not exists descrizione text;
alter table public.sospesi add column if not exists stato text not null default 'aperto';
alter table public.sospesi add column if not exists incassato_at timestamptz;
alter table public.sospesi add column if not exists incassato_tipo text;
alter table public.sospesi add column if not exists incassato_operatore uuid references public.operatori(id) on delete set null;
alter table public.sospesi add column if not exists comanda_id uuid references public.comande(id) on delete set null;
do $$ begin
  alter table public.sospesi add constraint sospesi_tipo_check check (tipo in ('sospeso','camera'));
  alter table public.sospesi add constraint sospesi_stato_check check (stato in ('aperto','incassato','annullato'));
exception when duplicate_object then null; end $$;
create unique index if not exists sospesi_documento_tipo on public.sospesi (documento_id, tipo);

-- Caparre: acconti incassati prima (prenotazione di gruppo, evento) e scalati dal conto.
create table if not exists public.caparre (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  cliente_id uuid references public.clienti(id) on delete set null,
  nome text not null,
  importo_cents int not null check (importo_cents > 0),
  metodo text not null check (metodo in ('contanti','carta','bonifico','prepagata')),
  nota text,
  stato text not null default 'aperta' check (stato in ('aperta','usata','restituita')),
  documento_id uuid references public.documenti(id) on delete set null,
  operatore_id uuid references public.operatori(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.caparre enable row level security;
drop policy if exists caparre_locale on public.caparre;
create policy caparre_locale on public.caparre for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));

-- Scontrino emesso: registra sospesi/camera e segna le caparre usate (descrizione "caparra:<id>").
create or replace function privato.documento_emesso()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p record; v_cliente uuid;
begin
  if new.stato = 'emesso' and old.stato is distinct from 'emesso' and new.tipo = 'documento_commerciale' then
    select cliente_id into v_cliente from public.comande where id = new.comanda_id;
    for p in select * from public.pagamenti where documento_id = new.id loop
      if p.tipo in ('sospeso','camera') then
        insert into public.sospesi (locale_id, cliente_id, documento_id, comanda_id, importo_cents, tipo, descrizione)
        values (new.locale_id, v_cliente, new.id, new.comanda_id, p.importo_cents, p.tipo, p.descrizione)
        on conflict (documento_id, tipo) do nothing;
      elsif p.descrizione like 'caparra:%' then
        update public.caparre set stato = 'usata', documento_id = new.id, updated_at = now()
          where id = substring(p.descrizione from 9)::uuid and locale_id = new.locale_id;
      end if;
    end loop;
  end if;
  if new.stato = 'annullato' and old.stato is distinct from 'annullato' then
    update public.sospesi set stato = 'annullato', updated_at = now() where documento_id = new.id and stato = 'aperto';
    update public.caparre set stato = 'aperta', documento_id = null, updated_at = now() where documento_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists documenti_emesso on public.documenti;
create trigger documenti_emesso after update of stato on public.documenti
  for each row execute function privato.documento_emesso();

create or replace function public.incassa_sospeso(p_sospeso uuid, p_tipo text, p_operatore uuid)
returns void language plpgsql set search_path = '' as $$
declare s public.sospesi;
begin
  select * into s from public.sospesi where id = p_sospeso for update;
  if s.id is null then raise exception 'SOSPESO_INESISTENTE'; end if;
  if s.stato <> 'aperto' then return; end if;
  if p_tipo not in ('contanti','carta','bonifico','buono_pasto','prepagata') then raise exception 'TIPO_NON_VALIDO'; end if;
  update public.sospesi set stato = 'incassato', incassato_at = now(), incassato_tipo = p_tipo, incassato_operatore = p_operatore, updated_at = now()
    where id = p_sospeso;
end $$;

-- ---------------------------------------------------------------------
-- Movimenti di cassa: fondo, versamenti, prelievi, conteggio di fine turno.
-- ---------------------------------------------------------------------
create table if not exists public.movimenti_cassa (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  giorno_servizio date not null,
  tipo text not null check (tipo in ('fondo','versamento','prelievo','conteggio')),
  importo_cents int not null check (importo_cents >= 0),
  causale text,
  operatore_id uuid references public.operatori(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (locale_id, idempotency_key)
);
create index if not exists movimenti_cassa_giorno on public.movimenti_cassa (locale_id, giorno_servizio);
alter table public.movimenti_cassa enable row level security;
drop policy if exists movimenti_cassa_locale on public.movimenti_cassa;
create policy movimenti_cassa_locale on public.movimenti_cassa for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));

create or replace function public.registra_movimento_cassa(p_locale uuid, p_tipo text, p_importo int, p_causale text, p_operatore uuid, p_key text)
returns public.movimenti_cassa language plpgsql set search_path = '' as $$
declare m public.movimenti_cassa;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  insert into public.movimenti_cassa (locale_id, giorno_servizio, tipo, importo_cents, causale, operatore_id, idempotency_key)
  values (p_locale, public.giorno_servizio(p_locale), p_tipo, p_importo, nullif(trim(p_causale), ''), p_operatore, p_key)
  on conflict (locale_id, idempotency_key) do nothing returning * into m;
  if m.id is null then select * into m from public.movimenti_cassa where locale_id = p_locale and idempotency_key = p_key; end if;
  return m;
end $$;

do $$ begin alter publication supabase_realtime add table public.movimenti_cassa; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.sospesi; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.caparre; exception when duplicate_object then null; end $$;
