-- Tavoli uniti: un gruppo grande occupa più tavoli con un solo conto.
-- Il conto sta sul tavolo principale (tavolo_id); gli altri sono in tavoli_uniti e risultano occupati.
alter table public.comande add column if not exists tavoli_uniti uuid[] not null default '{}';
create index if not exists comande_tavoli_uniti on public.comande using gin (tavoli_uniti) where stato in ('aperta','preconto');

-- Un tavolo unito a un conto aperto non si può aprire (né diventare tavolo di un altro conto).
create or replace function privato.controlla_tavolo_unito() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tavolo_id is not null and new.stato in ('aperta','preconto') and exists (
    select 1 from public.comande c where c.id <> new.id and c.stato in ('aperta','preconto') and new.tavolo_id = any(c.tavoli_uniti)) then
    raise exception 'TAVOLO_OCCUPATO';
  end if;
  return new;
end $$;
drop trigger if exists comande_tavolo_unito on public.comande;
create trigger comande_tavolo_unito before insert or update of tavolo_id, stato on public.comande
  for each row execute function privato.controlla_tavolo_unito();

create or replace function public.unisci_tavoli(p_comanda uuid, p_tavoli uuid[])
returns void
language plpgsql set search_path = '' as $$
declare c public.comande; t uuid; v_nuovi uuid[] := '{}';
begin
  select * into c from public.comande where id = p_comanda for update;
  if c.id is null then raise exception 'COMANDA_INESISTENTE'; end if;
  if c.stato not in ('aperta','preconto') then raise exception 'COMANDA_CHIUSA'; end if;
  if c.tavolo_id is null then raise exception 'SOLO_AL_TAVOLO'; end if;
  foreach t in array coalesce(p_tavoli, '{}') loop
    if t = c.tavolo_id or t = any(c.tavoli_uniti) or t = any(v_nuovi) then continue; end if;
    if not exists (select 1 from public.tavoli where id = t and locale_id = c.locale_id) then raise exception 'TAVOLO_INESISTENTE'; end if;
    if exists (select 1 from public.comande x where x.stato in ('aperta','preconto')
               and (x.tavolo_id = t or t = any(x.tavoli_uniti))) then
      raise exception 'TAVOLO_OCCUPATO';
    end if;
    v_nuovi := v_nuovi || t;
  end loop;
  update public.comande set tavoli_uniti = tavoli_uniti || v_nuovi, version = version + 1 where id = p_comanda;
end $$;

create or replace function public.separa_tavolo(p_comanda uuid, p_tavolo uuid)
returns void
language plpgsql set search_path = '' as $$
begin
  update public.comande set tavoli_uniti = array_remove(tavoli_uniti, p_tavolo), version = version + 1
  where id = p_comanda and p_tavolo = any(tavoli_uniti);
end $$;

revoke all on function public.unisci_tavoli(uuid, uuid[]) from public, anon;
revoke all on function public.separa_tavolo(uuid, uuid) from public, anon;
grant execute on function public.unisci_tavoli(uuid, uuid[]) to authenticated;
grant execute on function public.separa_tavolo(uuid, uuid) to authenticated;
