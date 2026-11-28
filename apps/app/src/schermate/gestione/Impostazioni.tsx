// Impostazioni della cassa: metodi di pagamento (Satispay, buoni pasto per emittente), promozioni (happy hour),
// menu fissi e abbinamenti consigliati. Tutto vive in locali.impostazioni.
import { useMemo, useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { euro, type Impostazioni, type MetodoPagamento, type MenuFisso, type PosConfig, type Promozione } from '@gr/core';
import { useApp, useAzione, useDati } from '../../dati/contesto';
import { CampoEuro, CampoNumero, Cerca, Chip, Interruttore, Seleziona, Testo } from '../../ui/campi';
import { Foglio, Pulsante } from '../../ui/primitivi';
import { Sezione } from './Layout';

const id = () => Math.random().toString(36).slice(2, 10);
const GIORNI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const PORTATE = [{ valore: '0', testo: 'Bevande' }, { valore: '1', testo: '1ª portata' }, { valore: '2', testo: '2ª portata' }, { valore: '3', testo: '3ª portata' }, { valore: '9', testo: 'Dessert' }];

function useImpostazioni() {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const imp = useDati((d) => d.setup().impostazioni ?? {}) as Impostazioni;
  const salva = (cambio: Partial<Impostazioni>, msg = 'Salvato') => esegui(() => db.salvaImpostazioni({ ...imp, ...cambio }), msg);
  return { imp, salva, inCorso };
}

export function Pagamenti() {
  const { imp, salva } = useImpostazioni();
  const metodi = imp.metodi ?? [];
  const buoni = imp.buoniPasto ?? [];
  const [nomeMetodo, setNomeMetodo] = useState('');
  const [tipo, setTipo] = useState<MetodoPagamento['tipo']>('carta');
  const [nomeBuono, setNomeBuono] = useState('');
  return (
    <Sezione titolo="Pagamenti" sotto="Contanti, carta e buono pasto ci sono sempre. Qui aggiungi gli altri (Satispay, PayPal, bonifico) e gli emittenti dei buoni pasto.">
      <h3 className="mb-2 text-lg font-semibold">Metodi aggiuntivi</h3>
      <ul className="mb-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {metodi.length === 0 && <li className="p-4 text-sm text-text-muted">Nessuno. Esempio: “Satispay” come pagamento elettronico.</li>}
        {metodi.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="flex-1 font-semibold">{m.nome} <span className="text-sm font-normal text-text-muted">· {m.tipo === 'contanti' ? 'contanti' : m.tipo === 'buono_pasto' ? 'buono pasto' : 'elettronico sullo scontrino'}</span></span>
            <div className="w-56"><Interruttore etichetta="Attivo" attivo={m.attivo} onCambia={(v) => void salva({ metodi: metodi.map((x) => (x.id === m.id ? { ...x, attivo: v } : x)) })} /></div>
            <Pulsante taglia="md" variante="fantasma" aria-label={`Elimina ${m.nome}`} icona={<Trash size={18} weight="bold" aria-hidden />} onClick={() => void salva({ metodi: metodi.filter((x) => x.id !== m.id) }, 'Eliminato')} />
          </li>
        ))}
      </ul>
      <div className="mb-8 flex flex-wrap items-end gap-3">
        <Testo etichetta="Nome" value={nomeMetodo} onChange={(e) => setNomeMetodo(e.target.value)} placeholder="Satispay" className="min-w-[12rem] flex-1" />
        <Seleziona etichetta="Sullo scontrino come" value={tipo} onChange={(e) => setTipo(e.target.value as MetodoPagamento['tipo'])} className="w-60"
          opzioni={[{ valore: 'carta', testo: 'Pagamento elettronico' }, { valore: 'bonifico', testo: 'Bonifico (elettronico)' }, { valore: 'prepagata', testo: 'Prepagata / gift card' }, { valore: 'contanti', testo: 'Contanti' }]} />
        <Pulsante variante="primario" taglia="lg" icona={<Plus size={18} weight="bold" aria-hidden />} disabled={!nomeMetodo.trim()}
          onClick={() => void salva({ metodi: [...metodi, { id: id(), nome: nomeMetodo.trim(), tipo, attivo: true }] }, `${nomeMetodo} aggiunto`).then(() => setNomeMetodo(''))}>Aggiungi</Pulsante>
      </div>

      <PosLocale />

      <h3 className="mb-2 text-lg font-semibold">Buoni pasto: emittenti</h3>
      <p className="mb-3 text-sm text-text-muted">Al conto, scelto “Buono pasto”, si tocca l’emittente: così a fine mese sai quanto chiedere a ognuno.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {buoni.length === 0 && <span className="text-sm text-text-muted">Nessun emittente. Esempi: Edenred, Pluxee, Day, Yes Ticket.</span>}
        {buoni.map((b) => (
          <span key={b.id} className="inline-flex h-10 items-center gap-2 rounded-pill border border-border bg-surface pl-4 pr-1 text-sm font-semibold">
            {b.nome}
            <button type="button" aria-label={`Togli ${b.nome}`} onClick={() => void salva({ buoniPasto: buoni.filter((x) => x.id !== b.id) }, 'Tolto')}
              className="premibile grid h-8 w-8 place-items-center rounded-pill text-text-muted"><Trash size={14} weight="bold" aria-hidden /></button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Testo etichetta="Emittente" value={nomeBuono} onChange={(e) => setNomeBuono(e.target.value)} placeholder="Edenred" className="min-w-[12rem] flex-1" />
        <Pulsante taglia="lg" icona={<Plus size={18} weight="bold" aria-hidden />} disabled={!nomeBuono.trim()}
          onClick={() => void salva({ buoniPasto: [...buoni, { id: id(), nome: nomeBuono.trim() }] }, `${nomeBuono} aggiunto`).then(() => setNomeBuono(''))}>Aggiungi</Pulsante>
      </div>
    </Sezione>
  );
}

export function Promozioni() {
  const { imp, salva, inCorso } = useImpostazioni();
  const setup = useDati((d) => d.setup());
  const promo = imp.promozioni ?? [];
  const [editor, setEditor] = useState<Promozione | null>(null);
  const nuova = (): Promozione => ({ id: id(), nome: 'Happy hour', attiva: true, percentuale: 20, categorieIds: [], articoliIds: [], giorni: [], dalle: '18:00', alle: '20:00' });
  const salvaPromo = (p: Promozione) => void salva({ promozioni: promo.some((x) => x.id === p.id) ? promo.map((x) => (x.id === p.id ? p : x)) : [...promo, p] }, 'Promozione salvata').then((ok) => ok && setEditor(null));
  return (
    <Sezione titolo="Promozioni" sotto="Sconti automatici a orario (happy hour, pranzo di lavoro): in comanda il prezzo scende da solo e la cucina non vede niente."
      azioni={<Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditor(nuova())}>Nuova promozione</Pulsante>}>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {promo.length === 0 && <li className="p-6 text-center text-text-muted">Nessuna promozione. Esempio: cocktail −20% dalle 18 alle 20.</li>}
        {promo.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setEditor(p)} className="premibile flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
              <span className="flex-1"><span className="block font-semibold">{p.nome}{p.attiva ? '' : ' · spenta'}</span>
                <span className="block text-sm text-text-muted">
                  {p.percentuale ? `−${p.percentuale}%` : p.prezzoCents ? `a ${euro(p.prezzoCents)}` : ''} · {p.dalle}–{p.alle} · {p.giorni.length ? p.giorni.map((g) => GIORNI[g]).join(' ') : 'tutti i giorni'}
                  {' · '}{[...p.categorieIds.map((c) => setup.categorie.find((x) => x.id === c)?.nome), ...p.articoliIds.map((a) => setup.articoli.find((x) => x.id === a)?.nome)].filter(Boolean).join(', ') || 'nessun articolo'}
                </span></span>
            </button>
          </li>
        ))}
      </ul>
      {editor && (
        <Foglio aperto onChiudi={() => setEditor(null)} titolo={editor.nome || 'Promozione'}>
          <EditorPromo iniziale={editor} inCorso={inCorso} onSalva={salvaPromo}
            onElimina={promo.some((x) => x.id === editor.id) ? () => void salva({ promozioni: promo.filter((x) => x.id !== editor.id) }, 'Eliminata').then(() => setEditor(null)) : undefined} />
        </Foglio>
      )}
    </Sezione>
  );
}

