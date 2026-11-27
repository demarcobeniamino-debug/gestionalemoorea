-- Reso parziale: documento commerciale di reso (REFUND) con il riferimento allo scontrino originale.
-- Si possono fare più resi sullo stesso scontrino, mai oltre il suo totale. Il rimborso va nei pagamenti del reso.
create or replace function public.reso_documento(
  p_documento uuid, p_stampante uuid, p_key text, p_operatore uuid, p_xml text,
  p_totale integer, p_sconto integer, p_righe jsonb, p_rimborso text)
returns public.documenti
language plpgsql set search_path = '' as $$
declare o public.documenti; d public.documenti; v_resi int; r jsonb;
begin
  select * into o from public.documenti where id = p_documento for update;
  if o.id is null or o.tipo <> 'documento_commerciale' or o.stato <> 'emesso' then raise exception 'DOCUMENTO_NON_ANNULLABILE'; end if;
  select * into d from public.documenti where locale_id = o.locale_id and idempotency_key = p_key;
  if d.id is not null then return d; end if;
  if p_rimborso not in ('contanti', 'carta') then raise exception 'RIMBORSO_NON_VALIDO'; end if;
  if coalesce(p_totale, 0) <= 0 then raise exception 'RESO_VUOTO'; end if;
  select coalesce(sum(totale_cents), 0) into v_resi from public.documenti
    where documento_origine_id = p_documento and tipo = 'reso' and stato in ('in_emissione','emesso','da_verificare');
  if v_resi + p_totale > o.totale_cents then raise exception 'RESO_OLTRE_IL_TOTALE'; end if;

  insert into public.documenti (locale_id, comanda_id, tipo, stato, totale_cents, sconto_cents, stampante_id, documento_origine_id, operatore_id, idempotency_key)
  values (o.locale_id, null, 'reso', 'in_emissione', p_totale, coalesce(p_sconto, 0), p_stampante, o.id, p_operatore, p_key)
  returning * into d;
  for r in select * from jsonb_array_elements(p_righe) loop
    insert into public.righe_documento (documento_id, descrizione, quantita, prezzo_unitario_cents, importo_cents, reparto_rt)
    values (d.id, r->>'descrizione', (r->>'quantita')::numeric, (r->>'prezzoUnitarioCents')::int,
            round((r->>'quantita')::numeric * (r->>'prezzoUnitarioCents')::int)::int, (r->>'repartoRt')::int);
  end loop;
  insert into public.pagamenti (locale_id, documento_id, tipo, tipo_rt, importo_cents)
  values (o.locale_id, d.id, p_rimborso, case when p_rimborso = 'contanti' then 'contanti' else 'elettronico' end, p_totale);
  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, documento_id, idempotency_key)
  values (o.locale_id, p_stampante, 'reso', jsonb_build_object('xml', p_xml), d.id, p_key);
  insert into public.audit_log (locale_id, operatore_id, azione, entita, entita_id, prima, dopo)
  values (o.locale_id, p_operatore, 'reso', 'documenti', o.id, null, jsonb_build_object('totale_cents', p_totale, 'rimborso', p_rimborso));
  return d;
end $$;
revoke all on function public.reso_documento(uuid, uuid, text, uuid, text, integer, integer, jsonb, text) from public, anon;
grant execute on function public.reso_documento(uuid, uuid, text, uuid, text, integer, integer, jsonb, text) to authenticated;
