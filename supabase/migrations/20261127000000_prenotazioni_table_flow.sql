-- Prenotazioni da Moorea Table Flow (Lovable) e stati del tavolo rimandati indietro.
-- Table Flow resta il sistema delle prenotazioni: qui arriva una copia, aggiornata dalla funzione
-- "prenotazioni" (edge function) che legge GET /api/public/gestionale/prenotazioni.
-- Gli stati decisi in cassa (seduto, comanda presa, chiuso, non presentato) passano dalla coda
-- prenotazioni_uscita e vengono inviati con POST /api/public/gestionale/stato.

alter table public.integrazioni drop constraint if exists integrazioni_tipo_check;
alter table public.integrazioni add constraint integrazioni_tipo_check
  check (tipo in ('thefork','plateform','sdi_intermediario','pos_terminale','sms','email','pms_hotel','table_flow'));

alter table public.prenotazioni
  add column if not exists tavoli_ext text[] not null default '{}',   -- codici tavolo su Table Flow (anche più tavoli uniti)
  add column if not exists tag text[] not null default '{}',          -- etichette di Table Flow (vip, celiaco, compleanno…)
  add column if not exists stato_ext text;                            -- stato originale su Table Flow

create unique index if not exists prenotazioni_locale_ext on public.prenotazioni (locale_id, ext_id) where ext_id is not null;
create index if not exists prenotazioni_locale_inizio on public.prenotazioni (locale_id, inizio_at);

-- ---------------------------------------------------------------------
-- Coda di ritorno verso Table Flow.
-- ---------------------------------------------------------------------
create table if not exists public.prenotazioni_uscita (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  prenotazione_id uuid not null references public.prenotazioni(id) on delete cascade,
  ext_id text not null,
  azione text not null check (azione in ('seduto','comanda','completata','no_show')),
  creata_at timestamptz not null default now(),
  presa_at timestamptz,
  inviata_at timestamptz,
  tentativi integer not null default 0,
  errore text
);
create index if not exists prenotazioni_uscita_da_inviare on public.prenotazioni_uscita (locale_id, creata_at) where inviata_at is null;
alter table public.prenotazioni_uscita enable row level security;
create policy prenotazioni_uscita_locale on public.prenotazioni_uscita for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));

create or replace function privato.accoda_uscita(p_pren uuid, p_azione text) returns void
language plpgsql set search_path = '' as $$
declare p public.prenotazioni;
begin
  select * into p from public.prenotazioni where id = p_pren;
  if p.ext_id is null then return; end if;
  -- Una sola volta per azione e prenotazione.
  if exists (select 1 from public.prenotazioni_uscita where prenotazione_id = p_pren and azione = p_azione) then return; end if;
  insert into public.prenotazioni_uscita (locale_id, prenotazione_id, ext_id, azione)
  values (p.locale_id, p.id, p.ext_id, p_azione);
end $$;
revoke all on function privato.accoda_uscita(uuid, text) from public, anon;
grant execute on function privato.accoda_uscita(uuid, text) to authenticated;

-- Cambi di stato fatti in cassa (non quelli importati) → coda.
create or replace function privato.prenotazione_cambiata() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gr.importa', true), '') = '1' then return new; end if;
  if new.stato is distinct from old.stato then
    if new.stato = 'arrivata' then perform privato.accoda_uscita(new.id, 'seduto');
    elsif new.stato = 'terminata' then perform privato.accoda_uscita(new.id, 'completata');
    elsif new.stato = 'mancata' then perform privato.accoda_uscita(new.id, 'no_show');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists prenotazioni_cambiata on public.prenotazioni;
create trigger prenotazioni_cambiata after update on public.prenotazioni
  for each row execute function privato.prenotazione_cambiata();

-- Conto chiuso → prenotazione terminata.
create or replace function privato.comanda_chiusa() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.prenotazione_id is not null and new.stato = 'chiusa' and old.stato is distinct from 'chiusa' then
    update public.prenotazioni set stato = 'terminata', updated_at = now()
      where id = new.prenotazione_id and stato in ('richiesta','confermata','arrivata');
  end if;
  return new;
end $$;
drop trigger if exists comande_chiusa_prenotazione on public.comande;
create trigger comande_chiusa_prenotazione after update of stato on public.comande
  for each row execute function privato.comanda_chiusa();

-- Primo invio in cucina → "comanda presa" su Table Flow.
create or replace function privato.primo_invio() returns trigger
language plpgsql set search_path = '' as $$
declare v_pren uuid;
begin
  select prenotazione_id into v_pren from public.comande where id = new.comanda_id;
  if v_pren is not null and new.tipo = 'invio' then perform privato.accoda_uscita(v_pren, 'comanda'); end if;
  return new;