function EditorPromo({ iniziale, inCorso, onSalva, onElimina }: { iniziale: Promozione; inCorso: boolean; onSalva: (p: Promozione) => void; onElimina?: () => void }) {
  const setup = useDati((d) => d.setup());
  const [p, setP] = useState(iniziale);
  const [modo, setModo] = useState<'percentuale' | 'prezzo'>(iniziale.prezzoCents ? 'prezzo' : 'percentuale');
  const tog = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  return (
    <div className="flex flex-col gap-4">
      <Testo etichetta="Nome" value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} />
      <Interruttore etichetta="Attiva" attivo={p.attiva} onCambia={(v) => setP({ ...p, attiva: v })} />
      <div className="flex flex-wrap gap-2">
        <Chip attivo={modo === 'percentuale'} onClick={() => setModo('percentuale')}>Sconto in %</Chip>
        <Chip attivo={modo === 'prezzo'} onClick={() => setModo('prezzo')}>Prezzo fisso</Chip>
      </div>
      {modo === 'percentuale'
        ? <CampoNumero etichetta="Sconto" unita="%" valore={p.percentuale ?? null} onCambia={(n) => setP({ ...p, percentuale: n ?? undefined, prezzoCents: undefined })} />
        : <CampoEuro etichetta="Prezzo in promozione" valore={p.prezzoCents ?? null} onCambia={(c) => setP({ ...p, prezzoCents: c ?? undefined, percentuale: undefined })} />}
      <div className="grid grid-cols-2 gap-3">
        <Testo etichetta="Dalle" type="time" value={p.dalle} onChange={(e) => setP({ ...p, dalle: e.target.value })} />
        <Testo etichetta="Alle" type="time" value={p.alle} onChange={(e) => setP({ ...p, alle: e.target.value })} />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-text-muted">Giorni (nessuno = tutti)</p>
        <div className="flex flex-wrap gap-2">{GIORNI.map((g, i) => <Chip key={g} attivo={p.giorni.includes(i)} onClick={() => setP({ ...p, giorni: tog(p.giorni, i) })}>{g}</Chip>)}</div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-text-muted">Categorie in promozione</p>
        <div className="flex flex-wrap gap-2">{setup.categorie.map((c) => <Chip key={c.id} attivo={p.categorieIds.includes(c.id)} onClick={() => setP({ ...p, categorieIds: tog(p.categorieIds, c.id) })}>{c.nome}</Chip>)}</div>
      </div>
      <SceltaArticoli etichetta="Oppure singoli articoli" scelti={p.articoliIds} onCambia={(a) => setP({ ...p, articoliIds: a })} />
      <div className="flex gap-2">
        {onElimina && <Pulsante taglia="lg" variante="pericolo" onClick={onElimina}>Elimina</Pulsante>}
        <Pulsante taglia="lg" variante="primario" className="flex-1" caricamento={inCorso} onClick={() => onSalva(p)}>Salva</Pulsante>
      </div>
    </div>
  );
}

