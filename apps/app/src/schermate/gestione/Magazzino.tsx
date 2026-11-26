// Magazzino: scorte con soglia minima, carichi/scarichi/inventario, storico movimenti e fornitori.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardText, Plus, Trash } from '@phosphor-icons/react';
import {
  euro, statoScorta, type FornitoreRiga, type MagArticoloRiga, type MovimentoRiga, type NuovoMovimento, type Tabelle,
} from '@gr/core';
import { useApp } from '../../dati/contesto';
import { Foglio, Pulsante, useConferma } from '../../ui/primitivi';
import { CampoEuro, CampoNumero, Cerca, Chip, Segmenti, Seleziona, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle, Vuoto } from './Layout';

type TipoMov = NuovoMovimento['tipo'];
const I = { size: 18, weight: 'bold' as const, 'aria-hidden': true };
const NOME_MOV: Record<MovimentoRiga['tipo'], string> = {
  carico: 'Carico', scarico: 'Scarico', scarto: 'Scarto', inventario: 'Inventario', vendita: 'Vendite',
  trasferimento_in: 'Trasferimento in entrata', trasferimento_out: 'Trasferimento in uscita',
};
const fmtQ = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 3 });
const giacenza = (t: Tabelle, id: string) => t.scorte.find((s) => s.mag_articolo_id === id);