end $$;
drop trigger if exists invii_primo_comanda on public.invii_produzione;
create trigger invii_primo_comanda after insert on public.invii_produzione
  for each row execute function privato.primo_invio();

-- ---------------------------------------------------------------------
-- Apri tavolo, anche da una prenotazione (la prenotazione diventa "arrivata" su quel tavolo).
-- ---------------------------------------------------------------------
drop function if exists public.apri_tavolo(uuid, int, uuid);
create or replace function public.apri_tavolo(p_tavolo uuid, p_coperti int, p_operatore uuid, p_prenotazione uuid default null)
returns public.comande
language plpgsql set search_path = '' as $$
declare
  v_locale uuid; v_giorno date; v_numero int; c public.comande; v_allergeni jsonb;
begin
  select t.locale_id into v_locale from public.tavoli t where t.id = p_tavolo;
  if v_locale is null then raise exception 'TAVOLO_INESISTENTE'; end if;
  v_giorno := public.giorno_servizio(v_locale);
  perform pg_advisory_xact_lock(hashtext(v_locale::text || v_giorno::text));
  select coalesce(max(numero), 0) + 1 into v_numero from public.comande where locale_id = v_locale and giorno_servizio = v_giorno;
  if p_prenotazione is not null then
    select coalesce(jsonb_agg(jsonb_build_object('allergene', a)), '[]'::jsonb) into v_allergeni
      from public.prenotazioni p, unnest(p.allergeni) a where p.id = p_prenotazione and p.locale_id = v_locale;
  end if;
  begin
    insert into public.comande (locale_id, numero, giorno_servizio, canale, tavolo_id, coperti, operatore_id, prenotazione_id, allergeni_tavolo)
    values (v_locale, v_numero, v_giorno, 'tavolo', p_tavolo, p_coperti, p_operatore, p_prenotazione, coalesce(v_allergeni, '[]'::jsonb))
    returning * into c;
  exception when unique_violation then
    raise exception 'TAVOLO_GIA_APERTO';
  end;
  if p_prenotazione is not null then
    begin
      update public.prenotazioni set stato = 'arrivata', tavolo_id = p_tavolo, updated_at = now()
        where id = p_prenotazione and locale_id = v_locale;
    exception when exclusion_violation then
      -- Il tavolo risulta già prenotato in quell'orario: la prenotazione arriva lo stesso, senza tavolo fisso.
      update public.prenotazioni set stato = 'arrivata', updated_at = now() where id = p_prenotazione and locale_id = v_locale;
    end;
  end if;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Importazione da Table Flow. p_righe = "prenotazioni" della risposta GET.
