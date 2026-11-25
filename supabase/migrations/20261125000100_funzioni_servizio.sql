-- =====================================================================
-- Funzioni del server per il servizio (fase 1).
-- Regole:
--  * security invoker: valgono le regole RLS del chiamante (vede solo i suoi locali);
--    le uniche eccezioni (security definer) controllano a mano l'appartenenza al locale.
--  * ogni operazione che stampa o emette è idempotente (chiave generata dal dispositivo).
--  * un lavoro fiscale non torna mai in coda da solo.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Il PIN non si legge mai dal client: niente select sulla colonna pin_hash.
revoke select on public.operatori from authenticated, anon;
grant select (id, locale_id, nome, ruolo, permessi, attivo, created_at, updated_at) on public.operatori to authenticated;
revoke insert, update on public.operatori from authenticated, anon;
grant insert (locale_id, nome, ruolo, permessi, attivo, pin_hash) on public.operatori to authenticated;
grant update (nome, ruolo, permessi, attivo) on public.operatori to authenticated;

-- ---------------------------------------------------------------------
-- Giorno di servizio: il servizio delle 01:30 appartiene alla sera prima.
-- ---------------------------------------------------------------------
create or replace function public.giorno_servizio(p_locale uuid) returns date
language sql stable set search_path = '' as $$
  select ((now() at time zone l.fuso_orario) - l.ora_cambio_giornata)::date
  from public.locali l where l.id = p_locale;
$$;

-- Totale del conto come lo calcola l'app (righe valide + varianti + coperto).
create or replace function public.totale_comanda(p_comanda uuid) returns integer
language sql stable set search_path = '' as $$
  select coalesce((
    select sum(round((r.prezzo_unitario_cents + coalesce((
             select sum((v->>'deltaCents')::int) from jsonb_array_elements(r.varianti) v), 0)) * r.quantita))
    from public.righe_comanda r
    where r.comanda_id = c.id and r.stato <> 'stornata' and not r.omaggio), 0)::int
    + c.coperti * l.coperto_cents
  from public.comande c join public.locali l on l.id = c.locale_id
  where c.id = p_comanda;
$$;

