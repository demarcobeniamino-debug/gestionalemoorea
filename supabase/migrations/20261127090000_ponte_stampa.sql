-- La cassa che stampa ("ponte") batte un colpo ogni 30 secondi: così palmari e telefoni sanno se le comande escono.
-- Con il battito viaggia lo stato del registratore (carta, Z da fare, invii rifiutati, orologio).
create table if not exists public.ponti_stampa (
  id uuid primary key default gen_random_uuid(),
  locale_id uuid not null references public.locali(id) on delete cascade,
  nome text not null,
  versione text,
  visto_at timestamptz not null default now(),
  stato_rt jsonb,
  stato_rt_at timestamptz,
  unique (locale_id, nome)
);
alter table public.ponti_stampa enable row level security;
create policy ponti_stampa_locale on public.ponti_stampa for all to authenticated
  using (privato.mio_locale(locale_id)) with check (privato.mio_locale(locale_id));

create or replace function public.battito_ponte(p_locale uuid, p_nome text, p_versione text, p_stato_rt jsonb)
returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.ponti_stampa (locale_id, nome, versione, visto_at, stato_rt, stato_rt_at)
  values (p_locale, p_nome, p_versione, now(), p_stato_rt, case when p_stato_rt is null then null else now() end)
  on conflict (locale_id, nome) do update set
    visto_at = now(), versione = excluded.versione,
    stato_rt = coalesce(excluded.stato_rt, public.ponti_stampa.stato_rt),
    stato_rt_at = coalesce(excluded.stato_rt_at, public.ponti_stampa.stato_rt_at);
end $$;
revoke all on function public.battito_ponte(uuid, text, text, jsonb) from public, anon;
grant execute on function public.battito_ponte(uuid, text, text, jsonb) to authenticated;

-- Lavori rimasti in coda a cassa spenta: dopo 10 minuti non escono più da soli ("sospeso"), decide la cassa.
alter table public.print_jobs drop constraint if exists print_jobs_stato_check;
alter table public.print_jobs add constraint print_jobs_stato_check
  check (stato in ('in_coda','preso','stampato','errore','da_verificare','annullato','sospeso'));
alter table public.print_jobs add column if not exists confermato_at timestamptz;

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
    errore = 'Rimasto in coda mentre nessuna cassa stampava: scegli se stamparlo o scartarlo'
  where locale_id = p_locale and stato in ('in_coda','errore') and tentativi < 3
    and coalesce(confermato_at, created_at) < now() - interval '10 minutes'
    and (stato = 'in_coda' or tipo in ('comanda','preconto','non_fiscale'));

  return query
  update public.print_jobs j set stato = 'preso', preso_at = now()
  where j.id in (
    select x.id from public.print_jobs x
    where x.locale_id = p_locale and (
      x.stato = 'in_coda'
      or (x.stato = 'errore' and x.tipo in ('comanda','preconto','non_fiscale') and x.tentativi < 3)
      or (x.stato = 'preso' and x.tipo in ('comanda','preconto','non_fiscale') and x.preso_at < now() - interval '60 seconds'))
    order by x.created_at
    for update skip locked
    limit p_max)
  returning j.*;
end $$;

-- Decisione sulla coda sospesa: stampa adesso, oppure scarta (lo scontrino non emesso libera il conto).
create or replace function public.decidi_lavoro(p_job uuid, p_stampa boolean)
returns void
language plpgsql set search_path = '' as $$
declare j public.print_jobs;
begin
  select * into j from public.print_jobs where id = p_job for update;
  if j.id is null or j.stato <> 'sospeso' then return; end if;
  if p_stampa then
    update public.print_jobs set stato = 'in_coda', confermato_at = now(), errore = null where id = p_job;
  else
    update public.print_jobs set stato = 'annullato', errore = 'Scartato dalla cassa (era rimasto in coda)' where id = p_job;
    if j.documento_id is not null then
      update public.documenti set stato = 'errore', errore = 'Non emesso: scartato perché era rimasto in coda a cassa spenta'
      where id = j.documento_id and stato = 'in_emissione';
    end if;
  end if;
end $$;
revoke all on function public.decidi_lavoro(uuid, boolean) from public, anon;
grant execute on function public.decidi_lavoro(uuid, boolean) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ponti_stampa;
exception when duplicate_object then null; end $$;