export function Scorte() {
  const t = useTabelle();
  const [cerca, setCerca] = useState('');
  const [sotto, setSotto] = useState(false);
  const [prodotto, setProdotto] = useState<MagArticoloRiga | 'nuovo' | null>(null);
  const [movimento, setMovimento] = useState<TipoMov | null>(null);

  const lista = useMemo(() => t.mag_articoli
    .filter((m) => !cerca || m.nome.toLowerCase().includes(cerca.toLowerCase()))
    .filter((m) => !sotto || statoScorta(giacenza(t, m.id)) !== 'ok')
    .sort((a, b) => a.nome.localeCompare(b.nome)), [t, cerca, sotto]);
  const nSotto = t.mag_articoli.filter((m) => statoScorta(giacenza(t, m.id)) !== 'ok').length;
  const valore = t.mag_articoli.reduce((s, m) => s + Math.max(0, giacenza(t, m.id)?.giacenza ?? 0) * (m.costo_ultimo_cents ?? 0), 0);

  return (
    <Sezione titolo="Scorte" sotto={t.mag_articoli.length ? `${t.mag_articoli.length} prodotti · valore in magazzino ${euro(Math.round(valore))}` : undefined}
      azioni={<>
        <Pulsante taglia="md" icona={<Plus {...I} />} onClick={() => setProdotto('nuovo')}>Nuovo prodotto</Pulsante>
        {t.mag_articoli.length > 0 && <>
          <Pulsante taglia="md" icona={<ClipboardText {...I} />} onClick={() => setMovimento('inventario')}>Inventario</Pulsante>
          <Pulsante taglia="md" icona={<ArrowUp {...I} />} onClick={() => setMovimento('scarico')}>Scarico</Pulsante>
          <Pulsante variante="primario" taglia="md" icona={<ArrowDown {...I} />} onClick={() => setMovimento('carico')}>Carico merce</Pulsante>
        </>}
      </>}>
      {!t.mag_articoli.length ? (
        <Vuoto titolo="Il magazzino è vuoto" testo="Aggiungi i prodotti che compri (pasta, formaggi, vini…) con l’unità di misura e la scorta minima. Poi registri i carichi dalle bolle."
          azione={<Pulsante onClick={() => setProdotto('nuovo')}>Nuovo prodotto</Pulsante>} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Cerca valore={cerca} onCambia={setCerca} segnaposto="Cerca un prodotto" />
            <Chip attivo={sotto} onClick={() => setSotto(!sotto)}>Da ordinare {nSotto}</Chip>
          </div>
          {!lista.length ? <Vuoto titolo="Niente da mostrare" testo={sotto ? 'Tutti i prodotti sono sopra la scorta minima.' : `Nessun prodotto contiene “${cerca}”.`} /> : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {lista.map((m) => {
                const s = giacenza(t, m.id);
                const st = statoScorta(s);
                const f = t.fornitori.find((x) => x.id === m.fornitore_id);
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => setProdotto(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-base font-semibold">{m.nome}</span>
                        <span className="truncate text-sm text-text-muted">
                          {f?.ragione_sociale ?? 'Nessun fornitore'}
                          {m.costo_ultimo_cents != null && ` · ${euro(m.costo_ultimo_cents)}/${m.um_uso}`}
                          {s?.scorta_min != null && ` · min ${fmtQ(s.scorta_min)} ${m.um_uso}`}
                        </span>
                      </span>
                      {st !== 'ok' && (
                        <span className={`hidden rounded-pill px-2 py-0.5 text-xs font-bold sm:inline ${st === 'esaurita' ? 'bg-danger text-on-danger' : 'border border-warning text-warning'}`}>
                          {st === 'esaurita' ? 'Finito' : 'Sotto scorta'}
                        </span>
                      )}
                      <span className="w-28 flex-none text-right tabular-nums">
                        <span className={`text-lg font-bold ${st === 'esaurita' ? 'text-danger' : st === 'bassa' ? 'text-warning' : ''}`}>{fmtQ(s?.giacenza ?? 0)}</span> <span className="text-sm text-text-muted">{m.um_uso}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {prodotto && <EditorProdotto key={prodotto === 'nuovo' ? 'n' : prodotto.id} prodotto={prodotto === 'nuovo' ? null : prodotto} onChiudi={() => setProdotto(null)} />}
      {movimento && <NuovoMovimentoFoglio tipoIniziale={movimento} onChiudi={() => setMovimento(null)} />}
    </Sezione>
  );
}

function EditorProdotto({ prodotto, onChiudi }: { prodotto: MagArticoloRiga | null; onChiudi: () => void }) {
  const t = useTabelle();
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const s = prodotto ? giacenza(t, prodotto.id) : undefined;
  const [nome, setNome] = useState(prodotto?.nome ?? '');
  const [umUso, setUmUso] = useState(prodotto?.um_uso ?? 'kg');
  const [umAcquisto, setUmAcquisto] = useState(prodotto?.um_acquisto ?? '');
  const [fattore, setFattore] = useState<number | null>(prodotto?.fattore ?? 1);
  const [fornitore, setFornitore] = useState(prodotto?.fornitore_id ?? '');
  const [costo, setCosto] = useState<number | null>(prodotto?.costo_ultimo_cents ?? null);
  const [minimo, setMinimo] = useState<number | null>(s?.scorta_min ?? null);
  const usi = t.distinte.filter((d) => d.mag_articolo_id === prodotto?.id).map((d) => t.articoli.find((a) => a.id === d.articolo_id)?.nome).filter(Boolean);

  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Manca il nome del prodotto.');
    if (!fattore || fattore <= 0) throw new Error('La confezione deve contenere più di zero.');
    const m = await archivio.salva('mag_articoli', {
      ...(prodotto ? { id: prodotto.id } : {}), nome: nome.trim(), um_uso: umUso, um_acquisto: umAcquisto.trim() || umUso,
      fattore, fornitore_id: fornitore || null, costo_ultimo_cents: costo,
    });
    const sc = giacenza(archivio.tabelle(), m.id);
    if (sc || minimo != null) await archivio.salva('scorte', { mag_articolo_id: m.id, scorta_min: minimo, ...(sc ? {} : { giacenza: 0, scorta_max: null }) });
    onChiudi();
  }, prodotto ? 'Prodotto aggiornato' : 'Prodotto aggiunto');

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={prodotto ? prodotto.nome : 'Nuovo prodotto'}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!prodotto} placeholder="Es. Pecorino romano DOP" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Seleziona etichetta="Si misura in" value={umUso} onChange={(e) => setUmUso(e.target.value)}
            opzioni={['kg', 'g', 'l', 'cl', 'pz', 'bottiglia'].map((u) => ({ valore: u, testo: u }))} />
          <Testo etichetta="Si compra a" value={umAcquisto} onChange={(e) => setUmAcquisto(e.target.value)} placeholder="cartone 6 kg" />
          <CampoNumero etichetta="Una confezione =" valore={fattore} onCambia={setFattore} unita={umUso} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Seleziona etichetta="Fornitore" value={fornitore} onChange={(e) => setFornitore(e.target.value)}
            opzioni={[{ valore: '', testo: 'Nessuno' }, ...t.fornitori.map((f) => ({ valore: f.id, testo: f.ragione_sociale }))]} />
          <CampoEuro etichetta={`Costo per ${umUso}`} valore={costo} onCambia={setCosto} aiuto="Si aggiorna da solo a ogni carico" />
        </div>
        <CampoNumero etichetta="Scorta minima" valore={minimo} onCambia={setMinimo} unita={umUso} aiuto="Sotto questa quantità il prodotto compare in “Da ordinare”." />
        {prodotto && (
          <p className="text-sm text-text-muted">
            In magazzino: <strong className="text-text">{fmtQ(s?.giacenza ?? 0)} {umUso}</strong>
            {usi.length > 0 && <> · usato in {usi.join(', ')}</>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {prodotto && <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare “${prodotto.nome}” dal magazzino?`, () => void esegui(async () => { await archivio.elimina('mag_articoli', { id: prodotto.id }); onChiudi(); }, 'Prodotto eliminato'), 'Elimina')}>Elimina</Pulsante>}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}

const TIPI: { valore: TipoMov; testo: string }[] = [
  { valore: 'carico', testo: 'Carico' }, { valore: 'scarico', testo: 'Scarico' },
  { valore: 'scarto', testo: 'Scarto' }, { valore: 'inventario', testo: 'Inventario' },
];
const SPIEGA: Record<TipoMov, string> = {
  carico: 'Merce arrivata: la quantità si aggiunge alle scorte.',
  scarico: 'Merce uscita (uso interno, pasti del personale): la quantità si toglie.',
  scarto: 'Merce buttata o scaduta: la quantità si toglie.',
  inventario: 'Scrivi quanto hai contato: le scorte diventano quel numero.',
};

function NuovoMovimentoFoglio({ tipoIniziale, onChiudi }: { tipoIniziale: TipoMov; onChiudi: () => void }) {
  const t = useTabelle();
  const { operatore } = useApp();
  const { archivio, esegui, inCorso } = useSalva();
  const [tipo, setTipo] = useState<TipoMov>(tipoIniziale);
  const [fornitore, setFornitore] = useState('');
  const [rif, setRif] = useState('');
  const [righe, setRighe] = useState<{ id: string; quantita: number | null; costo: number | null }[]>(
    tipoIniziale === 'inventario' ? t.mag_articoli.map((m) => ({ id: m.id, quantita: null, costo: null })) : [],
  );
  const liberi = t.mag_articoli.filter((m) => !righe.some((r) => r.id === m.id)).filter((m) => tipo !== 'carico' || !fornitore || m.fornitore_id === fornitore || !m.fornitore_id);

  const registra = () => esegui(async () => {
    const valide = righe.filter((r) => r.quantita != null);
    if (!valide.length) throw new Error('Scrivi la quantità di almeno un prodotto.');
    await archivio.registraMovimento({
      tipo, fornitoreId: tipo === 'carico' ? fornitore || null : null, rif: rif.trim() || undefined, operatoreId: operatore?.id ?? null,
      righe: valide.map((r) => ({ magArticoloId: r.id, quantita: r.quantita!, costoCents: tipo === 'carico' ? r.costo : null })),
    });
    onChiudi();
  }, `${NOME_MOV[tipo]} registrato`);

  return (
    <Foglio aperto onChiudi={onChiudi} titolo="Movimento di magazzino" piede={<>
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void registra()}>Registra {NOME_MOV[tipo].toLowerCase()}</Pulsante>
    </>}>
      <div className="flex flex-col gap-4">
        <Segmenti etichetta="Tipo di movimento" valore={tipo} opzioni={TIPI} onCambia={(v) => {
          setTipo(v);
          if (v === 'inventario' && !righe.length) setRighe(t.mag_articoli.map((m) => ({ id: m.id, quantita: null, costo: null })));
        }} />
        <p className="-mt-2 text-sm text-text-muted">{SPIEGA[tipo]}</p>
        {tipo === 'carico' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Seleziona etichetta="Fornitore" value={fornitore} onChange={(e) => setFornitore(e.target.value)}
              opzioni={[{ valore: '', testo: 'Scegli…' }, ...t.fornitori.map((f) => ({ valore: f.id, testo: f.ragione_sociale }))]} />
            <Testo etichetta="Bolla o fattura n." value={rif} onChange={(e) => setRif(e.target.value)} placeholder="DDT 1234" />
          </div>
        )}
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {righe.length === 0 && <p className="px-3 py-4 text-sm text-text-muted">Aggiungi i prodotti qui sotto.</p>}
          {righe.map((r, i) => {
            const m = t.mag_articoli.find((x) => x.id === r.id)!;
            const s = giacenza(t, r.id);
            const agg = (p: Partial<typeof r>) => setRighe(righe.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={r.id} className="grid grid-cols-[1fr_auto] items-end gap-2 px-3 py-3 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                <div className="col-span-2 self-center sm:col-span-1">
                  <p className="font-semibold">{m.nome}</p>
                  <p className="text-xs text-text-muted">ora {fmtQ(s?.giacenza ?? 0)} {m.um_uso}{m.fattore !== 1 && tipo === 'carico' ? ` · 1 ${m.um_acquisto} = ${fmtQ(m.fattore)} ${m.um_uso}` : ''}</p>
                </div>
                <CampoNumero etichetta={tipo === 'inventario' ? 'Contato' : 'Quantità'} valore={r.quantita} unita={m.um_uso} onCambia={(n) => agg({ quantita: n })} />
                {tipo === 'carico' ? <CampoEuro etichetta={`€/${m.um_uso}`} valore={r.costo ?? m.costo_ultimo_cents} onCambia={(c) => agg({ costo: c })} /> : <span className="hidden sm:block" />}
                <button type="button" aria-label={`Togli ${m.nome}`} onClick={() => setRighe(righe.filter((_, j) => j !== i))}
                  className="premibile grid h-touch w-touch place-items-center rounded-md text-text-muted hover:bg-surface-2"><Trash size={20} weight="bold" aria-hidden="true" /></button>
              </div>
            );
          })}
          {liberi.length > 0 && (
            <select aria-label="Aggiungi un prodotto" value="" onChange={(e) => e.target.value && setRighe([...righe, { id: e.target.value, quantita: null, costo: null }])}
              className="h-touch rounded-b-lg border-0 bg-transparent px-3 text-base font-semibold text-accent outline-none focus:bg-surface-2">
              <option value="">+ Aggiungi prodotto</option>
              {liberi.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
        </div>
      </div>
    </Foglio>
  );
}

export function Movimenti() {
  const t = useTabelle();
  const [tipo, setTipo] = useState<MovimentoRiga['tipo'] | 'tutti'>('tutti');
  const [aperto, setAperto] = useState<string | null>(null);
  const lista = t.movimenti.filter((m) => tipo === 'tutti' || m.tipo === tipo);
  const tipiPresenti = [...new Set(t.movimenti.map((m) => m.tipo))];
  const nome = (id: string) => t.mag_articoli.find((x) => x.id === id);
  return (
    <Sezione titolo="Movimenti" sotto="Carichi, scarichi, inventari e vendite scaricate dalle ricette">
      {tipiPresenti.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Chip attivo={tipo === 'tutti'} onClick={() => setTipo('tutti')}>Tutti</Chip>
          {tipiPresenti.map((x) => <Chip key={x} attivo={tipo === x} onClick={() => setTipo(x)}>{NOME_MOV[x]}</Chip>)}
        </div>
      )}
      {!lista.length ? <Vuoto titolo="Nessun movimento" testo="Quando registri un carico o chiudi un conto con piatti che hanno la ricetta, i movimenti compaiono qui." /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {lista.map((m) => {
            const f = t.fornitori.find((x) => x.id === m.fornitore_id);
            const valore = m.righe.reduce((s, r) => s + (r.costo_unitario_cents ?? 0) * Math.abs(r.quantita), 0);
            const esteso = aperto === m.id;
            return (
              <li key={m.id}>
                <button type="button" aria-expanded={esteso} onClick={() => setAperto(esteso ? null : m.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
                  <span className={`w-24 flex-none text-sm font-bold ${m.tipo === 'carico' ? 'text-success' : m.tipo === 'inventario' ? 'text-accent' : 'text-text-muted'}`}>{NOME_MOV[m.tipo]}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{m.righe.length} prodott{m.righe.length === 1 ? 'o' : 'i'}{f ? ` · ${f.ragione_sociale}` : ''}{m.tipo !== 'vendita' && m.rif_documento ? ` · ${m.rif_documento}` : ''}</span>
                    <span className="text-sm text-text-muted">{new Date(m.data + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  </span>
                  {valore > 0 && <span className="font-semibold tabular-nums">{euro(Math.round(valore))}</span>}
                </button>
                {esteso && (
                  <ul className="bg-bg px-4 py-2">
                    {m.righe.map((r, i) => {
                      const p = nome(r.mag_articolo_id);
                      return (
                        <li key={i} className="flex justify-between py-1 text-sm">
                          <span>{p?.nome ?? 'Prodotto eliminato'}</span>
                          <span className={`tabular-nums font-semibold ${r.quantita >= 0 ? 'text-success' : 'text-text'}`}>{r.quantita >= 0 ? '+' : '−'}{fmtQ(Math.abs(r.quantita))} {p?.um_uso}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sezione>
  );
}

export function Fornitori() {
  const t = useTabelle();
  const [aperto, setAperto] = useState<FornitoreRiga | 'nuovo' | null>(null);
  return (
    <Sezione titolo="Fornitori" azioni={<Pulsante variante="primario" taglia="md" icona={<Plus {...I} />} onClick={() => setAperto('nuovo')}>Nuovo fornitore</Pulsante>}>
      {!t.fornitori.length ? <Vuoto titolo="Nessun fornitore" testo="Aggiungi chi ti porta la merce (MARR, Metro, il caseificio…) per collegarlo ai prodotti e ai carichi." /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {[...t.fornitori].sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale)).map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setAperto(f)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold">{f.ragione_sociale}</span>
                  <span className="truncate text-sm text-text-muted">{[f.piva && `P.IVA ${f.piva}`, f.email_ordini].filter(Boolean).join(' · ') || 'Nessun contatto'}</span>
                </span>
                <span className="text-sm text-text-muted">{t.mag_articoli.filter((m) => m.fornitore_id === f.id).length} prodotti</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {aperto && <EditorFornitore key={aperto === 'nuovo' ? 'n' : aperto.id} fornitore={aperto === 'nuovo' ? null : aperto} onChiudi={() => setAperto(null)} />}
    </Sezione>
  );
}

function EditorFornitore({ fornitore, onChiudi }: { fornitore: FornitoreRiga | null; onChiudi: () => void }) {
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const [nome, setNome] = useState(fornitore?.ragione_sociale ?? '');
  const [piva, setPiva] = useState(fornitore?.piva ?? '');
  const [email, setEmail] = useState(fornitore?.email_ordini ?? '');
  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Manca il nome del fornitore.');
    await archivio.salva('fornitori', { ...(fornitore ? { id: fornitore.id } : {}), ragione_sociale: nome.trim(), piva: piva.trim() || null, email_ordini: email.trim() || null });
    onChiudi();
  }, fornitore ? 'Fornitore aggiornato' : 'Fornitore aggiunto');
  return (
    <Foglio aperto onChiudi={onChiudi} titolo={fornitore ? fornitore.ragione_sociale : 'Nuovo fornitore'}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Ragione sociale" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!fornitore} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Testo etichetta="Partita IVA" value={piva} onChange={(e) => setPiva(e.target.value)} inputMode="numeric" />
          <Testo etichetta="Email per gli ordini" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {fornitore && <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare “${fornitore.ragione_sociale}”? I prodotti restano, senza fornitore.`, () => void esegui(async () => { await archivio.elimina('fornitori', { id: fornitore.id }); onChiudi(); }, 'Fornitore eliminato'), 'Elimina')}>Elimina</Pulsante>}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}