-- ---------------------------------------------------------------------
-- Accesso operatore con PIN (security definer: legge l'hash, ma solo per i locali del chiamante)
-- ---------------------------------------------------------------------
create or replace function public.operatore_accedi(p_locale uuid, p_pin text)
returns table (id uuid, nome text, ruolo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privato.mio_locale(p_locale) then
    raise exception 'NON_AUTORIZZATO' using errcode = '42501';
  end if;
  return query
    select o.id, o.nome, o.ruolo from public.operatori o
    where o.locale_id = p_locale and o.attivo
      and o.pin_hash = extensions.crypt(p_pin, o.pin_hash)
    limit 1;
end $$;

create or replace function public.operatore_imposta_pin(p_operatore uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN_NON_VALIDO'; end if;
  select locale_id into v_locale from public.operatori where id = p_operatore;
  if v_locale is null or not privato.mio_locale(v_locale) then
    raise exception 'NON_AUTORIZZATO' using errcode = '42501';
  end if;
  update public.operatori set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_operatore;
end $$;

-- ---------------------------------------------------------------------
-- Apertura tavolo: numero progressivo del giorno, un tavolo una comanda.
-- ---------------------------------------------------------------------
create or replace function public.apri_tavolo(p_tavolo uuid, p_coperti int, p_operatore uuid)
returns public.comande
language plpgsql set search_path = '' as $$
declare
  v_locale uuid; v_giorno date; v_numero int; v_nome text; c public.comande;
begin
  select t.locale_id into v_locale from public.tavoli t where t.id = p_tavolo;
  if v_locale is null then raise exception 'TAVOLO_INESISTENTE'; end if;
  v_giorno := public.giorno_servizio(v_locale);
  perform pg_advisory_xact_lock(hashtext(v_locale::text || v_giorno::text));
  select coalesce(max(numero), 0) + 1 into v_numero from public.comande where locale_id = v_locale and giorno_servizio = v_giorno;
  begin
    insert into public.comande (locale_id, numero, giorno_servizio, canale, tavolo_id, coperti, operatore_id)
    values (v_locale, v_numero, v_giorno, 'tavolo', p_tavolo, p_coperti, p_operatore)
    returning * into c;
  exception when unique_violation then
    raise exception 'TAVOLO_GIA_APERTO';
  end;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Invio in produzione. L'app calcola i ticket (pacchetto core) e li passa in p_lavori:
-- [{"stampante_id": "...", "centro": "cucina", "payload": {...}}]
-- Se nel frattempo un altro palmare ha già inviato o tolto una riga, si ferma.
-- ---------------------------------------------------------------------
create or replace function public.invia_produzione(
  p_comanda uuid, p_righe uuid[], p_tipo text, p_portata int, p_operatore uuid, p_key text, p_lavori jsonb)
returns setof public.print_jobs
language plpgsql set search_path = '' as $$
declare
  v_locale uuid; v_invio uuid; v_aggiornate int; v_lavoro jsonb; v_i int := 0;
begin
  select locale_id into v_locale from public.comande where id = p_comanda and stato in ('aperta','preconto');
  if v_locale is null then raise exception 'COMANDA_CHIUSA'; end if;

  -- già inviato con questa chiave (doppio tap, rete lenta): restituisce gli stessi lavori
  select id into v_invio from public.invii_produzione where locale_id = v_locale and idempotency_key = p_key;
  if v_invio is not null then
    return query select * from public.print_jobs where invio_id = v_invio order by created_at;
    return;
  end if;

  insert into public.invii_produzione (locale_id, comanda_id, tipo, portata, operatore_id, idempotency_key)
  values (v_locale, p_comanda, p_tipo, p_portata, p_operatore, p_key) returning id into v_invio;

  update public.righe_comanda set stato = 'inviata', inviata_at = now(), invio_id = v_invio
  where id = any(p_righe) and comanda_id = p_comanda and stato in ('da_inviare','in_attesa_marcia');
  get diagnostics v_aggiornate = row_count;
  if v_aggiornate <> coalesce(array_length(p_righe, 1), 0) then
    raise exception 'COMANDA_CAMBIATA';
  end if;

  for v_lavoro in select * from jsonb_array_elements(coalesce(p_lavori, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.print_jobs (locale_id, stampante_id, tipo, payload, invio_id, idempotency_key)
    values (v_locale, (v_lavoro->>'stampante_id')::uuid, 'comanda', v_lavoro->'payload', v_invio, p_key || ':' || v_i);
  end loop;

  update public.comande set version = version + 1 where id = p_comanda;
  return query select * from public.print_jobs where invio_id = v_invio order by created_at;
end $$;

-- Lavoro di stampa singolo (preconto, storno): idempotente sulla chiave.
create or replace function public.accoda_lavoro(
  p_locale uuid, p_stampante uuid, p_tipo text, p_payload jsonb, p_key text)
returns public.print_jobs
language plpgsql set search_path = '' as $$
declare j public.print_jobs;
begin
  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, idempotency_key)
  values (p_locale, p_stampante, p_tipo, p_payload, p_key)
  on conflict (locale_id, idempotency_key) do nothing
  returning * into j;
  if j.id is null then
    select * into j from public.print_jobs where locale_id = p_locale and idempotency_key = p_key;
  end if;
  return j;
end $$;

create or replace function public.storna_riga(
  p_riga uuid, p_motivo text, p_operatore uuid, p_key text, p_stampante uuid, p_payload jsonb)
returns void
language plpgsql set search_path = '' as $$
declare r public.righe_comanda;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_MANCANTE'; end if;
  select * into r from public.righe_comanda where id = p_riga for update;
  if r.id is null then raise exception 'RIGA_INESISTENTE'; end if;
  if r.stato = 'stornata' then return; end if;
  update public.righe_comanda set stato = 'stornata', motivo_storno = p_motivo, stornata_da = p_operatore where id = p_riga;
  insert into public.audit_log (locale_id, operatore_id, azione, entita, entita_id, prima, dopo)
  values (r.locale_id, p_operatore, 'storno', 'righe_comanda', r.id, to_jsonb(r), jsonb_build_object('motivo', p_motivo));
  if p_stampante is not null and r.stato not in ('da_inviare','in_attesa_marcia') then
    perform public.accoda_lavoro(r.locale_id, p_stampante, 'comanda', p_payload, p_key);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Incasso: documento + righe + pagamenti + lavoro fiscale, tutto o niente.
-- ---------------------------------------------------------------------
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
    insert into public.pagamenti (locale_id, documento_id, tipo, tipo_rt, importo_cents)
    values (v_locale, d.id, p->>'tipo', p->>'tipoRt', (p->>'importoCents')::int);
  end loop;

  insert into public.print_jobs (locale_id, stampante_id, tipo, payload, documento_id, idempotency_key)
  values (v_locale, p_stampante, 'documento_commerciale', jsonb_build_object('xml', p_xml), d.id, p_key);
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Coda di stampa (solo l'app di cassa la elabora).
-- ---------------------------------------------------------------------
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

create or replace function public.esito_lavoro(
  p_job uuid, p_ok boolean, p_incerto boolean, p_errore text,
  p_z_numero int default null, p_doc_numero int default null, p_matricola text default null)
returns void
language plpgsql set search_path = '' as $$
declare j public.print_jobs; d public.documenti; v_pagato int; v_quote int;
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
      update public.comande set stato = 'chiusa', chiusa_at = now() where id = d.comanda_id;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Primo avvio: crea il locale del titolare con la configurazione di partenza del Moorea.
-- IP delle stampanti e prezzi sono segnaposto: si cambiano dalle impostazioni.
-- ---------------------------------------------------------------------
create or replace function public.inizializza_locale() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := (select auth.uid());
  v_gruppo uuid; v_locale uuid; v_listino uuid; v_int uuid; v_perg uuid;
  v_st_cucina uuid; v_st_bar uuid; v_cp_cucina uuid; v_cp_bar uuid; v_iva10 uuid; v_iva22 uuid;
  v_cat uuid; v_art uuid;
  c record; a record;
begin
  if v_utente is null then raise exception 'NON_AUTENTICATO' using errcode = '42501'; end if;
  select locale_id into v_locale from public.membri where user_id = v_utente limit 1;
  if v_locale is not null then return v_locale; end if;

  insert into public.gruppi (nome) values ('Moorea') returning id into v_gruppo;
  insert into public.locali (gruppo_id, nome, ragione_sociale, piva, indirizzo, coperto_cents)
  values (v_gruppo, 'Moorea Food Club', 'Da completare', 'Da completare', 'Lungomare, Maiori', 200) returning id into v_locale;
  insert into public.membri (user_id, locale_id, ruolo) values (v_utente, v_locale, 'titolare');

  insert into public.stampanti (locale_id, nome, tipo, host, porta) values (v_locale, 'Cucina', 'comande_escpos', '192.168.1.101', 9100) returning id into v_st_cucina;
  insert into public.stampanti (locale_id, nome, tipo, host, porta) values (v_locale, 'Bar', 'comande_escpos', '192.168.1.102', 9100) returning id into v_st_bar;
  insert into public.stampanti (locale_id, nome, tipo, host, porta, per_preconto) values (v_locale, 'Preconto', 'comande_escpos', '192.168.1.103', 9100, true);
  insert into public.stampanti (locale_id, nome, tipo, host, porta, matricola_rt) values (v_locale, 'Cassa RT', 'rt_epson_xml', '192.168.1.110', 80, 'DA_INSERIRE');
  insert into public.centri_produzione (locale_id, nome, stampante_id) values (v_locale, 'Cucina', v_st_cucina) returning id into v_cp_cucina;
  insert into public.centri_produzione (locale_id, nome, stampante_id) values (v_locale, 'Bar', v_st_bar) returning id into v_cp_bar;
  insert into public.aliquote_iva (locale_id, descrizione, percentuale, reparto_rt) values (v_locale, '10% somministrazione', 10, 1) returning id into v_iva10;
  insert into public.aliquote_iva (locale_id, descrizione, percentuale, reparto_rt) values (v_locale, '22%', 22, 2) returning id into v_iva22;
  insert into public.listini (locale_id, nome, canale, predefinito) values (v_locale, 'Sala', 'tavolo', true) returning id into v_listino;

  insert into public.sale (locale_id, nome, ordine, listino_id) values (v_locale, 'Interno', 1, v_listino) returning id into v_int;
  insert into public.sale (locale_id, nome, ordine, listino_id) values (v_locale, 'Pergotenda', 2, v_listino) returning id into v_perg;
  insert into public.tavoli (locale_id, sala_id, numero, forma, x, y, larghezza, altezza, posti) values
    (v_locale, v_int, '1', 'quadrato', 0, 0, 1, 1, 2), (v_locale, v_int, '2', 'quadrato', 1, 0, 1, 1, 4),
    (v_locale, v_int, '3', 'quadrato', 2, 0, 1, 1, 4), (v_locale, v_int, '4', 'quadrato', 3, 0, 1, 1, 4),
    (v_locale, v_int, '5', 'quadrato', 4, 0, 1, 1, 4), (v_locale, v_int, '6', 'tondo', 0, 1, 1, 1, 2),
    (v_locale, v_int, '7', 'tondo', 1, 1, 1, 1, 4), (v_locale, v_int, '8', 'tondo', 2, 1, 1, 1, 2),
    (v_locale, v_int, '9', 'tondo', 3, 1, 1, 1, 2), (v_locale, v_int, '10', 'rettangolo', 0, 2, 3, 1, 14),
    (v_locale, v_int, '11', 'quadrato', 3, 2, 1, 1, 4), (v_locale, v_int, '12', 'quadrato', 4, 2, 1, 1, 6),
    (v_locale, v_perg, '21', 'quadrato', 0, 0, 1, 1, 4), (v_locale, v_perg, '22', 'quadrato', 1, 0, 1, 1, 4),
    (v_locale, v_perg, '23', 'quadrato', 2, 0, 1, 1, 4), (v_locale, v_perg, '24', 'tondo', 0, 1, 1, 1, 2);

  for c in select * from (values
      ('Tapas', '#e9c46a', 1, 'cucina', 1), ('Antipasti', '#f4a261', 2, 'cucina', 1), ('Primi', '#f2f4f7', 3, 'cucina', 2),
      ('Secondi', '#e76f51', 4, 'cucina', 3), ('Dessert', '#c9a7eb', 5, 'cucina', 9), ('Cocktail', '#7cc8ff', 6, 'bar', 0),
      ('Vini', '#d4a5a5', 7, 'bar', 0), ('Acqua e bibite', '#a3acba', 8, 'bar', 0)) as t(nome, colore, ordine, centro, portata)
  loop
    insert into public.categorie (locale_id, nome, colore, ordine, centro_produzione_id, portata_predefinita)
    values (v_locale, c.nome, c.colore, c.ordine, case c.centro when 'bar' then v_cp_bar else v_cp_cucina end, c.portata)
    returning id into v_cat;
    for a in select * from (values
        ('Tapas', 'Polpette al sugo', 900, '{glutine,uova,latte}'), ('Tapas', 'Bruschetta salsiccia e provola', 800, '{glutine,latte}'),
        ('Tapas', 'Mozzarella in carrozza', 900, '{glutine,latte,uova}'), ('Tapas', 'Scamorza in foglia di limone', 1000, '{latte}'),
        ('Tapas', 'Fresella, alici di Cetara', 1200, '{glutine,pesce}'),
        ('Antipasti', 'Vitello tonnato', 1400, '{uova,pesce}'), ('Antipasti', 'Carpaccio di manzo', 1500, '{latte}'),
        ('Antipasti', 'Crocchetta di baccalà', 1200, '{glutine,pesce,latte}'), ('Antipasti', 'Carciofo alla romana', 1100, '{}'),
        ('Primi', 'Spaghettone cacio e pepe', 1600, '{glutine,latte}'), ('Primi', 'Paccheri alla genovese', 1700, '{glutine,latte,sedano}'),
        ('Primi', 'Linguine ai frutti di mare', 2200, '{glutine,molluschi,crostacei}'), ('Primi', 'Risotto al limone', 1800, '{latte}'),
        ('Secondi', 'Polpo, crema di zucca', 2200, '{molluschi}'), ('Secondi', 'Tagliata di manzo', 2400, '{}'),
        ('Dessert', 'Tiramisù', 800, '{glutine,uova,latte}'), ('Dessert', 'Profiterole al cioccolato caldo', 900, '{glutine,uova,latte}'),
        ('Cocktail', 'Espresso Martini caramellato', 1200, '{}'), ('Cocktail', 'Moorea Punch', 1100, '{}'), ('Cocktail', 'Moorea Lemon', 1100, '{}'),
        ('Vini', 'Ripasso Valpolicella', 3700, '{solfiti}'), ('Vini', 'Primitivo Desire', 3200, '{solfiti}'),
        ('Acqua e bibite', 'Acqua naturale 0,75', 300, '{}'), ('Acqua e bibite', 'Acqua frizzante 0,75', 300, '{}')
      ) as t(cat, nome, prezzo, allergeni) where t.cat = c.nome
    loop
      insert into public.articoli (locale_id, categoria_id, nome, aliquota_iva_id, allergeni)
      values (v_locale, v_cat, a.nome, v_iva10, a.allergeni::text[]) returning id into v_art;
      insert into public.prezzi_listino (listino_id, articolo_id, prezzo_cents) values (v_listino, v_art, a.prezzo);
    end loop;
  end loop;

  insert into public.varianti (locale_id, gruppo, nome, delta_cents) values
    (v_locale, 'Note', 'poco pepe', 0), (v_locale, 'Senza', 'pasta senza glutine', 200), (v_locale, 'Senza', '- pecorino', 0),
    (v_locale, 'Aggiunte', '+ burrata', 300), (v_locale, 'Cottura', 'al sangue', 0), (v_locale, 'Cottura', 'media', 0),
    (v_locale, 'Cottura', 'ben cotta', 0);
  insert into public.articolo_varianti (articolo_id, variante_id)
    select ar.id, vr.id from public.articoli ar join public.varianti vr on vr.locale_id = ar.locale_id
    where ar.locale_id = v_locale and (
      (ar.nome = 'Spaghettone cacio e pepe' and vr.nome in ('poco pepe','pasta senza glutine')) or
      (ar.nome = 'Paccheri alla genovese' and vr.nome in ('- pecorino','+ burrata','pasta senza glutine')) or
      (ar.nome = 'Tagliata di manzo' and vr.gruppo = 'Cottura'));

  -- Operatori iniziali: PIN da cambiare dalle impostazioni.
  insert into public.operatori (locale_id, nome, ruolo, pin_hash) values
    (v_locale, 'Benny', 'responsabile', extensions.crypt('9999', extensions.gen_salt('bf'))),
    (v_locale, 'Aldo', 'cameriere', extensions.crypt('1111', extensions.gen_salt('bf'))),
    (v_locale, 'Luca', 'cameriere', extensions.crypt('2222', extensions.gen_salt('bf')));
  return v_locale;
end $$;

-- Esecuzione solo per utenti autenticati.
do $$
declare f text;
begin
  foreach f in array array[
    'giorno_servizio(uuid)', 'totale_comanda(uuid)', 'operatore_accedi(uuid,text)', 'operatore_imposta_pin(uuid,text)',
    'apri_tavolo(uuid,integer,uuid)', 'invia_produzione(uuid,uuid[],text,integer,uuid,text,jsonb)',
    'accoda_lavoro(uuid,uuid,text,jsonb,text)', 'storna_riga(uuid,text,uuid,text,uuid,jsonb)',
    'incassa(uuid,uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,text)',
    'prendi_lavori(uuid,integer)', 'esito_lavoro(uuid,boolean,boolean,text,integer,integer,text)', 'inizializza_locale()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
