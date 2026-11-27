-- Annulla conto: chiude un conto aperto senza incasso (prove, tavolo aperto per errore, clienti andati via).
-- Solo se non c'è nessuno scontrino emesso o in stampa. Le righe restano, stornate, per lo storico.
create or replace function public.annulla_comanda(
  p_comanda uuid, p_motivo text, p_operatore uuid, p_key text, p_lavori jsonb)
returns void
language plpgsql set search_path = '' as $$
declare c public.comande; l jsonb; i int := 0;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_MANCANTE'; end if;
  select * into c from public.comande where id = p_comanda for update;
  if c.id is null then raise exception 'COMANDA_INESISTENTE'; end if;
  if c.stato = 'annullata' then return; end if;
  if c.stato = 'chiusa' then raise exception 'COMANDA_CHIUSA'; end if;
  if exists (select 1 from public.documenti where comanda_id = p_comanda and stato in ('emesso','in_emissione','da_verificare')) then
    raise exception 'CONTO_CON_SCONTRINO';
  end if;
  update public.righe_comanda set stato = 'stornata', motivo_storno = p_motivo, stornata_da = p_operatore
    where comanda_id = p_comanda and stato <> 'stornata';
  update public.comande set stato = 'annullata', chiusa_at = now(), version = version + 1 where id = p_comanda;
  insert into public.audit_log (locale_id, operatore_id, azione, entita, entita_id, prima, dopo)
  values (c.locale_id, p_operatore, 'annullo_conto', 'comande', c.id, to_jsonb(c), jsonb_build_object('motivo', p_motivo));
  -- Avviso ai reparti per i piatti già inviati (ticket di storno preparati dalla cassa).
  for l in select * from jsonb_array_elements(coalesce(p_lavori, '[]'::jsonb)) loop
    i := i + 1;
    perform public.accoda_lavoro(c.locale_id, (l->>'stampante_id')::uuid, 'comanda', l->'payload', p_key || ':' || i);
  end loop;
end $$;
