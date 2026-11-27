-- Ritorno della linea: la cassa manda quello che ha fatto da sola (comande, righe, scontrini già emessi dall'RT,
-- movimenti del cassetto, chiusure). Niente lavori di stampa: tutto è già uscito sulla carta.
-- Idempotente: si può rimandare lo stesso pacchetto senza doppioni.
create or replace function public.importa_offline(p_locale uuid, p jsonb)
returns jsonb
language plpgsql set search_path = '' as $$
declare c jsonb; r jsonb; d jsonb; x jsonb; v_num int; v_doc public.documenti; v_prima text; v_chiuse int := 0; n_c int := 0; n_d int := 0;
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;

  -- Conti: i nuovi prendono il primo numero libero della giornata; quelli esistenti si aggiornano.
  for c in select * from jsonb_array_elements(coalesce(p->'comande', '[]')) loop
    select stato into v_prima from public.comande where id = (c->>'id')::uuid;
    if v_prima is null then
      select coalesce(max(numero), 0) + 1 into v_num from public.comande where locale_id = p_locale and giorno_servizio = public.giorno_servizio(p_locale);
      insert into public.comande (id, locale_id, numero, giorno_servizio, canale, tavolo_id, coperti, cliente_id, prenotazione_id, operatore_id,
        stato, note, allergeni_tavolo, aperta_at, chiusa_at, proforma, tavoli_uniti)
      values ((c->>'id')::uuid, p_locale, greatest(v_num, (c->>'numero')::int), public.giorno_servizio(p_locale), coalesce(c->>'canale', 'tavolo'),
        (c->>'tavolo_id')::uuid, (c->>'coperti')::int, (c->>'cliente_id')::uuid, (c->>'prenotazione_id')::uuid, (c->>'operatore_id')::uuid,
        c->>'stato', c->>'note', coalesce(c->'allergeni_tavolo', '[]'), (c->>'aperta_at')::timestamptz, (c->>'chiusa_at')::timestamptz,
        nullif(c->'proforma', 'null'::jsonb), coalesce(array(select jsonb_array_elements_text(c->'tavoli_uniti'))::uuid[], '{}'))
      on conflict (id) do nothing;
    else
      update public.comande set tavolo_id = (c->>'tavolo_id')::uuid, coperti = (c->>'coperti')::int, cliente_id = (c->>'cliente_id')::uuid,
        stato = c->>'stato', allergeni_tavolo = coalesce(c->'allergeni_tavolo', '[]'), chiusa_at = (c->>'chiusa_at')::timestamptz,
        proforma = nullif(c->'proforma', 'null'::jsonb), tavoli_uniti = coalesce(array(select jsonb_array_elements_text(c->'tavoli_uniti'))::uuid[], '{}'),
        version = version + 1, updated_at = now()
      where id = (c->>'id')::uuid;
    end if;
    if c->>'stato' = 'chiusa' and coalesce(v_prima, '') <> 'chiusa' then v_chiuse := v_chiuse + 1; end if;
    n_c := n_c + 1;
  end loop;

  -- Righe: inserite o aggiornate così come sono sulla cassa (stato, storni, omaggi).
  for r in select * from jsonb_array_elements(coalesce(p->'righe', '[]')) loop
    insert into public.righe_comanda (id, locale_id, comanda_id, articolo_id, parent_riga_id, descrizione, quantita, prezzo_unitario_cents, varianti, note,
      portata, centro_produzione_id, aliquota_iva_id, allergeni, posto, omaggio, stato, inviata_at, motivo_storno, created_at)
    values ((r->>'id')::uuid, p_locale, (r->>'comanda_id')::uuid, (r->>'articolo_id')::uuid, (r->>'parent_riga_id')::uuid, r->>'descrizione',
      (r->>'quantita')::numeric, (r->>'prezzo_unitario_cents')::int, coalesce(r->'varianti', '[]'), r->>'note', (r->>'portata')::int,
      (r->>'centro_produzione_id')::uuid, (r->>'aliquota_iva_id')::uuid, coalesce(array(select jsonb_array_elements_text(r->'allergeni')), '{}'),
      (r->>'posto')::int, coalesce((r->>'omaggio')::boolean, false), r->>'stato', (r->>'inviata_at')::timestamptz, r->>'motivo_storno',
      coalesce((r->>'created_at')::timestamptz, now()))
    on conflict (id) do update set quantita = excluded.quantita, prezzo_unitario_cents = excluded.prezzo_unitario_cents, varianti = excluded.varianti,
      note = excluded.note, portata = excluded.portata, omaggio = excluded.omaggio, stato = excluded.stato, inviata_at = excluded.inviata_at,
      motivo_storno = excluded.motivo_storno, comanda_id = excluded.comanda_id, updated_at = now();
  end loop;
  -- Righe tolte sulla cassa prima di mandarle in cucina.
  delete from public.righe_comanda where locale_id = p_locale and stato in ('da_inviare', 'in_attesa_marcia')
    and id in (select (jsonb_array_elements_text(coalesce(p->'righe_tolte', '[]')))::uuid);

  -- Documenti: entrano "in emissione" con pagamenti e righe, poi passano allo stato finale (così scattano sospesi e caparre).
  for d in select e.value from jsonb_array_elements(coalesce(p->'documenti', '[]')) e order by (e.value->>'tipo') in ('annullo', 'reso'), e.value->>'created_at' loop
    select * into v_doc from public.documenti where id = (d->>'id')::uuid;
    if v_doc.id is null then
      insert into public.documenti (id, locale_id, comanda_id, tipo, stato, totale_cents, sconto_cents, quota_indice, quota_di, documento_origine_id,
        idempotency_key, created_at)
      values ((d->>'id')::uuid, p_locale, (d->>'comanda_id')::uuid, d->>'tipo', 'in_emissione', (d->>'totale_cents')::int, coalesce((d->>'sconto_cents')::int, 0),
        (d->>'quota_indice')::int, (d->>'quota_di')::int, (d->>'documento_origine_id')::uuid, d->>'idempotency_key', coalesce((d->>'created_at')::timestamptz, now()));
      for x in select * from jsonb_array_elements(coalesce(d->'righe', '[]')) loop
        insert into public.righe_documento (documento_id, descrizione, quantita, prezzo_unitario_cents, importo_cents, reparto_rt)
        values ((d->>'id')::uuid, x->>'descrizione', (x->>'quantita')::numeric, (x->>'prezzo_unitario_cents')::int, (x->>'importo_cents')::int, (x->>'reparto_rt')::int);
      end loop;
      for x in select * from jsonb_array_elements(coalesce(d->'pagamenti', '[]')) loop
        insert into public.pagamenti (locale_id, documento_id, tipo, tipo_rt, importo_cents, descrizione)
        values (p_locale, (d->>'id')::uuid, x->>'tipo', x->>'tipo_rt', (x->>'importo_cents')::int, x->>'descrizione');
      end loop;
      n_d := n_d + 1;
    end if;
    update public.documenti set stato = d->>'stato', errore = d->>'errore',
      rt_z_numero = (d->>'rt_z_numero')::int, rt_doc_numero = (d->>'rt_doc_numero')::int, rt_matricola = d->>'rt_matricola',
      rt_emesso_at = case when d->>'stato' in ('emesso','annullato') then coalesce(rt_emesso_at, (d->>'created_at')::timestamptz) end
    where id = (d->>'id')::uuid and stato is distinct from d->>'stato';
  end loop;

  -- Conti chiusi da soli: gli ingredienti escono dal magazzino come sempre.
  for c in select * from jsonb_array_elements(coalesce(p->'comande', '[]')) loop
    if c->>'stato' = 'chiusa' and not exists (select 1 from public.movimenti_magazzino where locale_id = p_locale and rif_documento = 'comanda ' || (c->>'id')) then
      perform privato.scarica_vendita((c->>'id')::uuid);
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'movimenti', '[]')) loop
    insert into public.movimenti_cassa (id, locale_id, giorno_servizio, tipo, importo_cents, causale, operatore_id, idempotency_key, created_at)
    values ((x->>'id')::uuid, p_locale, public.giorno_servizio(p_locale), x->>'tipo', (x->>'importo_cents')::int, x->>'causale', (x->>'operatore_id')::uuid,
      'offline:' || (x->>'id'), coalesce((x->>'created_at')::timestamptz, now()))
    on conflict do nothing;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'chiusure', '[]')) loop
    insert into public.chiusure (locale_id, giorno_servizio, totali, stampante_id, rt_z_numero)
    values (p_locale, public.giorno_servizio(p_locale), x->'totali', (select id from public.stampanti where locale_id = p_locale and tipo = 'rt_epson_xml' limit 1), (x->>'z')::int)
    on conflict (locale_id, giorno_servizio, stampante_id) do update set totali = excluded.totali, rt_z_numero = coalesce(excluded.rt_z_numero, public.chiusure.rt_z_numero);
  end loop;

  insert into public.audit_log (locale_id, azione, entita, dopo)
  values (p_locale, 'sync_offline', 'comande', jsonb_build_object('comande', n_c, 'documenti', n_d, 'chiuse', v_chiuse));
  return jsonb_build_object('comande', n_c, 'documenti', n_d);
end $$;
revoke all on function public.importa_offline(uuid, jsonb) from public, anon;
grant execute on function public.importa_offline(uuid, jsonb) to authenticated;
