-- v0.8: lo scontrino salva il nome del metodo di pagamento (Satispay, camera, caparra:<id>).
create or replace function public.incassa(
  p_comanda uuid, p_stampante uuid, p_key text, p_operatore uuid,
  p_totale int, p_sconto int, p_quota_indice int, p_quota_di int,
  p_righe jsonb, p_pagamenti jsonb, p_xml text)
returns public.documenti
language plpgsql set search_path = '' as $$
declare v_locale uuid; d public.documenti; r jsonb; p jsonb;
begin
  select locale_id into v_locale from public.comande where id = p_comanda and stato in ('aperta','preconto') for update;
  if v_locale is null then raise exception 'COMANDA_CHIUSA'; end if;

  select * into d from public.documenti where locale_id = v_locale and idempotency_key = p_key;
  if d.id is not null then return d; end if;

  if exists (select 1 from public.documenti where comanda_id = p_comanda and stato in ('in_emissione','da_verificare')) then
    raise exception 'SCONTRINO_IN_SOSPESO';
  end if;
  if exists (select 1 from public.righe_comanda where comanda_id = p_comanda and stato = 'da_inviare') then
    raise exception 'RIGHE_NON_INVIATE';
  end if;

  insert into public.documenti (locale_id, comanda_id, tipo, stato, totale_cents, sconto_cents, quota_indice, quota_di,
                                stampante_id, operatore_id, idempotency_key)
  values (v_locale, p_comanda, 'documento_commerciale', 'in_emissione', p_totale, coalesce(p_sconto, 0), p_quota_indice, p_quota_di,
          p_stampante, p_operatore, p_key)
  returning * into d;

  for r in select * from jsonb_array_elements(p_righe) loop
    insert into public.righe_documento (documento_id, descrizione, quantita, prezzo_unitario_cents, importo_cents, reparto_rt)
    values (d.id, r->>'descrizione', (r->>'quantita')::numeric, (r->>'prezzoUnitarioCents')::int,
            round((r->>'prezzoUnitarioCents')::int * (r->>'quantita')::numeric)::int, (r->>'repartoRt')::int);
  end loop;
  for p in select * from jsonb_array_elements(p_pagamenti) loop
    if p->>'descrizione' like 'caparra:%' and not exists (
      select 1 from public.caparre where id = substring(p->>'descrizione' from 9)::uuid and locale_id = v_locale and stato = 'aperta') then
      raise exception 'CAPARRA_NON_DISPONIBILE';
    end if;
    insert into public.pagamenti (locale_id, documento_id, tipo, tipo_rt, importo_cents, descrizione)
    values (v_locale, d.id, p->>'tipo', p->>'tipoRt', (p->>'importoCents')::int, nullif(p->>'descrizione', ''));
  end loop;

  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, documento_id, idempotency_key)
  values (v_locale, p_stampante, 'documento_commerciale', jsonb_build_object('xml', p_xml), d.id, p_key);
  return d;
end $$;

