// Categorie (colore, reparto, portata) e varianti (cotture, aggiunte, senza).
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from '@phosphor-icons/react';
import { euro, testoSu, type CategoriaRiga, type VarianteRiga } from '@gr/core';
import { Foglio, Pulsante, useConferma } from '../../ui/primitivi';
import { CampoEuro, Seleziona, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle, Vuoto } from './Layout';

// Tavolozza delle categorie: tinte leggibili sul tema scuro, distinte tra loro.
const COLORI = ['#e9c46a', '#f4a261', '#e76f51', '#f2f4f7', '#c9a7eb', '#7cc8ff', '#8fd694', '#d4a5a5', '#a3acba', '#ffb3c7'];
const PORTATE = [
  { valore: '0', testo: 'Subito (bevande)' }, { valore: '1', testo: '1ª uscita (antipasti)' }, { valore: '2', testo: '2ª uscita (primi)' },
  { valore: '3', testo: '3ª uscita (secondi)' }, { valore: '9', testo: 'Ultima (dessert)' },
];
const piu = <Plus size={18} weight="bold" aria-hidden="true" />;

export function Categorie() {
  const t = useTabelle();
  const { archivio, esegui } = useSalva();
  const [aperta, setAperta] = useState<CategoriaRiga | 'nuova' | null>(null);
  const lista = [...t.categorie].sort((a, b) => a.ordine - b.ordine);

  const sposta = (i: number, d: -1 | 1) => esegui(async () => {
    const a = lista[i], b = lista[i + d];
    await archivio.salva('categorie', { id: a.id, ordine: b.ordine === a.ordine ? a.ordine + d : b.ordine });
    await archivio.salva('categorie', { id: b.id, ordine: a.ordine });
  });

  return (
    <Sezione titolo="Categorie" sotto="L’ordine è quello dei pulsanti su cassa e palmari"
      azioni={<Pulsante variante="primario" taglia="md" icona={piu} onClick={() => setAperta('nuova')}>Nuova categoria</Pulsante>}>
      {!lista.length ? <Vuoto titolo="Nessuna categoria" testo="Crea le sezioni del menu: Antipasti, Primi, Cocktail…" /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {lista.map((c, i) => {
            const n = t.articoli.filter((a) => a.categoria_id === c.id && a.attivo).length;
            const centro = t.centri_produzione.find((x) => x.id === c.centro_produzione_id);
            return (
              <li key={c.id} className="flex items-center gap-2 pr-2">
                <button type="button" onClick={() => setAperta(c)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-md text-sm font-bold" style={{ background: c.colore ?? '#a3acba', color: testoSu(c.colore ?? '#a3acba') }} aria-hidden="true">{c.nome.slice(0, 2)}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-semibold">{c.nome}</span>
                    <span className="text-sm text-text-muted">{n} articoli · {centro?.nome ?? 'nessun reparto'}</span>
                  </span>
                </button>
                <button type="button" aria-label={`Sposta ${c.nome} su`} disabled={i === 0} onClick={() => void sposta(i, -1)}
                  className="premibile grid h-10 w-10 place-items-center rounded-md text-text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={18} weight="bold" aria-hidden="true" /></button>
                <button type="button" aria-label={`Sposta ${c.nome} giù`} disabled={i === lista.length - 1} onClick={() => void sposta(i, 1)}
                  className="premibile grid h-10 w-10 place-items-center rounded-md text-text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={18} weight="bold" aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>
      )}
      {aperta && <EditorCategoria key={aperta === 'nuova' ? 'n' : aperta.id} categoria={aperta === 'nuova' ? null : aperta} onChiudi={() => setAperta(null)} />}
    </Sezione>
  );
}

function EditorCategoria({ categoria, onChiudi }: { categoria: CategoriaRiga | null; onChiudi: () => void }) {
  const t = useTabelle();
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [colore, setColore] = useState(categoria?.colore ?? COLORI[0]);
  const [centro, setCentro] = useState(categoria?.centro_produzione_id ?? t.centri_produzione[0]?.id ?? '');
  const [portata, setPortata] = useState(String(categoria?.portata_predefinita ?? 1));
  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Manca il nome della categoria.');
    await archivio.salva('categorie', {
      ...(categoria ? { id: categoria.id } : { ordine: Math.max(0, ...t.categorie.map((c) => c.ordine)) + 1 }),
      nome: nome.trim(), colore, centro_produzione_id: centro || null, portata_predefinita: Number(portata),
    });
    onChiudi();
  }, categoria ? 'Categoria aggiornata' : 'Categoria creata');

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={categoria ? categoria.nome : 'Nuova categoria'}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!categoria} placeholder="Es. Crudi" />
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text-muted">Colore del pulsante</legend>
          <div className="flex flex-wrap gap-2">
            {COLORI.map((c) => (
              <button key={c} type="button" aria-label={`Colore ${c}`} aria-pressed={c === colore} onClick={() => setColore(c)}
                className={`premibile h-11 w-11 rounded-md ring-offset-2 ring-offset-surface ${c === colore ? 'ring-2 ring-focus' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Seleziona etichetta="Reparto" value={centro} onChange={(e) => setCentro(e.target.value)} aiuto="Dove esce la comanda"
            opzioni={[...t.centri_produzione.map((c) => ({ valore: c.id, testo: c.nome })), { valore: '', testo: 'Nessuno (non stampa)' }]} />
          <Seleziona etichetta="Uscita predefinita" value={portata} onChange={(e) => setPortata(e.target.value)} opzioni={PORTATE} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {categoria && <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare la categoria “${categoria.nome}”?`, () => void esegui(async () => { await archivio.elimina('categorie', { id: categoria.id }); onChiudi(); }, 'Categoria eliminata'), 'Elimina')}>Elimina</Pulsante>}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}

export function Varianti() {
  const t = useTabelle();
  const [aperta, setAperta] = useState<VarianteRiga | 'nuova' | null>(null);
  const gruppi = [...new Set(t.varianti.map((v) => v.gruppo ?? 'Altre'))].sort();
  return (
    <Sezione titolo="Varianti" sotto="Cotture, aggiunte e “senza” che il cameriere aggiunge al piatto"
      azioni={<Pulsante variante="primario" taglia="md" icona={piu} onClick={() => setAperta('nuova')}>Nuova variante</Pulsante>}>
      {!t.varianti.length ? <Vuoto titolo="Nessuna variante" testo="Per esempio: “ben cotta”, “+ burrata 3 €”, “senza cipolla”." /> : (
        <div className="flex flex-col gap-5">
          {gruppi.map((g) => (
            <section key={g}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">{g}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {t.varianti.filter((v) => (v.gruppo ?? 'Altre') === g).map((v) => {
                  const n = t.articolo_varianti.filter((x) => x.variante_id === v.id).length;
                  return (
                    <li key={v.id}>
                      <button type="button" onClick={() => setAperta(v)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
                        <span className="flex-1 text-base font-semibold">{v.nome}</span>
                        <span className="text-sm text-text-muted">{n} articoli</span>
                        <span className="w-20 text-right font-semibold tabular-nums">{v.delta_cents ? `${v.delta_cents > 0 ? '+' : ''}${euro(v.delta_cents, false)}` : '—'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {aperta && <EditorVariante key={aperta === 'nuova' ? 'n' : aperta.id} variante={aperta === 'nuova' ? null : aperta} gruppi={gruppi} onChiudi={() => setAperta(null)} />}
    </Sezione>
  );
}

function EditorVariante({ variante, gruppi, onChiudi }: { variante: VarianteRiga | null; gruppi: string[]; onChiudi: () => void }) {
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const [nome, setNome] = useState(variante?.nome ?? '');
  const [gruppo, setGruppo] = useState(variante?.gruppo ?? gruppi[0] ?? 'Aggiunte');
  const [delta, setDelta] = useState<number | null>(variante?.delta_cents ?? 0);
  const [sconto, setSconto] = useState((variante?.delta_cents ?? 0) < 0);
  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Manca il nome della variante.');
    await archivio.salva('varianti', { ...(variante ? { id: variante.id } : {}), nome: nome.trim(), gruppo: gruppo.trim() || null, delta_cents: Math.abs(delta ?? 0) * (sconto ? -1 : 1) });
    onChiudi();
  }, variante ? 'Variante aggiornata' : 'Variante creata');
  return (
    <Foglio aperto onChiudi={onChiudi} titolo={variante ? variante.nome : 'Nuova variante'}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!variante} placeholder="Es. + burrata" />
        <Testo etichetta="Gruppo" value={gruppo} onChange={(e) => setGruppo(e.target.value)} list="gruppi-varianti" aiuto="Cottura, Aggiunte, Senza…" />
        <datalist id="gruppi-varianti">{gruppi.map((g) => <option key={g} value={g} />)}</datalist>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <CampoEuro etichetta="Differenza di prezzo" valore={delta == null ? null : Math.abs(delta)} onCambia={setDelta} aiuto="0 se non cambia il prezzo" />
          <div className="flex h-touch gap-1 rounded-md bg-bg p-1" role="radiogroup" aria-label="Aggiunge o toglie">
            {[false, true].map((s) => (
              <button key={String(s)} type="button" role="radio" aria-checked={sconto === s} onClick={() => setSconto(s)}
                className={`premibile w-11 rounded-md text-lg font-bold ${sconto === s ? 'bg-surface-2 text-text' : 'text-text-muted'}`}>{s ? '−' : '+'}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {variante && <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare “${variante.nome}”? Sparisce da tutti gli articoli.`, () => void esegui(async () => { await archivio.elimina('varianti', { id: variante.id }); onChiudi(); }, 'Variante eliminata'), 'Elimina')}>Elimina</Pulsante>}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}
