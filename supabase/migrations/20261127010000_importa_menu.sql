-- Importazione del listino dal menu pubblicato (mooreafoodclub.it/menu, vedi scripts/importa-menu.py).
-- Si può rilanciare quando cambia il menu: aggiorna prezzi e descrizioni, riattiva i piatti tornati,
-- archivia (non cancella) quelli tolti, così lo storico delle vendite resta.
--
-- p_menu = {
--   "coperto": 200,
--   "categorie": [["Antipasti", "#f4a261", "cucina", 1], ...],          -- nome, colore, reparto, uscita
--   "articoli": [[0, "Cozze Indiavolate", 1400, ["molluschi"], "Cozze, pomodorini…"], ...],  -- indice categoria, nome, prezzo, allergeni, descrizione
--   "varianti": [["Cottura", "al sangue", 0, ["Entrecôte alla Griglia", ...]], ...]
-- }
create or replace function public.importa_menu(p_locale uuid, p_menu jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_listino uuid; v_iva uuid; v_cucina uuid; v_bar uuid;
  v_cat uuid[] := '{}'; c jsonb; a jsonb; v jsonb; i int := 0; v_id uuid; v_var uuid; nome_art text;
  v_nuovi int := 0; v_aggiornati int := 0; v_archiviati int := 0; v_nomi text[] := '{}';
begin
  if not privato.mio_locale(p_locale) then raise exception 'NON_AUTORIZZATO' using errcode = '42501'; end if;
  select id into v_listino from public.listini where locale_id = p_locale order by predefinito desc limit 1;
  select id into v_iva from public.aliquote_iva where locale_id = p_locale and percentuale = 10 limit 1;
  select id into v_cucina from public.centri_produzione where locale_id = p_locale and nome ilike 'cucina' limit 1;
  select id into v_bar from public.centri_produzione where locale_id = p_locale and nome ilike 'bar' limit 1;
  if v_listino is null or v_iva is null then raise exception 'LISTINO_O_IVA_MANCANTI'; end if;

  if (p_menu->>'coperto') is not null then
    update public.locali set coperto_cents = (p_menu->>'coperto')::int, updated_at = now() where id = p_locale;
  end if;

  -- Categorie: per nome.
  for c in select * from jsonb_array_elements(p_menu->'categorie') loop
    i := i + 1;
    v_id := null;
    select id into v_id from public.categorie where locale_id = p_locale and nome = c->>0 limit 1;
    if v_id is null then
      insert into public.categorie (locale_id, nome, colore, ordine, centro_produzione_id, portata_predefinita)
      values (p_locale, c->>0, c->>1, i, case c->>2 when 'bar' then v_bar else v_cucina end, (c->>3)::int)
      returning id into v_id;
    else
      update public.categorie set colore = c->>1, ordine = i, centro_produzione_id = case c->>2 when 'bar' then v_bar else v_cucina end,
        portata_predefinita = (c->>3)::int, updated_at = now() where id = v_id;
    end if;
    v_cat := v_cat || v_id;
  end loop;
  -- Le altre categorie vanno in fondo (restano per lo storico; la cassa nasconde quelle vuote).
  update public.categorie set ordine = 1000 + ordine where locale_id = p_locale and not (id = any(v_cat)) and ordine < 1000;

  -- Articoli: per nome (anche archiviati: tornano attivi).
  i := 0;
  for a in select * from jsonb_array_elements(p_menu->'articoli') loop
    nome_art := a->>1;
    v_nomi := v_nomi || nome_art;
    v_id := null;
    select id into v_id from public.articoli where locale_id = p_locale and nome = nome_art order by attivo desc limit 1;
    if v_id is null then
      insert into public.articoli (locale_id, categoria_id, nome, nome_breve, descrizione, aliquota_iva_id, allergeni, ordine)
      values (p_locale, v_cat[(a->>0)::int + 1], nome_art, left(nome_art, 38),
        case when a->>4 is null then '{}'::jsonb else jsonb_build_object('it', a->>4) end, v_iva,
        array(select jsonb_array_elements_text(a->3)), i)
      returning id into v_id;
      v_nuovi := v_nuovi + 1;
    else
      update public.articoli set categoria_id = v_cat[(a->>0)::int + 1], attivo = true, ordine = i,
        descrizione = case when a->>4 is null then descrizione else jsonb_build_object('it', a->>4) end,
        allergeni = array(select jsonb_array_elements_text(a->3)), updated_at = now()
      where id = v_id;
      v_aggiornati := v_aggiornati + 1;
    end if;
    insert into public.prezzi_listino (listino_id, articolo_id, prezzo_cents) values (v_listino, v_id, (a->>2)::int)
    on conflict (listino_id, articolo_id) do update set prezzo_cents = excluded.prezzo_cents;
    i := i + 1;
  end loop;

  update public.articoli set attivo = false, updated_at = now()
  where locale_id = p_locale and attivo and not (nome = any(v_nomi));
  get diagnostics v_archiviati = row_count;

  -- Varianti: si ricreano quelle del menu (le comande passate ne conservano una copia).
  if p_menu ? 'varianti' then
    delete from public.varianti where locale_id = p_locale;
    for v in select * from jsonb_array_elements(p_menu->'varianti') loop
      insert into public.varianti (locale_id, gruppo, nome, delta_cents) values (p_locale, v->>0, v->>1, (v->>2)::int) returning id into v_var;
      insert into public.articolo_varianti (articolo_id, variante_id)
        select ar.id, v_var from public.articoli ar
        where ar.locale_id = p_locale and ar.attivo and ar.nome in (select jsonb_array_elements_text(v->3));
    end loop;
  end if;

  return jsonb_build_object('nuovi', v_nuovi, 'aggiornati', v_aggiornati, 'archiviati', v_archiviati);
end $$;
revoke all on function public.importa_menu(uuid, jsonb) from public, anon;
grant execute on function public.importa_menu(uuid, jsonb) to authenticated;
