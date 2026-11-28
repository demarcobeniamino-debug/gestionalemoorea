-- Comande che non escono (stampante spenta, cavo staccato, porta occupata):
-- prima si arrendevano dopo 3 tentativi in 2 secondi. Ora la cassa riprova da sola ogni 10 secondi
-- per 10 minuti, e chiunque può rimandarle subito o spostarle su un'altra stampante.

create or replace function public.prendi_lavori(p_locale uuid, p_max int default 10)
returns setof public.print_jobs
language plpgsql set search_path = '' as $$
begin
  -- Un lavoro fiscale rimasto "preso" senza esito (cassa spenta a metà) non si ripete: va verificato.
  update public.print_jobs set stato = 'da_verificare', errore = 'Nessun esito dal registratore: verificare prima di riprovare'
  where locale_id = p_locale and stato = 'preso' and tipo in ('documento_commerciale','annullo','reso','chiusura_fiscale')
    and preso_at < now() - interval '90 seconds';
  update public.documenti d set stato = 'da_verificare'
  from public.print_jobs j where j.documento_id = d.id and j.stato = 'da_verificare' and d.stato = 'in_emissione';

  -- Vecchi di più di 10 minuti e mai partiti: niente raffiche di comande vecchie quando si riaccende la cassa.
  update public.print_jobs set stato = 'sospeso',
    errore = 'Non è uscito per 10 minuti: scegli se stamparlo o scartarlo'
  where locale_id = p_locale and stato in ('in_coda','errore')
    and coalesce(confermato_at, created_at) < now() - interval '10 minutes'
    and (stato = 'in_coda' or tipo in ('comanda','preconto','non_fiscale'));

  return query
  update public.print_jobs j set stato = 'preso', preso_at = now()
  where j.id in (
    select x.id from public.print_jobs x
    where x.locale_id = p_locale and (
      x.stato = 'in_coda'
      or (x.stato = 'errore' and x.tipo in ('comanda','preconto','non_fiscale')
          and coalesce(x.preso_at, x.created_at) < now() - interval '10 seconds')
      or (x.stato = 'preso' and x.tipo in ('comanda','preconto','non_fiscale') and x.preso_at < now() - interval '60 seconds'))
    order by x.created_at
    for update skip locked
    limit p_max)
  returning j.*;
end $$;

-- Rimanda subito una stampa non fiscale, sulla stessa stampante o su un'altra del locale.
create or replace function public.rimanda_lavoro(p_job uuid, p_stampante uuid default null)
returns void
language plpgsql set search_path = '' as $$
declare j public.print_jobs;
begin
  select * into j from public.print_jobs where id = p_job for update;
  if j.id is null then return; end if;
  if j.tipo not in ('comanda','preconto','non_fiscale') then raise exception 'SOLO_NON_FISCALI'; end if;
  if j.stato not in ('errore','sospeso','in_coda') then return; end if;
  if p_stampante is not null and not exists (
    select 1 from public.stampanti s where s.id = p_stampante and s.locale_id = j.locale_id and s.tipo = 'comande_escpos'
  ) then raise exception 'STAMPANTE_NON_VALIDA'; end if;
  update public.print_jobs set stato = 'in_coda', errore = null, tentativi = 0, confermato_at = now(), preso_at = null,
    stampante_id = coalesce(p_stampante, stampante_id)
  where id = p_job;
end $$;
revoke all on function public.rimanda_lavoro(uuid, uuid) from public, anon;
grant execute on function public.rimanda_lavoro(uuid, uuid) to authenticated;
