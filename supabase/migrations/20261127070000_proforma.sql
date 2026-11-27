-- Proforma: il conto si chiude senza scontrino e senza incasso (famiglia, amici, staff).
-- I piatti restano consumati: escono dal magazzino come una vendita, e il valore resta registrato.
alter table public.comande add column if not exists proforma jsonb;

create or replace function public.chiudi_proforma(
  p_comanda uuid, p_motivo text, p_nome text, p_totale integer, p_operatore uuid, p_key text, p_lavoro jsonb)
returns void
language plpgsql set search_path = '' as $$
declare c public.comande; v_nome text := nullif(trim(coalesce(p_nome, '')), ''); v_op text;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_MANCANTE'; end if;
  select * into c from public.comande where id = p_comanda for update;
  if c.id is null then raise exception 'COMANDA_INESISTENTE'; end if;
  if c.stato = 'chiusa' and c.proforma is not null then return; end if;
  if c.stato in ('chiusa', 'annullata') then raise exception 'COMANDA_CHIUSA'; end if;
  if exists (select 1 from public.documenti where comanda_id = p_comanda and stato in ('emesso','in_emissione','da_verificare')) then
    raise exception 'CONTO_CON_SCONTRINO';
  end if;
  if not exists (select 1 from public.righe_comanda where comanda_id = p_comanda and stato <> 'stornata') then
    raise exception 'CONTO_VUOTO';
  end if;
  select nome into v_op from public.operatori where id = p_operatore;
  update public.comande set stato = 'chiusa', chiusa_at = now(), version = version + 1,
    proforma = jsonb_strip_nulls(jsonb_build_object('motivo', trim(p_motivo), 'nome', v_nome, 'totale_cents', greatest(coalesce(p_totale, 0), 0), 'operatore', v_op))
  where id = p_comanda;
  perform privato.scarica_vendita(p_comanda);
  insert into public.audit_log (locale_id, operatore_id, azione, entita, entita_id, prima, dopo)
  values (c.locale_id, p_operatore, 'proforma', 'comande', c.id, to_jsonb(c),
    jsonb_build_object('motivo', p_motivo, 'nome', v_nome, 'totale_cents', p_totale));
  if p_lavoro is not null then
    perform public.accoda_lavoro(c.locale_id, (p_lavoro->>'stampante_id')::uuid, 'preconto', p_lavoro->'payload', p_key);
  end if;
end $$;

revoke all on function public.chiudi_proforma(uuid, text, text, integer, uuid, text, jsonb) from public, anon;
grant execute on function public.chiudi_proforma(uuid, text, text, integer, uuid, text, jsonb) to authenticated;
