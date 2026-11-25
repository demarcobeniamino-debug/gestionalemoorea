import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ALLERGENI_ETICHETTA, calcolaConto, euro, importoRiga, nomePortata,
  type Allergene, type Articolo, type RigaComanda, type RigaVariante,
} from '@gr/core';
import { nuovaChiave, useApp, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Icona, Pulsante, useConferma } from '../ui/primitivi';

const PORTATE = [0, 1, 2, 3, 9];
const ETICHETTA_STATO: Partial<Record<RigaComanda['stato'], string>> = {
  inviata: 'inviata', in_preparazione: 'in preparazione', pronta: 'pronta', servita: 'servita', stornata: 'stornata',
};

// S06 + S07 + S10 — presa comanda, varianti, invio per portata.
export function ComandaSchermata() {
  const { id = '' } = useParams();
  const { db, toast, operatore } = useApp();
  const nav = useNavigate();
  const { comanda, righe, setup } = useDati((d) => ({ comanda: d.comanda(id), righe: d.righe(id), setup: d.setup() }));
  const [categoriaId, setCategoriaId] = useState(setup.categorie[0].id);
  const [portata, setPortata] = useState<number | null>(null); // null = quella predefinita della categoria
  const [cerca, setCerca] = useState('');
  const [varianti, setVarianti] = useState<Articolo | null>(null);
  const [storno, setStorno] = useState<RigaComanda | null>(null);
  const [allergeniAperto, setAllergeniAperto] = useState(false);
  const [riepilogoMobile, setRiepilogoMobile] = useState(false);
  const [invio, setInvio] = useState(false);
  const conferma = useConferma();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lungo = useRef(false);

  const tavolo = setup.tavoli.find((t) => t.id === comanda?.tavoloId);
  const conto = useMemo(() => calcolaConto(righe, comanda?.coperti ?? 0, setup.locale.copertoCents), [righe, comanda, setup]);

  if (!comanda) return <main className="p-8"><p className="mb-4 text-base">Questa comanda non esiste più.</p><Link className="underline" to="/sala">Torna alla sala</Link></main>;
  if (comanda.stato === 'chiusa') { nav('/sala', { replace: true }); return null; }

  const articoli = setup.articoli.filter((a) =>
    cerca.trim() ? a.nome.toLowerCase().includes(cerca.trim().toLowerCase()) : a.categoriaId === categoriaId);
  const categoria = setup.categorie.find((c) => c.id === categoriaId)!;
  const portataEffettiva = (a: Articolo) => portata ?? setup.categorie.find((c) => c.id === a.categoriaId)!.portataPredefinita;
  const daInviare = righe.filter((r) => r.stato === 'da_inviare');
  const nelConto = (a: Articolo) => righe.filter((r) => r.articoloId === a.id && r.stato !== 'stornata').reduce((s, r) => s + r.quantita, 0);

  const aggiungi = (a: Articolo, extra: { varianti?: RigaVariante[]; note?: string; posto?: number } = {}) => {
    try { db.aggiungiRiga(comanda.id, { articoloId: a.id, portata: portataEffettiva(a), ...extra }); }
    catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); }
  };

  const invia = (p?: number) => {
    setInvio(true);
    try {
      const jobs = db.invia(comanda.id, nuovaChiave(), p);
      const dove = [...new Set(jobs.map((j) => setup.stampanti.find((s) => s.id === j.stampanteId)?.nome))].join(' e ');
      toast({ testo: `Inviata a ${dove || 'produzione'}`, tipo: 'ok' });
      setRiepilogoMobile(false);
    } catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); }
    finally { setInvio(false); }
  };

  // tocco lungo = varianti
  const premi = (a: Articolo) => { lungo.current = false; timer.current = setTimeout(() => { lungo.current = true; setVarianti(a); }, 450); };
  const rilascia = (a: Articolo) => { clearTimeout(timer.current); if (!lungo.current && !a.esaurito) aggiungi(a); };

  const riepilogo = (
    <aside aria-label="Comanda" className="flex h-full flex-col bg-surface">
      {comanda.allergeniTavolo.length > 0 && (
        <div className="flex items-center gap-2 bg-allergene px-4 py-2 text-sm font-bold text-on-allergene">
          {Icona.avviso}ALLERGIA {comanda.allergeniTavolo.map((a) => `${ALLERGENI_ETICHETTA[a.allergene].toUpperCase()}${a.posto ? ` (posto ${a.posto})` : ''}`).join(' · ')}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {righe.length === 0 && <p className="py-8 text-center text-base text-text-muted">Il conto è vuoto. Scegli una categoria per iniziare.</p>}
        {conto.perPortata.map(({ portata: p, righe: rr }) => {
          const tutteInviate = rr.every((r) => r.stato !== 'da_inviare');
          return (
            <section key={p} className="mb-3">
              <h3 className={`mb-1 flex justify-between text-xs font-bold uppercase ${tutteInviate ? 'text-text-muted' : 'text-accent'}`}>
                <span>{nomePortata(p)}</span><span>{tutteInviate ? 'inviata' : 'da inviare'}</span>
              </h3>
              <ul className="flex flex-col gap-1">
                {rr.map((r) => (
                  <li key={r.id}>
                    <button type="button"
                      onClick={() => r.stato === 'da_inviare' ? db.togliRiga(r.id) : r.stato !== 'stornata' && setStorno(r)}
                      aria-label={`${r.quantita} ${r.descrizione}, ${euro(importoRiga(r))}. ${r.stato === 'da_inviare' ? 'Tocca per togliere' : 'Tocca per stornare'}`}
                      className={`w-full rounded-r-sm py-1 pl-2 text-left text-[15px] tabular-nums ${r.stato === 'da_inviare' ? 'border-l-[3px] border-accent' : 'border-l-[3px] border-transparent text-text-muted'} ${r.stato === 'stornata' ? 'line-through' : ''}`}>
                      <span className="flex justify-between gap-2"><span>{r.quantita} × {r.descrizione}</span><span>{euro(importoRiga(r), false)}</span></span>
                      {r.varianti.map((v) => <span key={v.nome} className="block pl-5 text-[13px] text-text-muted">{v.nome}{v.deltaCents ? ` ${euro(v.deltaCents, false)}` : ''}</span>)}
                      {r.posto && <span className="block pl-5 text-[13px] text-text-muted">posto {r.posto}</span>}
                      {r.note && <span className="block pl-5 text-[13px] italic text-text-muted">{r.note}</span>}
                      {r.stato !== 'da_inviare' && r.stato !== 'inviata' && <span className="block pl-5 text-[12px] text-text-muted">{ETICHETTA_STATO[r.stato]}{r.motivoStorno ? ` · ${r.motivoStorno}` : ''}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {comanda.coperti > 0 && setup.locale.copertoCents > 0 && (
          <div className="flex justify-between text-[15px] text-text-muted tabular-nums"><span>{comanda.coperti} × Coperto</span><span>{euro(conto.copertoCents, false)}</span></div>
        )}
      </div>
      <div className="flex items-baseline justify-between border-t border-border px-4 py-3">
        <span className="font-semibold text-text-muted">Totale</span>
        <span className="text-xl font-bold tabular-nums">{euro(conto.totaleCents)}</span>
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <Pulsante className="flex-1" onClick={() => { try { db.preconto(comanda.id, nuovaChiave()); toast({ testo: 'Preconto in stampa', tipo: 'ok' }); } catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); } }}>Preconto</Pulsante>
        <Pulsante className="flex-1" disabled={righe.length === 0 || daInviare.length > 0} onClick={() => nav(`/conto/${comanda.id}`)}
          title={daInviare.length ? 'Invia prima le righe in attesa' : undefined}>Conto</Pulsante>
        <Pulsante variante="conferma" className="flex-[1.6]" icona={Icona.stampa} caricamento={invio}
          disabled={daInviare.length === 0} onClick={() => invia()}>
          Invia{daInviare.length ? ` (${daInviare.length})` : ''}
        </Pulsante>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata indietro="/sala" titolo={`Tavolo ${tavolo?.numero ?? ''}`} sotto={`${comanda.coperti} coperti · ${operatore?.nome ?? comanda.operatore}`}>
        <button type="button" onClick={() => setAllergeniAperto(true)}
          className={`h-10 rounded-md px-3 text-sm font-bold ${comanda.allergeniTavolo.length ? 'bg-allergene text-on-allergene' : 'border border-border bg-surface-2'}`}>
          Allergie{comanda.allergeniTavolo.length ? ` (${comanda.allergeniTavolo.length})` : ''}
        </button>
      </Testata>

      <div className="flex min-h-0 flex-1">
        {/* Categorie: colonna su cassa/tablet, striscia orizzontale su palmare */}
        <nav aria-label="Categorie" className="hidden w-44 flex-none flex-col gap-2 overflow-y-auto border-r border-border p-3 md:flex">
          {setup.categorie.map((c) => (
            <button key={c.id} type="button" onClick={() => { setCategoriaId(c.id); setCerca(''); }} aria-pressed={c.id === categoriaId && !cerca}
              style={{ background: c.colore, color: c.testoColore }}
              className={`h-16 flex-none rounded-md px-3 text-left text-base font-bold ${c.id === categoriaId && !cerca ? 'outline outline-[3px] outline-offset-2 outline-focus' : ''}`}>{c.nome}</button>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:px-4">
            <span className="text-xs font-semibold text-text-muted">Portata</span>
            <div role="radiogroup" aria-label="Portata" className="flex gap-1.5 overflow-x-auto">
              <button type="button" role="radio" aria-checked={portata === null} onClick={() => setPortata(null)}
                className={`h-10 flex-none rounded-pill px-3 text-sm font-semibold ${portata === null ? 'bg-accent text-on-accent' : 'border border-border bg-surface'}`}>Auto</button>
              {PORTATE.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={portata === p} onClick={() => setPortata(p)}
                  className={`h-10 flex-none rounded-pill px-3 text-sm font-semibold ${portata === p ? 'bg-accent text-on-accent' : 'border border-border bg-surface'}`}>{nomePortata(p).replace(' portata', '')}</button>
              ))}
            </div>
            <span className="flex-1" />
            <label className="flex h-10 w-full items-center gap-2 rounded-md border border-border-input bg-bg px-3 text-text-muted sm:w-64">
              {Icona.cerca}<span className="sr-only">Cerca articolo</span>
              <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca articolo" className="w-full bg-transparent text-base text-text outline-none placeholder:text-text-muted" />
            </label>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-3 py-2 md:hidden" role="tablist" aria-label="Categorie">
            {setup.categorie.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={c.id === categoriaId} onClick={() => { setCategoriaId(c.id); setCerca(''); }}
                style={{ background: c.colore, color: c.testoColore }} className={`h-10 flex-none rounded-sm px-3 text-sm font-bold ${c.id === categoriaId ? 'outline outline-2 outline-focus' : ''}`}>{c.nome}</button>
            ))}
          </div>

          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4 md:p-4">
            {articoli.length === 0 && <p className="col-span-full py-8 text-center text-base text-text-muted">{cerca ? `Nessun articolo per “${cerca}”.` : 'Nessun articolo in questa categoria.'}</p>}
            {articoli.map((a) => {
              const n = nelConto(a);
              return (
                <button key={a.id} type="button" aria-disabled={a.esaurito}
                  onPointerDown={() => premi(a)} onPointerUp={() => rilascia(a)} onPointerLeave={() => clearTimeout(timer.current)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!a.esaurito) aggiungi(a); } if (e.key === 'v') setVarianti(a); }}
                  onContextMenu={(e) => { e.preventDefault(); setVarianti(a); }}
                  aria-label={`${a.nome}, ${euro(a.prezzoCents)}${a.allergeni.length ? ', contiene ' + a.allergeni.map((x) => ALLERGENI_ETICHETTA[x]).join(', ') : ''}${a.esaurito ? ', esaurito' : ''}`}
                  className={`flex min-h-[88px] flex-col justify-between gap-1 rounded-md border bg-surface p-3 text-left text-[15px] font-semibold leading-5 active:scale-[.98] ${n ? 'border-accent' : 'border-border'} ${a.esaurito ? 'opacity-50' : ''}`}>
                  <span>{a.nome}</span>
                  <span className="flex items-center justify-between gap-2 text-sm font-medium text-text-muted tabular-nums">
                    <span className={a.esaurito ? 'line-through' : ''}>{euro(a.prezzoCents)}</span>
                    {a.esaurito ? <span className="font-bold text-danger">Esaurito</span>
                      : n ? <span className="rounded-pill bg-accent px-2 font-bold text-on-accent">× {n}</span>
                      : a.variantiIds.length ? <span className="text-accent" title="Ha varianti">varianti</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hidden px-4 pb-2 text-xs text-text-muted md:block">Tocco = aggiungi · tocco lungo (o tasto destro) = varianti e note · categoria: {categoria.nome}</p>
        </main>

        <div className="hidden w-[380px] flex-none border-l border-border md:block">{riepilogo}</div>
      </div>

      {/* Palmare: barra in basso + riepilogo a tutto schermo */}
      <div className="flex h-[76px] flex-none gap-2 bg-surface p-2.5 md:hidden">
        <button type="button" onClick={() => setRiepilogoMobile(true)} className="flex-1 rounded-md bg-surface-2 text-[15px] font-semibold">
          Conto<br /><span className="text-[13px] text-text-muted tabular-nums">{euro(conto.totaleCents)}</span>
        </button>
        <Pulsante variante="conferma" className="flex-[1.8]" disabled={!daInviare.length} onClick={() => invia()}>Invia{daInviare.length ? ` · ${daInviare.length}` : ''}</Pulsante>
      </div>
      {riepilogoMobile && (
        <div className="fixed inset-0 z-40 flex flex-col bg-bg md:hidden">
          <div className="flex h-14 items-center gap-2 border-b border-border px-3">
            <button type="button" onClick={() => setRiepilogoMobile(false)} aria-label="Chiudi riepilogo" className="grid h-10 w-10 place-items-center rounded-md bg-surface-2">{Icona.indietro}</button>
            <h2 className="text-lg font-bold">Riepilogo tavolo {tavolo?.numero}</h2>
          </div>
          <div className="min-h-0 flex-1">{riepilogo}</div>
        </div>
      )}

      <FoglioVarianti articolo={varianti} onChiudi={() => setVarianti(null)} onConferma={(a, extra) => { aggiungi(a, extra); setVarianti(null); }} />

      <Foglio aperto={!!storno} onChiudi={() => setStorno(null)} titolo={`Storna: ${storno?.descrizione ?? ''}`}>
        <p className="mb-3 text-base text-text-muted">La cucina riceve un ticket di STORNO. Scegli il motivo:</p>
        <div className="grid grid-cols-2 gap-2">
          {['Errore cameriere', 'Cliente ha cambiato idea', 'Piatto non riuscito', 'Omaggio della casa'].map((m) => (
            <Pulsante key={m} onClick={() => { const r = storno!; setStorno(null); conferma.chiedi(`Stornare "${r.descrizione}"? Motivo: ${m}.`, () => { db.storna(r.id, m, nuovaChiave()); toast({ testo: 'Storno inviato', tipo: 'ok' }); }); }}>{m}</Pulsante>
          ))}
        </div>
      </Foglio>

      <FoglioAllergeni aperto={allergeniAperto} valore={comanda.allergeniTavolo} onChiudi={() => setAllergeniAperto(false)}
        onSalva={(v) => { db.impostaAllergeni(comanda.id, v); setAllergeniAperto(false); }} />
      {conferma.ui}
    </div>
  );
}

function FoglioVarianti({ articolo, onChiudi, onConferma }: {
  articolo: Articolo | null; onChiudi: () => void;
  onConferma: (a: Articolo, extra: { varianti: RigaVariante[]; note?: string; posto?: number }) => void;
}) {
  const { setup } = useDati((d) => ({ setup: d.setup() }));
  const [scelte, setScelte] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [posto, setPosto] = useState<number | undefined>();
  const varianti = articolo ? setup.varianti.filter((v) => articolo.variantiIds.includes(v.id)) : [];
  const chiudi = () => { setScelte([]); setNote(''); setPosto(undefined); onChiudi(); };
  return (
    <Foglio aperto={!!articolo} onChiudi={chiudi} titolo={articolo?.nome ?? ''}>
      {varianti.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-semibold text-text-muted">Varianti</legend>
          <div className="flex flex-wrap gap-2">
            {varianti.map((v) => {
              const on = scelte.includes(v.id);
              return (
                <button key={v.id} type="button" aria-pressed={on} onClick={() => setScelte((s) => on ? s.filter((x) => x !== v.id) : [...s, v.id])}
                  className={`h-touch rounded-sm px-3 text-sm font-bold ${on ? 'bg-accent text-on-accent' : 'border border-border bg-surface'}`}>
                  {v.nome}{v.deltaCents ? ` ${euro(v.deltaCents, false)}` : ''}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-semibold text-text-muted">Posto</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <button key={p} type="button" aria-pressed={posto === p} onClick={() => setPosto(posto === p ? undefined : p)}
              className={`h-touch w-touch rounded-sm text-base font-bold ${posto === p ? 'bg-accent text-on-accent' : 'border border-border bg-surface'}`}>{p}</button>
          ))}
        </div>
      </fieldset>
      <label className="mb-4 flex flex-col gap-1 text-sm font-semibold text-text-muted">Nota per la cucina
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. niente noci, poco sale"
          className="h-touch rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text" />
      </label>
      <Pulsante variante="primario" taglia="xl" className="w-full" onClick={() => {
        if (!articolo) return;
        onConferma(articolo, { varianti: varianti.filter((v) => scelte.includes(v.id)).map((v) => ({ nome: v.nome, deltaCents: v.deltaCents })), note: note.trim() || undefined, posto });
        setScelte([]); setNote(''); setPosto(undefined);
      }}>Aggiungi</Pulsante>
    </Foglio>
  );
}

const ELENCO_ALLERGENI = Object.keys(ALLERGENI_ETICHETTA) as Allergene[];

function FoglioAllergeni({ aperto, valore, onChiudi, onSalva }: {
  aperto: boolean; valore: { allergene: Allergene; posto?: number }[]; onChiudi: () => void; onSalva: (v: { allergene: Allergene; posto?: number }[]) => void;
}) {
  const [sel, setSel] = useState<Allergene[]>([]);
  const [posto, setPosto] = useState<number | undefined>();
  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo="Allergie al tavolo">
      <p className="mb-3 text-sm text-text-muted">Escono in evidenza su ogni comanda di questo tavolo.</p>
      {valore.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {valore.map((v, i) => (
            <li key={i}><button type="button" onClick={() => onSalva(valore.filter((_, j) => j !== i))} className="h-10 rounded-sm bg-allergene px-3 text-sm font-bold text-on-allergene" aria-label={`Rimuovi ${ALLERGENI_ETICHETTA[v.allergene]}`}>
              {ALLERGENI_ETICHETTA[v.allergene]}{v.posto ? ` · posto ${v.posto}` : ''} ✕</button></li>
          ))}
        </ul>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ELENCO_ALLERGENI.map((a) => (
          <button key={a} type="button" aria-pressed={sel.includes(a)} onClick={() => setSel((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a])}
            className={`h-touch rounded-sm px-2 text-sm font-semibold ${sel.includes(a) ? 'bg-allergene text-on-allergene' : 'border border-border bg-surface'}`}>{ALLERGENI_ETICHETTA[a]}</button>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-semibold text-text-muted">Posto (facoltativo)</span>
        {[1, 2, 3, 4, 5, 6].map((p) => (
          <button key={p} type="button" aria-pressed={posto === p} onClick={() => setPosto(posto === p ? undefined : p)}
            className={`h-10 w-10 rounded-sm text-sm font-bold ${posto === p ? 'bg-accent text-on-accent' : 'border border-border bg-surface'}`}>{p}</button>
        ))}
      </div>
      <Pulsante variante="primario" className="w-full" disabled={!sel.length}
        onClick={() => { onSalva([...valore, ...sel.map((allergene) => ({ allergene, posto }))]); setSel([]); setPosto(undefined); }}>Aggiungi allergie</Pulsante>
    </Foglio>
  );
}
