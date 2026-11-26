-- Pannello Gestione: magazzino (movimenti e scarico automatico dalle ricette)
-- e aggiornamento in tempo reale del listino su tutte le casse e i palmari.

-- ---------------------------------------------------------------------
-- Movimento di magazzino: carico, scarico, scarto, inventario.
-- p_righe: [{ "mag_articolo_id": uuid, "quantita": numero, "costo_unitario_cents": int|null }]
-- La quantità si scrive sempre positiva nell'unità d'uso (kg, l, pz):
--   carico           → la giacenza sale
--   scarico, scarto  → la giacenza scende
--   inventario       → la quantità è quella contata: la giacenza diventa quella,
--                      e nel movimento resta la differenza (con segno).
-- ---------------------------------------------------------------------
create or replace function public.registra_movimento(
  p_locale uuid, p_tipo text, p_data date, p_fornitore uuid, p_rif text,
  p_operatore uuid, p_righe jsonb)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_mov uuid; r jsonb; v_art uuid; v_q numeric; v_costo int; v_attuale numeric; v_delta numeric;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  if p_tipo not in ('carico','scarico','scarto','inventario') then raise exception 'TIPO_MOVIMENTO_NON_VALIDO'; end if;
  if p_righe is null or jsonb_array_length(p_righe) = 0 then raise exception 'MOVIMENTO_VUOTO'; end if;

  insert into public.movimenti_magazzino (locale_id, tipo, data, fornitore_id, rif_documento, operatore_id)
  values (p_locale, p_tipo, coalesce(p_data, public.giorno_servizio(p_locale)), p_fornitore, nullif(p_rif, ''), p_operatore)
  returning id into v_mov;

  for r in select * from jsonb_array_elements(p_righe) loop
    v_art := (r->>'mag_articolo_id')::uuid;
    v_q := (r->>'quantita')::numeric;
    v_costo := nullif(r->>'costo_unitario_cents', '')::int;
    if v_q is null or v_q < 0 then raise exception 'QUANTITA_NON_VALIDA'; end if;

    insert into public.scorte (locale_id, mag_articolo_id, giacenza) values (p_locale, v_art, 0)
    on conflict (locale_id, mag_articolo_id) do nothing;
    select giacenza into v_attuale from public.scorte
      where locale_id = p_locale and mag_articolo_id = v_art for update;

    v_delta := case p_tipo
      when 'carico' then v_q
      when 'inventario' then v_q - v_attuale
      else -v_q end;

    update public.scorte set giacenza = giacenza + v_delta, updated_at = now()
      where locale_id = p_locale and mag_articolo_id = v_art;
    insert into public.righe_movimento (movimento_id, mag_articolo_id, quantita, costo_unitario_cents)
      values (v_mov, v_art, v_delta, v_costo);
    if p_tipo = 'carico' and v_costo is not null then
      update public.mag_articoli set costo_ultimo_cents = v_costo, updated_at = now() where id = v_art;
    end if;
  end loop;
  return v_mov;
end $$;

revoke all on function public.registra_movimento(uuid, text, date, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.registra_movimento(uuid, text, date, uuid, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Scarico automatico: quando un conto si chiude, gli ingredienti delle ricette
-- (distinte) dei piatti venduti escono dal magazzino. Le righe stornate non contano.
-- quantità scaricata = porzioni × quantità netta ÷ resa
-- ---------------------------------------------------------------------
create or replace function privato.scarica_vendita(p_comanda uuid) returns void
language plpgsql set search_path = '' as $$
declare v_locale uuid; v_mov uuid; x record;
begin
  select locale_id into v_locale from public.comande where id = p_comanda;
  if not exists (
    select 1 from public.righe_comanda rc join public.distinte d on d.articolo_id = rc.articolo_id
    where rc.comanda_id = p_comanda and rc.stato <> 'stornata') then
    return;
  end if;

  insert into public.movimenti_magazzino (locale_id, tipo, data, rif_documento)
  values (v_locale, 'vendita', public.giorno_servizio(v_locale), 'comanda ' || p_comanda)
  returning id into v_mov;

  for x in
    select d.mag_articolo_id, sum(rc.quantita * d.quantita / (d.resa_pct / 100)) as q
    from public.righe_comanda rc join public.distinte d on d.articolo_id = rc.articolo_id
    where rc.comanda_id = p_comanda and rc.stato <> 'stornata'
    group by d.mag_articolo_id
  loop
    insert into public.scorte (locale_id, mag_articolo_id, giacenza) values (v_locale, x.mag_articolo_id, -x.q)
    on conflict (locale_id, mag_articolo_id) do update set giacenza = public.scorte.giacenza - x.q, updated_at = now();
    insert into public.righe_movimento (movimento_id, mag_articolo_id, quantita) values (v_mov, x.mag_articolo_id, -x.q);
  end loop;
end $$;

revoke all on function privato.scarica_vendita(uuid) from public, anon;
grant execute on function privato.scarica_vendita(uuid) to authenticated;

-- esito_lavoro: come prima, ma alla chiusura del conto scarica il magazzino (una volta sola).
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
  if j.documento_id is null then return; end if;

  update public.documenti set
    stato = case when p_ok then 'emesso' when p_incerto then 'da_verificare' else 'errore' end,
    errore = p_errore,
    rt_z_numero = case when p_ok then p_z_numero end,
    rt_doc_numero = case when p_ok then p_doc_numero end,
    rt_matricola = case when p_ok then p_matricola end,
    rt_emesso_at = case when p_ok then now() end
  where id = j.documento_id returning * into d;

  if p_ok then
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

-- ---------------------------------------------------------------------
-- Tempo reale: quando si cambia il listino o la sala dalla Gestione,
-- casse e palmari si aggiornano da soli.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categorie','sale','prezzi_listino','varianti','articolo_varianti',
                           'stampanti','centri_produzione','aliquote_iva','scorte'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Indici per le liste della Gestione.
create index if not exists movimenti_magazzino_locale_data on public.movimenti_magazzino (locale_id, data desc);
create index if not exists righe_movimento_movimento on public.righe_movimento (movimento_id);
create index if not exists distinte_mag_articolo on public.distinte (mag_articolo_id);
