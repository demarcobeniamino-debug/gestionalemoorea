-- Pronto per il servizio: sposta e unisci tavoli, sposta righe, personale con PIN,
-- annullo dello scontrino e chiusura fiscale con i totali della giornata.

revoke all on function public.apri_tavolo(uuid, int, uuid, uuid) from public, anon;
grant execute on function public.apri_tavolo(uuid, int, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Sposta il conto su un tavolo libero.
-- ---------------------------------------------------------------------
create or replace function public.sposta_comanda(p_comanda uuid, p_tavolo uuid) returns public.comande
language plpgsql set search_path = '' as $$
declare c public.comande;
begin
  select * into c from public.comande where id = p_comanda and stato in ('aperta','preconto') for update;
  if c.id is null then raise exception 'COMANDA_CHIUSA'; end if;
  if not exists (select 1 from public.tavoli where id = p_tavolo and locale_id = c.locale_id and attivo) then raise exception 'TAVOLO_INESISTENTE'; end if;
  if exists (select 1 from public.comande where tavolo_id = p_tavolo and stato in ('aperta','preconto')) then raise exception 'TAVOLO_GIA_APERTO'; end if;
  update public.comande set tavolo_id = p_tavolo, version = version + 1, updated_at = now() where id = p_comanda returning * into c;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Unisce due tavoli: le righe e i coperti di p_origine passano su p_destinazione.
-- Non si uniscono conti già pagati in parte (ci sono scontrini emessi).
-- ---------------------------------------------------------------------
create or replace function public.unisci_comande(p_destinazione uuid, p_origine uuid) returns public.comande
language plpgsql set search_path = '' as $$
declare d public.comande; o public.comande;
begin
  if p_destinazione = p_origine then raise exception 'STESSO_TAVOLO'; end if;
  select * into d from public.comande where id = p_destinazione and stato in ('aperta','preconto') for update;
  select * into o from public.comande where id = p_origine and stato in ('aperta','preconto') for update;
  if d.id is null or o.id is null or d.locale_id <> o.locale_id then raise exception 'COMANDA_CHIUSA'; end if;
  if exists (select 1 from public.documenti where comanda_id in (p_destinazione, p_origine) and stato in ('emesso','in_emissione','da_verificare')) then
    raise exception 'CONTO_GIA_PAGATO_IN_PARTE';
  end if;
  update public.righe_comanda set comanda_id = p_destinazione, updated_at = now() where comanda_id = p_origine;
  update public.comande set coperti = d.coperti + o.coperti, stato = 'aperta',
    allergeni_tavolo = d.allergeni_tavolo || o.allergeni_tavolo,
    prenotazione_id = coalesce(d.prenotazione_id, o.prenotazione_id),
    version = version + 1, updated_at = now()
  where id = p_destinazione returning * into d;
  update public.comande set stato = 'annullata', chiusa_at = now(), coperti = 0, version = version + 1, updated_at = now() where id = p_origine;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Sposta alcune righe (anche già inviate) su un altro conto aperto.
-- ---------------------------------------------------------------------
create or replace function public.sposta_righe(p_righe uuid[], p_destinazione uuid) returns integer
language plpgsql set search_path = '' as $$
declare d public.comande; n int;
begin
  select * into d from public.comande where id = p_destinazione and stato in ('aperta','preconto') for update;
  if d.id is null then raise exception 'COMANDA_CHIUSA'; end if;
  if exists (select 1 from public.righe_comanda r join public.documenti doc on doc.comanda_id = r.comanda_id
             where r.id = any(p_righe) and doc.stato in ('emesso','in_emissione','da_verificare')) then
    raise exception 'CONTO_GIA_PAGATO_IN_PARTE';
  end if;
  update public.comande set version = version + 1, updated_at = now()
    where id in (select comanda_id from public.righe_comanda where id = any(p_righe)) or id = p_destinazione;
  update public.righe_comanda set comanda_id = p_destinazione, updated_at = now()
    where id = any(p_righe) and locale_id = d.locale_id and stato <> 'stornata';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Personale: crea o modifica un operatore. Il PIN non può essere uguale a quello di un altro.
-- ---------------------------------------------------------------------
create or replace function public.operatore_salva(
  p_locale uuid, p_id uuid, p_nome text, p_ruolo text, p_pin text, p_attivo boolean, p_permessi jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'NOME_MANCANTE'; end if;
  if p_pin is not null then
    if p_pin !~ '^\d{4,6}$' then raise exception 'PIN_NON_VALIDO'; end if;
    if exists (select 1 from public.operatori o where o.locale_id = p_locale and o.attivo and o.id is distinct from p_id
               and o.pin_hash = extensions.crypt(p_pin, o.pin_hash)) then
      raise exception 'PIN_GIA_USATO';
    end if;
  end if;
  if v_id is null then
    if p_pin is null then raise exception 'PIN_NON_VALIDO'; end if;
    insert into public.operatori (locale_id, nome, ruolo, pin_hash, attivo, permessi)
    values (p_locale, trim(p_nome), p_ruolo, extensions.crypt(p_pin, extensions.gen_salt('bf')), coalesce(p_attivo, true), coalesce(p_permessi, '{}'))
    returning id into v_id;
  else
    update public.operatori set nome = trim(p_nome), ruolo = p_ruolo, attivo = coalesce(p_attivo, attivo),
      permessi = coalesce(p_permessi, permessi),
      pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end,
      updated_at = now()
    where id = v_id and locale_id = p_locale;
    if not found then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Annullo di uno scontrino: documento di annullo stampato dall'RT con il riferimento all'originale.
-- Quando l'RT conferma, l'originale risulta annullato (vedi esito_lavoro).
-- ---------------------------------------------------------------------
create or replace function public.annulla_documento(
  p_documento uuid, p_stampante uuid, p_key text, p_operatore uuid, p_xml text) returns public.documenti
language plpgsql set search_path = '' as $$
declare o public.documenti; d public.documenti;
begin
  select * into o from public.documenti where id = p_documento for update;
  if o.id is null or o.tipo <> 'documento_commerciale' or o.stato <> 'emesso' then raise exception 'DOCUMENTO_NON_ANNULLABILE'; end if;
  select * into d from public.documenti where locale_id = o.locale_id and idempotency_key = p_key;
  if d.id is not null then return d; end if;
  if exists (select 1 from public.documenti where documento_origine_id = p_documento and stato in ('in_emissione','emesso','da_verificare')) then
    raise exception 'ANNULLO_GIA_RICHIESTO';
  end if;
  insert into public.documenti (locale_id, comanda_id, tipo, stato, totale_cents, sconto_cents, stampante_id, documento_origine_id, operatore_id, idempotency_key)
  values (o.locale_id, null, 'annullo', 'in_emissione', o.totale_cents, o.sconto_cents, p_stampante, o.id, p_operatore, p_key)
  returning * into d;
  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, documento_id, idempotency_key)
  values (o.locale_id, p_stampante, 'annullo', jsonb_build_object('xml', p_xml), d.id, p_key);
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Chiusura fiscale (Z) a fine giornata, con i totali calcolati dalla cassa.
-- ---------------------------------------------------------------------
create or replace function public.chiusura_giornaliera(
  p_locale uuid, p_stampante uuid, p_key text, p_operatore uuid, p_xml text, p_totali jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_giorno date; v_job uuid;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  v_giorno := public.giorno_servizio(p_locale);
  select id into v_job from public.print_jobs where locale_id = p_locale and idempotency_key = p_key;
  if v_job is not null then return v_job; end if;
  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, idempotency_key)
  values (p_locale, p_stampante, 'chiusura_fiscale', jsonb_build_object('xml', p_xml), p_key)
  returning id into v_job;
  insert into public.chiusure (locale_id, giorno_servizio, totali, stampante_id, operatore_id)
  values (p_locale, v_giorno, p_totali, p_stampante, p_operatore)
  on conflict (locale_id, giorno_servizio, stampante_id) do update set totali = excluded.totali, operatore_id = excluded.operatore_id;
  return v_job;
end $$;

-- esito_lavoro: come prima; in più l'annullo confermato segna l'originale come annullato
-- e la chiusura confermata salva il numero di Z.
create or replace function public.esito_lavoro(
  p_job uuid, p_ok boolean, p_incerto boolean, p_errore text,
  p_z_numero int default null, p_doc_numero int default null, p_matricola text default null)
returns void
language plpgsql set search_path = '' as $$
declare j public.print_jobs; d public.documenti; v_pagato int; v_quote int; v_chiusa uuid;
begin
  update public.print_jobs set
    stato = case when p_ok then 'stampato' when p_incerto then 'da_verificare' else 'errore' end,
    tentativi = tentativi + 1, errore = p_errore,
    esito = jsonb_build_object('z', p_z_numero, 'numero', p_doc_numero)
  where id = p_job returning * into j;

  if j.tipo = 'chiusura_fiscale' and p_ok then
    update public.chiusure set rt_z_numero = p_z_numero
      where locale_id = j.locale_id and stampante_id = j.stampante_id and giorno_servizio = public.giorno_servizio(j.locale_id);
  end if;
  if j.documento_id is null then return; end if;

  update public.documenti set
    stato = case when p_ok then 'emesso' when p_incerto then 'da_verificare' else 'errore' end,
    errore = p_errore,
    rt_z_numero = case when p_ok then p_z_numero end,
    rt_doc_numero = case when p_ok then p_doc_numero end,
    rt_matricola = case when p_ok then p_matricola end,
    rt_emesso_at = case when p_ok then now() end
  where id = j.documento_id returning * into d;

  if p_ok and d.tipo = 'annullo' and d.documento_origine_id is not null then
    update public.documenti set stato = 'annullato' where id = d.documento_origine_id;
    return;
  end if;

  if p_ok and d.comanda_id is not null then
    select coalesce(sum(totale_cents + sconto_cents), 0), count(*) filter (where quota_di is not null)
      into v_pagato, v_quote
    from public.documenti where comanda_id = d.comanda_id and stato = 'emesso';
    if v_pagato >= public.totale_comanda(d.comanda_id) or (d.quota_di is not null and v_quote >= d.quota_di) then
      update public.comande set stato = 'chiusa', chiusa_at = now()
        where id = d.comanda_id and stato <> 'chiusa' returning id into v_chiusa;
      if v_chiusa is not null then perform privato.scarica_vendita(v_chiusa); end if;
    end if;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['sposta_comanda(uuid,uuid)', 'unisci_comande(uuid,uuid)', 'sposta_righe(uuid[],uuid)',
    'operatore_salva(uuid,uuid,text,text,text,boolean,jsonb)', 'annulla_documento(uuid,uuid,text,uuid,text)',
    'chiusura_giornaliera(uuid,uuid,text,uuid,text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
