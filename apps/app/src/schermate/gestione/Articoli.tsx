// Articoli: piatti e bevande con prezzo, IVA, reparto, allergeni, varianti e ricetta.
import { useMemo, useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import {
  ALLERGENI_ETICHETTA, euro, foodCost, listinoPredefinito, prezzoDi,
  type Allergene, type ArticoloRiga, type DistintaRiga, type Tabelle,
} from '@gr/core';
import { Foglio, Pulsante, useConferma } from '../../ui/primitivi';
import { CampoEuro, CampoNumero, Cerca, Chip, Interruttore, Seleziona, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle, Vuoto } from './Layout';

const ALLERGENI = Object.keys(ALLERGENI_ETICHETTA) as Allergene[];

export function Articoli() {
  const t = useTabelle();
  const [cerca, setCerca] = useState('');
  const [categoria, setCategoria] = useState<string | 'tutte'>('tutte');
  const [archiviati, setArchiviati] = useState(false);
  const [aperto, setAperto] = useState<ArticoloRiga | 'nuovo' | null>(null);

  const categorie = [...t.categorie].sort((a, b) => a.ordine - b.ordine);
  const visibili = useMemo(() => t.articoli
    .filter((a) => a.attivo !== archiviati)
    .filter((a) => categoria === 'tutte' || a.categoria_id === categoria)
    .filter((a) => !cerca || a.nome.toLowerCase().includes(cerca.toLowerCase()))
    .sort((a, b) => (categorie.findIndex((c) => c.id === a.categoria_id) - categorie.findIndex((c) => c.id === b.categoria_id)) || a.ordine - b.ordine || a.nome.localeCompare(b.nome)),
  [t, cerca, categoria, archiviati, categorie]);
  const nArchiviati = t.articoli.filter((a) => !a.attivo).length;

  return (
    <Sezione titolo="Articoli" sotto={`${t.articoli.filter((a) => a.attivo).length} nel menu`}
      azioni={<Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden="true" />} onClick={() => setAperto('nuovo')} disabled={!categorie.length}>Nuovo articolo</Pulsante>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Cerca valore={cerca} onCambia={setCerca} segnaposto="Cerca un piatto" />
        {nArchiviati > 0 && <Chip attivo={archiviati} onClick={() => setArchiviati(!archiviati)}>Archiviati {nArchiviati}</Chip>}
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <Chip attivo={categoria === 'tutte'} onClick={() => setCategoria('tutte')}>Tutte</Chip>
        {categorie.map((c) => (
          <Chip key={c.id} attivo={categoria === c.id} onClick={() => setCategoria(c.id)}>
            <i aria-hidden="true" className="block h-2.5 w-2.5 rounded-pill" style={{ background: c.colore ?? '#a3acba' }} />{c.nome}
          </Chip>
        ))}
      </div>

      {!categorie.length ? (
        <Vuoto titolo="Prima crea una categoria" testo="Ogni articolo sta in una categoria (Primi, Cocktail…), che decide anche se va in cucina o al bar." />
      ) : !visibili.length ? (
        <Vuoto titolo={cerca ? 'Nessun articolo trovato' : 'Nessun articolo qui'} testo={cerca ? `Nessun piatto contiene “${cerca}”.` : 'Aggiungi il primo articolo di questa categoria.'}
          azione={!cerca && !archiviati ? <Pulsante onClick={() => setAperto('nuovo')}>Nuovo articolo</Pulsante> : undefined} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {visibili.map((a) => <RigaArticolo key={a.id} a={a} t={t} onApri={() => setAperto(a)} />)}
        </ul>
      )}

      {aperto && (
        <EditorArticolo key={aperto === 'nuovo' ? 'nuovo' : aperto.id} articolo={aperto === 'nuovo' ? null : aperto}
          categoriaIniziale={categoria === 'tutte' ? categorie[0]?.id : categoria} onChiudi={() => setAperto(null)} />
      )}
    </Sezione>
  );
}

function RigaArticolo({ a, t, onApri }: { a: ArticoloRiga; t: Tabelle; onApri: () => void }) {
  const cat = t.categorie.find((c) => c.id === a.categoria_id);
  const prezzo = prezzoDi(a.id, t);
  const fc = foodCost(a.id, t);
  const pct = fc != null && prezzo > 0 ? Math.round((fc / prezzo) * 100) : null;
  return (
    <li>
      <button type="button" onClick={onApri} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
        <i aria-hidden="true" className="block h-9 w-1.5 flex-none rounded-pill" style={{ background: cat?.colore ?? '#a3acba' }} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{a.nome}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            {cat?.nome}
            {a.allergeni.length > 0 && <span>· {a.allergeni.length} allergeni</span>}
            {pct != null && <span className={pct > 35 ? 'text-warning' : ''}>· food cost {pct}%</span>}
          </span>
        </span>
        {a.esaurito && <span className="rounded-pill border border-warning px-2 py-0.5 text-xs font-bold text-warning">Esaurito</span>}
        <span className="w-24 flex-none text-right text-base font-semibold tabular-nums">{euro(prezzo)}</span>
      </button>
    </li>
  );
}

function EditorArticolo({ articolo, categoriaIniziale, onChiudi }: { articolo: ArticoloRiga | null; categoriaIniziale?: string; onChiudi: () => void }) {
  const t = useTabelle();
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui: conferma } = useConferma();
  const iva10 = t.aliquote_iva.find((x) => Number(x.percentuale) === 10) ?? t.aliquote_iva[0];

  const [nome, setNome] = useState(articolo?.nome ?? '');
  const [nomeBreve, setNomeBreve] = useState(articolo?.nome_breve ?? '');
  const [categoriaId, setCategoriaId] = useState(articolo?.categoria_id ?? categoriaIniziale ?? '');
  const [prezzo, setPrezzo] = useState<number | null>(articolo ? prezzoDi(articolo.id, t) : null);
  const [ivaId, setIvaId] = useState(articolo?.aliquota_iva_id ?? iva10?.id ?? '');
  const [centroId, setCentroId] = useState(articolo?.centro_produzione_id ?? '');
  const [allergeni, setAllergeni] = useState<Allergene[]>(articolo?.allergeni ?? []);
  const [varianti, setVarianti] = useState<string[]>(articolo ? t.articolo_varianti.filter((x) => x.articolo_id === articolo.id).map((x) => x.variante_id) : []);
  const [esaurito, setEsaurito] = useState(articolo?.esaurito ?? false);
  const [ricetta, setRicetta] = useState<Omit<DistintaRiga, 'articolo_id'>[]>(articolo ? t.distinte.filter((d) => d.articolo_id === articolo.id).map(({ articolo_id: _, ...d }) => d) : []);
  const [errore, setErrore] = useState<string | null>(null);

  const categoria = t.categorie.find((c) => c.id === categoriaId);
  const centroCategoria = t.centri_produzione.find((c) => c.id === categoria?.centro_produzione_id);
  const gruppiVarianti = [...new Set(t.varianti.map((v) => v.gruppo ?? 'Altre'))];
  const costo = foodCost('__bozza', { mag_articoli: t.mag_articoli, distinte: ricetta.map((r) => ({ ...r, articolo_id: '__bozza' })) });

  const salva = () => esegui(async () => {
    if (!nome.trim()) { setErrore('Scrivi il nome'); throw new Error('Manca il nome dell’articolo.'); }
    if (prezzo == null) throw new Error('Manca il prezzo.');
    const a = await archivio.salva('articoli', {
      ...(articolo ? { id: articolo.id } : { ordine: t.articoli.length, attivo: true }),
      nome: nome.trim(), nome_breve: nomeBreve.trim() || null, categoria_id: categoriaId, aliquota_iva_id: ivaId,
      centro_produzione_id: centroId || null, allergeni, esaurito,
    });
    const listino = listinoPredefinito(archivio.tabelle());
    if (listino) await archivio.salva('prezzi_listino', { listino_id: listino.id, articolo_id: a.id, prezzo_cents: prezzo });
    // Varianti e ricetta: si allineano a quelle scelte.
    const tab = archivio.tabelle();
    const primaV = tab.articolo_varianti.filter((x) => x.articolo_id === a.id).map((x) => x.variante_id);
    for (const v of primaV.filter((v) => !varianti.includes(v))) await archivio.elimina('articolo_varianti', { articolo_id: a.id, variante_id: v });
    for (const v of varianti.filter((v) => !primaV.includes(v))) await archivio.salva('articolo_varianti', { articolo_id: a.id, variante_id: v });
    const primaR = tab.distinte.filter((d) => d.articolo_id === a.id);
    for (const d of primaR.filter((d) => !ricetta.some((r) => r.mag_articolo_id === d.mag_articolo_id))) await archivio.elimina('distinte', { articolo_id: a.id, mag_articolo_id: d.mag_articolo_id });
    for (const r of ricetta.filter((r) => r.mag_articolo_id && r.quantita > 0)) await archivio.salva('distinte', { articolo_id: a.id, ...r });
    onChiudi();
  }, articolo ? 'Articolo aggiornato' : 'Articolo aggiunto al menu');

  const toggle = <T,>(lista: T[], x: T) => (lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x]);

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={articolo ? articolo.nome : 'Nuovo articolo'} piede={<>
          {articolo && (
            articolo.attivo
              ? <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`“${articolo.nome}” sparisce dal menu di cassa e palmari. Lo storico delle vendite resta e puoi ripristinarlo quando vuoi.`,
                  () => void esegui(async () => { await archivio.salva('articoli', { id: articolo.id, attivo: false }); onChiudi(); }, 'Articolo archiviato'), 'Archivia')}>Archivia</Pulsante>
              : <Pulsante variante="fantasma" taglia="md" onClick={() => void esegui(async () => { await archivio.salva('articoli', { id: articolo.id, attivo: true }); onChiudi(); }, 'Articolo di nuovo nel menu')}>Rimetti nel menu</Pulsante>
          )}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </>}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => { setNome(e.target.value); setErrore(null); }} errore={errore} autoFocus={!articolo} placeholder="Es. Paccheri alla genovese" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoEuro etichetta="Prezzo" valore={prezzo} onCambia={setPrezzo} />
          <Testo etichetta="Nome breve" value={nomeBreve} onChange={(e) => setNomeBreve(e.target.value)} aiuto="Su comanda e scontrino (max 38 lettere)" maxLength={38} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Seleziona etichetta="Categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}
            opzioni={t.categorie.map((c) => ({ valore: c.id, testo: c.nome }))} />
          <Seleziona etichetta="IVA" value={ivaId} onChange={(e) => setIvaId(e.target.value)}
            opzioni={t.aliquote_iva.map((a) => ({ valore: a.id, testo: `${a.descrizione} · reparto ${a.reparto_rt}` }))} />
        </div>
        <Seleziona etichetta="Dove si prepara" value={centroId} onChange={(e) => setCentroId(e.target.value)}
          aiuto="La comanda esce sulla stampante di questo reparto."
          opzioni={[{ valore: '', testo: `Come la categoria${centroCategoria ? ` (${centroCategoria.nome})` : ''}` }, ...t.centri_produzione.map((c) => ({ valore: c.id, testo: c.nome }))]} />

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text-muted">Allergeni</legend>
          <div className="flex flex-wrap gap-2">
            {ALLERGENI.map((x) => <Chip key={x} tono="allergene" attivo={allergeni.includes(x)} onClick={() => setAllergeni(toggle(allergeni, x))}>{ALLERGENI_ETICHETTA[x]}</Chip>)}
          </div>
        </fieldset>

        {t.varianti.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-text-muted">Varianti proposte al cameriere</legend>
            <div className="flex flex-col gap-3">
              {gruppiVarianti.map((g) => (
                <div key={g}>
                  <p className="mb-1.5 text-xs font-semibold text-text-muted">{g}</p>
                  <div className="flex flex-wrap gap-2">
                    {t.varianti.filter((v) => (v.gruppo ?? 'Altre') === g).map((v) => (
                      <Chip key={v.id} attivo={varianti.includes(v.id)} onClick={() => setVarianti(toggle(varianti, v.id))}>
                        {v.nome}{v.delta_cents ? ` ${v.delta_cents > 0 ? '+' : ''}${euro(v.delta_cents, false)}` : ''}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <Ricetta ricetta={ricetta} setRicetta={setRicetta} t={t} costo={costo} prezzo={prezzo} />

        <Interruttore etichetta="Esaurito" descrizione="Resta nel menu ma il cameriere non può ordinarlo." attivo={esaurito} onCambia={setEsaurito} />

      </div>
      {conferma}
    </Foglio>
  );
}

function Ricetta({ ricetta, setRicetta, t, costo, prezzo }: {
  ricetta: Omit<DistintaRiga, 'articolo_id'>[]; setRicetta: (r: Omit<DistintaRiga, 'articolo_id'>[]) => void;
  t: Tabelle; costo: number | null; prezzo: number | null;
}) {
  const liberi = t.mag_articoli.filter((m) => !ricetta.some((r) => r.mag_articolo_id === m.id));
  const pct = costo != null && prezzo ? Math.round((costo / prezzo) * 100) : null;
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-text-muted">Ricetta per una porzione</legend>
      <p className="mb-3 text-xs text-text-muted">Quando il conto si chiude, questi ingredienti escono dal magazzino.</p>
      {!t.mag_articoli.length ? (
        <p className="text-sm text-text-muted">Aggiungi prima i prodotti in Magazzino → Scorte.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {ricetta.map((r, i) => {
            const m = t.mag_articoli.find((x) => x.id === r.mag_articolo_id);
            const agg = (p: Partial<typeof r>) => setRicetta(ricetta.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={r.mag_articolo_id} className="rounded-md bg-bg p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-semibold">{m?.nome}</p>
                  <button type="button" aria-label={`Togli ${m?.nome}`} onClick={() => setRicetta(ricetta.filter((_, j) => j !== i))}
                    className="premibile -my-2 grid h-10 w-10 place-items-center rounded-md text-text-muted hover:bg-surface-2"><Trash size={18} weight="bold" aria-hidden="true" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CampoNumero etichetta="Quantità netta" valore={r.quantita} unita={m?.um_uso} onCambia={(n) => agg({ quantita: n ?? 0 })} />
                  <CampoNumero etichetta="Resa (calo cottura)" valore={r.resa_pct} unita="%" onCambia={(n) => agg({ resa_pct: n && n <= 100 ? n : 100 })} />
                </div>
              </div>
            );
          })}
          {liberi.length > 0 && (
            <select aria-label="Aggiungi un ingrediente" value="" onChange={(e) => e.target.value && setRicetta([...ricetta, { mag_articolo_id: e.target.value, quantita: 0, resa_pct: 100 }])}
              className="h-touch rounded-md border border-dashed border-border-input bg-bg px-3 text-base text-text-muted outline-none focus:border-focus">
              <option value="">+ Aggiungi ingrediente</option>
              {liberi.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.um_uso})</option>)}
            </select>
          )}
          {costo != null && (
            <p className="text-sm">
              Costo porzione <strong className="tabular-nums">{euro(costo)}</strong>
              {pct != null && <> · food cost <strong className={pct > 35 ? 'text-warning' : 'text-success'}>{pct}%</strong></>}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