-- Il tavolo si collega per numero (codice Table Flow = numero del tavolo in cassa).
-- ---------------------------------------------------------------------
create or replace function public.importa_prenotazioni(p_locale uuid, p_righe jsonb) returns integer
language plpgsql set search_path = '' as $$
declare
  r jsonb; n int := 0; v_tavolo uuid; v_stato text; v_fonte text; v_inizio timestamptz; v_fine timestamptz;
  v_tag text[]; v_allergeni text[]; v_note text; v_id uuid; v_locale_stato text;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  perform set_config('gr.importa', '1', true);
  for r in select * from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) loop
    v_inizio := (r->>'inizio')::timestamptz;
    v_fine := v_inizio + make_interval(mins => greatest(15, coalesce((r->>'durata_min')::int, 105)));
    v_stato := case r->>'stato'
      when 'da_confermare' then 'richiesta'
      when 'arrivato' then 'arrivata' when 'seduto' then 'arrivata'
      when 'no_show' then 'mancata' when 'cancellata' then 'cancellata'
      when 'completata' then 'terminata'
      else 'confermata' end;
    v_fonte := case r->>'fonte'
      when 'sito' then 'web' when 'thefork' then 'thefork' when 'walkin' then 'walkin' when 'telefono' then 'telefono'
      else 'altro' end;
    select coalesce(array_agg(x), '{}') into v_tag from jsonb_array_elements_text(coalesce(r->'tag', '[]'::jsonb)) x;
    v_allergeni := case when 'celiaco' = any(v_tag) then array['glutine'] else '{}' end;
    v_note := nullif(concat_ws(' · ',
      nullif(trim(r->>'note'), ''),
      case when 'allergie' = any(v_tag) then 'Allergie: chiedere al tavolo' end,
      case when r->>'fonte' in ('whatsapp','instagram','hotel') then 'da ' || (r->>'fonte') end), '');
    v_tavolo := null;
    select t.id into v_tavolo from public.tavoli t, jsonb_array_elements_text(coalesce(r->'tavoli', '[]'::jsonb)) codice
      where t.locale_id = p_locale and t.attivo and t.numero = codice limit 1;

    -- Lo stato deciso in cassa non torna indietro per un'importazione vecchia.
    v_id := null; v_locale_stato := null;
    select id, stato into v_id, v_locale_stato from public.prenotazioni where locale_id = p_locale and ext_id = r->>'id';
    if v_locale_stato in ('arrivata','terminata','mancata') and v_stato in ('confermata','richiesta') then v_stato := v_locale_stato; end if;

    if v_id is null then
      begin
        insert into public.prenotazioni (locale_id, nome_ospite, telefono, inizio_at, fine_at, coperti, tavolo_id, stato, fonte,
          ext_id, note, allergeni, tavoli_ext, tag, stato_ext)
        values (p_locale, r->>'nome', r->>'telefono', v_inizio, v_fine, greatest(1, (r->>'coperti')::int), v_tavolo, v_stato, v_fonte,
          r->>'id', v_note, v_allergeni,
          array(select jsonb_array_elements_text(coalesce(r->'tavoli', '[]'::jsonb))), v_tag, r->>'stato');
      exception when exclusion_violation then
        insert into public.prenotazioni (locale_id, nome_ospite, telefono, inizio_at, fine_at, coperti, tavolo_id, stato, fonte,
          ext_id, note, allergeni, tavoli_ext, tag, stato_ext)
        values (p_locale, r->>'nome', r->>'telefono', v_inizio, v_fine, greatest(1, (r->>'coperti')::int), null, v_stato, v_fonte,
          r->>'id', v_note, v_allergeni,
          array(select jsonb_array_elements_text(coalesce(r->'tavoli', '[]'::jsonb))), v_tag, r->>'stato');
      end;
    else
      begin
        update public.prenotazioni set nome_ospite = r->>'nome', telefono = r->>'telefono', inizio_at = v_inizio, fine_at = v_fine,
          coperti = greatest(1, (r->>'coperti')::int), tavolo_id = coalesce(v_tavolo, tavolo_id), stato = v_stato, fonte = v_fonte,
          note = v_note, allergeni = v_allergeni, tavoli_ext = array(select jsonb_array_elements_text(coalesce(r->'tavoli', '[]'::jsonb))),
          tag = v_tag, stato_ext = r->>'stato', updated_at = now()
        where id = v_id;
      exception when exclusion_violation then
        update public.prenotazioni set nome_ospite = r->>'nome', telefono = r->>'telefono', inizio_at = v_inizio, fine_at = v_fine,
          coperti = greatest(1, (r->>'coperti')::int), tavolo_id = null, stato = v_stato, fonte = v_fonte,
          note = v_note, allergeni = v_allergeni, tavoli_ext = array(select jsonb_array_elements_text(coalesce(r->'tavoli', '[]'::jsonb))),
          tag = v_tag, stato_ext = r->>'stato', updated_at = now()
        where id = v_id;
      end;
    end if;
    n := n + 1;
  end loop;
  perform set_config('gr.importa', '', true);
  return n;
end $$;
revoke all on function public.importa_prenotazioni(uuid, jsonb) from public, anon;
grant execute on function public.importa_prenotazioni(uuid, jsonb) to authenticated;

-- Prende fino a p_max stati da inviare (gli altri dispositivi saltano quelli presi da meno di 2 minuti).
create or replace function public.prendi_uscite(p_locale uuid, p_max int default 50)
returns setof public.prenotazioni_uscita
language plpgsql set search_path = '' as $$
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  return query
  update public.prenotazioni_uscita u set presa_at = now(), tentativi = u.tentativi + 1
  where u.id in (
    select id from public.prenotazioni_uscita
    where locale_id = p_locale and inviata_at is null and tentativi < 20
      and (presa_at is null or presa_at < now() - interval '2 minutes')
    order by creata_at limit p_max for update skip locked)
  returning u.*;
end $$;
revoke all on function public.prendi_uscite(uuid, int) from public, anon;
grant execute on function public.prendi_uscite(uuid, int) to authenticated;

-- Tempo reale: le prenotazioni importate compaiono subito in sala.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prenotazioni') then
    alter publication supabase_realtime add table public.prenotazioni;
  end if;
end $$;