/** Ricerca e scelta di più articoli (chip). */
function SceltaArticoli({ etichetta, scelti, onCambia }: { etichetta: string; scelti: string[]; onCambia: (ids: string[]) => void }) {
  const setup = useDati((d) => d.setup());
  const [cerca, setCerca] = useState('');
  const trovati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return q ? setup.articoli.filter((a) => a.nome.toLowerCase().includes(q) && !scelti.includes(a.id)).slice(0, 12) : [];
  }, [cerca, setup.articoli, scelti]);
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-text-muted">{etichetta}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {scelti.map((a) => <Chip key={a} attivo onClick={() => onCambia(scelti.filter((x) => x !== a))}>{setup.articoli.find((x) => x.id === a)?.nome ?? '?'} ×</Chip>)}
      </div>
      <Cerca valore={cerca} onCambia={setCerca} segnaposto="Cerca un articolo da aggiungere" />
      {trovati.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {trovati.map((a) => <Chip key={a.id} attivo={false} onClick={() => { onCambia([...scelti, a.id]); setCerca(''); }}>+ {a.nome}</Chip>)}
        </div>
      )}
    </div>
  );
}

export function MenuFissi() {
  const { imp, salva, inCorso } = useImpostazioni();
  const setup = useDati((d) => d.setup());
  const menu = imp.menuFissi ?? {};
  const abb = imp.abbinamenti ?? {};
  const [editor, setEditor] = useState<{ articoloId: string; m: MenuFisso } | null>(null);
  const [abbEditor, setAbbEditor] = useState<{ articoloId: string; ids: string[] } | null>(null);
  const nome = (a: string) => setup.articoli.find((x) => x.id === a)?.nome ?? '(articolo tolto)';
  return (
    <Sezione titolo="Menu fissi e abbinamenti" sotto="Un menu fisso è un articolo con il suo prezzo: in comanda si scelgono i piatti di ogni gruppo, che vanno in cucina a prezzo zero.">
      <div className="mb-3 flex justify-end">
        <Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditor({ articoloId: '', m: { gruppi: [{ nome: 'Antipasto', articoliIds: [], scelte: 1, portata: 1 }] } })}>Nuovo menu fisso</Pulsante>
      </div>
      <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-surface">
        {Object.keys(menu).length === 0 && <li className="p-6 text-center text-text-muted">Nessun menu fisso. Esempio: “Menu degustazione 45 €” con antipasto, primo e dolce a scelta.</li>}
        {Object.entries(menu).map(([a, m]) => (
          <li key={a}>
            <button type="button" onClick={() => setEditor({ articoloId: a, m })} className="premibile flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="flex-1"><span className="block font-semibold">{nome(a)}</span>
                <span className="block text-sm text-text-muted">{m.gruppi.map((g) => `${g.nome} (${g.scelte} su ${g.articoliIds.length})`).join(' · ')}</span></span>
              <span className="tabular-nums">{euro(setup.articoli.find((x) => x.id === a)?.prezzoCents ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Abbinamenti consigliati</h3>
          <p className="text-sm text-text-muted">Quando il cameriere aggiunge un piatto, la comanda propone questi (es. polpo → Fiorduva al calice).</p></div>
        <Pulsante taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setAbbEditor({ articoloId: '', ids: [] })}>Nuovo abbinamento</Pulsante>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {Object.keys(abb).length === 0 && <li className="p-6 text-center text-text-muted">Nessun abbinamento.</li>}
        {Object.entries(abb).map(([a, ids]) => (
          <li key={a}><button type="button" onClick={() => setAbbEditor({ articoloId: a, ids })} className="premibile flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="font-semibold">{nome(a)}</span><span className="text-sm text-text-muted">→ {ids.map(nome).join(', ')}</span></button></li>
        ))}
      </ul>

      {editor && (
        <Foglio aperto onChiudi={() => setEditor(null)} titolo={editor.articoloId ? nome(editor.articoloId) : 'Nuovo menu fisso'}>
          <EditorMenu iniziale={editor} inCorso={inCorso}
            onSalva={(a, m) => void salva({ menuFissi: { ...Object.fromEntries(Object.entries(menu).filter(([k]) => k !== editor.articoloId)), [a]: m } }, 'Menu salvato').then((ok) => ok && setEditor(null))}
            onElimina={editor.articoloId ? () => void salva({ menuFissi: Object.fromEntries(Object.entries(menu).filter(([k]) => k !== editor.articoloId)) }, 'Eliminato').then(() => setEditor(null)) : undefined} />
        </Foglio>
      )}
      {abbEditor && (
        <Foglio aperto onChiudi={() => setAbbEditor(null)} titolo="Abbinamento">
          <div className="flex flex-col gap-4">
            <Seleziona etichetta="Quando si ordina" value={abbEditor.articoloId} onChange={(e) => setAbbEditor({ ...abbEditor, articoloId: e.target.value })}
              opzioni={[{ valore: '', testo: 'Scegli un piatto' }, ...setup.articoli.map((a) => ({ valore: a.id, testo: a.nome }))]} />
            <SceltaArticoli etichetta="Proponi" scelti={abbEditor.ids} onCambia={(ids) => setAbbEditor({ ...abbEditor, ids })} />
            <div className="flex gap-2">
              {abb[abbEditor.articoloId] && <Pulsante taglia="lg" variante="pericolo" onClick={() => void salva({ abbinamenti: Object.fromEntries(Object.entries(abb).filter(([k]) => k !== abbEditor.articoloId)) }, 'Eliminato').then(() => setAbbEditor(null))}>Elimina</Pulsante>}
              <Pulsante taglia="lg" variante="primario" className="flex-1" caricamento={inCorso} disabled={!abbEditor.articoloId || !abbEditor.ids.length}
                onClick={() => void salva({ abbinamenti: { ...abb, [abbEditor.articoloId]: abbEditor.ids } }, 'Abbinamento salvato').then((ok) => ok && setAbbEditor(null))}>Salva</Pulsante>
            </div>
          </div>
        </Foglio>
      )}
    </Sezione>
  );
}

function EditorMenu({ iniziale, inCorso, onSalva, onElimina }: {
  iniziale: { articoloId: string; m: MenuFisso }; inCorso: boolean; onSalva: (articoloId: string, m: MenuFisso) => void; onElimina?: () => void;
}) {
  const setup = useDati((d) => d.setup());
  const [articoloId, setArticoloId] = useState(iniziale.articoloId);
  const [gruppi, setGruppi] = useState(iniziale.m.gruppi);
  const cambia = (i: number, g: Partial<MenuFisso['gruppi'][number]>) => setGruppi(gruppi.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const errore = !articoloId ? 'Scegli l’articolo del menu (con il suo prezzo): se non c’è, crealo in Articoli.'
    : gruppi.some((g) => !g.nome.trim() || g.articoliIds.length < g.scelte || g.scelte < 1) ? 'Ogni gruppo ha un nome e almeno tanti piatti quante sono le scelte.' : null;
  return (
    <div className="flex flex-col gap-5">
      <Seleziona etichetta="Articolo del menu (il prezzo è il suo)" value={articoloId} onChange={(e) => setArticoloId(e.target.value)}
        opzioni={[{ valore: '', testo: 'Scegli' }, ...setup.articoli.map((a) => ({ valore: a.id, testo: `${a.nome} · ${euro(a.prezzoCents)}` }))]} />
      {gruppi.map((g, i) => (
        <section key={i} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="grid grid-cols-[1fr_7rem_9rem_auto] items-end gap-2">
            <Testo etichetta={`Gruppo ${i + 1}`} value={g.nome} onChange={(e) => cambia(i, { nome: e.target.value })} />
            <CampoNumero etichetta="Scelte" valore={g.scelte} min={1} onCambia={(n) => cambia(i, { scelte: n ?? 1 })} />
            <Seleziona etichetta="Portata" value={String(g.portata)} onChange={(e) => cambia(i, { portata: Number(e.target.value) })} opzioni={PORTATE} />
            <Pulsante taglia="lg" variante="fantasma" aria-label={`Togli il gruppo ${g.nome}`} icona={<Trash size={18} weight="bold" aria-hidden />} onClick={() => setGruppi(gruppi.filter((_, j) => j !== i))} />
          </div>
          <SceltaArticoli etichetta="Piatti tra cui scegliere" scelti={g.articoliIds} onCambia={(ids) => cambia(i, { articoliIds: ids })} />
        </section>
      ))}
      <Pulsante taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setGruppi([...gruppi, { nome: '', articoliIds: [], scelte: 1, portata: Math.min(9, (gruppi.at(-1)?.portata ?? 0) + 1) }])}>Aggiungi gruppo</Pulsante>
      {errore && <p className="text-sm font-semibold text-warning">{errore}</p>}
      <div className="flex gap-2">
        {onElimina && <Pulsante taglia="lg" variante="pericolo" onClick={onElimina}>Elimina</Pulsante>}
        <Pulsante taglia="lg" variante="primario" className="flex-1" disabled={!!errore} caricamento={inCorso} onClick={() => onSalva(articoloId, { gruppi })}>Salva</Pulsante>
      </div>
    </div>
  );
}

/** POS bancari: collegati (la cassa manda l'importo con il Protocollo 17) o usati a mano. */
function PosLocale() {
  const { imp, salva, inCorso } = useImpostazioni();
  const lista = imp.pos ?? [];
  const [editor, setEditor] = useState<PosConfig | null>(null);
  const salvaPos = (p: PosConfig) => void salva({ pos: lista.some((x) => x.id === p.id) ? lista.map((x) => (x.id === p.id ? p : x)) : [...lista, p] }, `${p.nome} salvato`).then((ok) => ok && setEditor(null));
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div><h3 className="text-lg font-semibold">POS</h3>
          <p className="text-sm text-text-muted">Al conto, scelta “Carta”, si tocca il POS. Quello collegato riceve l’importo dalla cassa e lo scontrino esce appena il POS approva.</p></div>
        <Pulsante taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditor({ id: id(), nome: '', collegato: false, porta: 10000 })}>Aggiungi POS</Pulsante>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {lista.length === 0 && <li className="p-4 text-sm text-text-muted">Nessun POS. Esempio: UniCredit (collegato) e FlatPay (a mano).</li>}
        {lista.map((p) => (
          <li key={p.id}><button type="button" onClick={() => setEditor(p)} className="premibile flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex-1"><span className="block font-semibold">{p.nome}</span>
              <span className="block text-sm text-text-muted">{p.collegato ? `Collegato · ${p.host}:${p.porta} · terminale ${p.terminale || '—'}` : 'A mano (l’importo si batte sul POS)'}{p.nota ? ` · ${p.nota}` : ''}</span></span>
          </button></li>
        ))}
      </ul>
      {editor && (
        <Foglio aperto onChiudi={() => setEditor(null)} titolo={editor.nome || 'Nuovo POS'}>
          <div className="flex flex-col gap-4">
            <Testo etichetta="Nome" value={editor.nome} onChange={(e) => setEditor({ ...editor, nome: e.target.value })} placeholder="UniCredit" />
            <Interruttore etichetta="Collegato alla cassa" descrizione="Protocollo 17 in rete: la cassa manda l’importo e riceve l’esito." attivo={editor.collegato} onCambia={(v) => setEditor({ ...editor, collegato: v })} />
            {editor.collegato && (
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <Testo etichetta="Indirizzo IP" value={editor.host ?? ''} onChange={(e) => setEditor({ ...editor, host: e.target.value.trim() })} placeholder="192.168.178.88" inputMode="decimal" />
                <CampoNumero etichetta="Porta" valore={editor.porta ?? null} onCambia={(n) => setEditor({ ...editor, porta: n ?? undefined })} />
                <Testo etichetta="ID terminale" aiuto="È sullo scontrino “Informazioni generali” del POS" value={editor.terminale ?? ''} onChange={(e) => setEditor({ ...editor, terminale: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="31197403" className="col-span-2" />
              </div>
            )}
            <Testo etichetta="Nota per chi incassa (facoltativa)" value={editor.nota ?? ''} onChange={(e) => setEditor({ ...editor, nota: e.target.value })} placeholder="Accetta American Express" />
            <div className="flex gap-2">
              {lista.some((x) => x.id === editor.id) && <Pulsante taglia="lg" variante="pericolo" onClick={() => void salva({ pos: lista.filter((x) => x.id !== editor.id) }, 'POS tolto').then(() => setEditor(null))}>Togli</Pulsante>}
              <Pulsante taglia="lg" variante="primario" className="flex-1" caricamento={inCorso}
                disabled={!editor.nome.trim() || (editor.collegato && (!editor.host || !editor.porta))} onClick={() => salvaPos({ ...editor, nome: editor.nome.trim() })}>Salva</Pulsante>
            </div>
          </div>
        </Foglio>
      )}
    </section>
  );
}
