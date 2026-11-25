import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Check, Pause, Prohibit, Warning } from '@phosphor-icons/react';
import {
  ALLERGENI_ETICHETTA, calcolaConto, euro, importoRiga, nomePortata,
  type Allergene, type Articolo, type RigaComanda, type RigaVariante,
} from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Icona, Pulsante, useConferma } from '../ui/primitivi';
import { vibra } from '../dati/piattaforma';

const PORTATE = [0, 1, 2, 3, 9];
const STATO_RIGA: Partial<Record<RigaComanda['stato'], { testo: string; icona: ReactElement }>> = {
  in_attesa_marcia: { testo: 'in attesa', icona: <Pause size={12} weight="fill" aria-hidden /> },
  in_preparazione: { testo: 'in preparazione', icona: <Pause size={12} weight="fill" aria-hidden /> },
  pronta: { testo: 'pronta', icona: <Check size={12} weight="bold" aria-hidden /> },
  servita: { testo: 'servita', icona: <Check size={12} weight="bold" aria-hidden /> },
  stornata: { testo: 'stornata', icona: <Prohibit size={12} weight="bold" aria-hidden /> },
};

// S06 + S07 + S10: presa comanda, varianti, invio per portata.
export function ComandaSchermata() {
  const { id = '' } = useParams();
  const { db, toast, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const nav = useNavigate();
  const { comanda, righe, setup } = useDati((d) => ({ comanda: d.comanda(id), righe: d.righe(id), setup: d.setup() }));
  const [categoriaId, setCategoriaId] = useState(setup.categorie[0]?.id);
  const [portata, setPortata] = useState<number | null>(null);
  const [cerca, setCerca] = useState('');
  const [varianti, setVarianti] = useState<Articolo | null>(null);
  const [storno, setStorno] = useState<RigaComanda | null>(null);
  const [allergeniAperto, setAllergeniAperto] = useState(false);
  const [riepilogoMobile, setRiepilogoMobile] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);
  const conferma = useConferma();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lungo = useRef(false);

  const tavolo = setup.tavoli.find((t) => t.id === comanda?.tavoloId);
  const conto = useMemo(() => calcolaConto(righe, comanda?.coperti ?? 0, setup.locale.copertoCents), [righe, comanda, setup]);

  if (!comanda) return <main className="p-8 text-text"><p className="mb-4 text-base">Questa comanda non esiste più.</p><Link className="underline" to="/sala">Torna alla sala</Link></main>;
  if (comanda.stato === 'chiusa') { nav('/sala', { replace: true }); return null; }

  const q = cerca.trim().toLowerCase();
  const articoli = setup.articoli.filter((a) => (q ? a.nome.toLowerCase().includes(q) : a.categoriaId === categoriaId));
  const portataEffettiva = (a: Articolo) => portata ?? setup.categorie.find((c) => c.id === a.categoriaId)!.portataPredefinita;
  const daInviare = righe.filter((r) => r.stato === 'da_inviare');
  const nelConto = (a: Articolo) => righe.filter((r) => r.articoloId === a.id && r.stato !== 'stornata').reduce((s, r) => s + r.quantita, 0);

  const aggiungi = (a: Articolo, extra: { varianti?: RigaVariante[]; note?: string; posto?: number } = {}) => {
    void esegui(async () => { const r = await db.aggiungiRiga(comanda.id, { articoloId: a.id, portata: portataEffettiva(a), ...extra }); setUltima(r.id); });
  };

  const invia = () => {
    void esegui(async () => {
      const jobs = await db.invia(comanda.id, nuovaChiave(), operatore ?? undefined);
      const dove = [...new Set(jobs.map((j) => setup.stampanti.find((s) => s.id === j.stampanteId)?.nome))].filter(Boolean).join(' e ');
      toast({ testo: `Inviata a ${dove || 'produzione'}`, tipo: 'ok' });
      setRiepilogoMobile(false);
      void vibra();
    });
  };

  const premi = (a: Articolo) => { lungo.current = false; timer.current = setTimeout(() => { lungo.current = true; setVarianti(a); }, 420); };
  const rilascia = (a: Articolo) => { clearTimeout(timer.current); if (!lungo.current && !a.esaurito) aggiungi(a); };

  const riepilogo = (
    <aside aria-label="Comanda" className="flex h-full flex-col bg-surface">
      {comanda.allergeniTavolo.length > 0 && (
        <div className="flex items-center gap-2 bg-allergene px-4 py-2.5 text-sm font-bold text-on-allergene">
          <Warning size={18} weight="fill" aria-hidden />
          <span>Allergia: {comanda.allergeniTavolo.map((a) => `${ALLERGENI_ETICHETTA[a.allergene]}${a.posto ? ` (posto ${a.posto})` : ''}`).join(', ')}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {righe.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-base font-semibold">Il conto è vuoto</p>
            <p className="mt-1 text-sm text-text-muted">Scegli una categoria e tocca un piatto. Tocco lungo per varianti e note.</p>
          </div>
        )}
        {conto.perPortata.map(({ portata: p, righe: rr }) => {
          const nuove = rr.some((r) => r.stato === 'da_inviare');
          return (
            <section key={p} className="mb-3">
              <h3 className="sticky top-0 z-[1] mb-1 flex justify-between bg-surface px-2 py-1 text-xs font-bold uppercase tracking-wide">
                <span className={nuove ? 'text-accent' : 'text-text-muted'}>{nomePortata(p)}</span>
                <span className={nuove ? 'text-accent' : 'text-text-muted'}>{nuove ? 'Da inviare' : 'Inviata'}</span>
              </h3>
              <ul className="flex flex-col gap-0.5">
                {rr.map((r) => {
                  const st = STATO_RIGA[r.stato];
                  const daInv = r.stato === 'da_inviare';
                  return (
                    <li key={r.id}>
                      <button type="button"
                        onClick={() => daInv ? void esegui(() => db.togliRiga(r.id)) : r.stato !== 'stornata' && setStorno(r)}
                        aria-label={`${r.quantita} ${r.descrizione}, ${euro(importoRiga(r))}. ${daInv ? 'Tocca per togliere' : 'Tocca per stornare'}`}
                        className={`premibile w-full rounded-md px-2 py-1.5 text-left text-[15px] tabular-nums ${daInv ? 'bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)]' : 'text-text-muted'} ${r.id === ultima ? 'riga-nuova' : ''}`}>
                        <span className={`flex justify-between gap-2 ${r.stato === 'stornata' ? 'line-through' : ''}`}>
                          <span className={daInv ? 'font-semibold text-text' : ''}>{r.quantita} × {r.descrizione}</span>
                          <span>{euro(importoRiga(r), false)}</span>
                        </span>
                        {r.varianti.map((v) => <span key={v.nome} className="block pl-5 text-[13px] text-text-muted">{v.nome}{v.deltaCents ? ` ${euro(v.deltaCents, false)}` : ''}</span>)}
                        {r.posto && <span className="block pl-5 text-[13px] text-text-muted">posto {r.posto}</span>}
                        {r.note && <span className="block pl-5 text-[13px] italic text-text-muted">{r.note}</span>}
                        {st && <span className={`flex items-center gap-1 pl-5 text-[12px] font-semibold ${r.stato === 'pronta' ? 'text-success' : r.stato === 'stornata' ? 'text-danger' : 'text-text-muted'}`}>{st.icona}{st.testo}{r.motivoStorno ? `: ${r.motivoStorno}` : ''}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {comanda.coperti > 0 && setup.locale.copertoCents > 0 && righe.length > 0 && (
          <div className="flex justify-between px-2 text-[15px] text-text-muted tabular-nums"><span>{comanda.coperti} × Coperto</span><span>{euro(conto.copertoCents, false)}</span></div>
        )}
      </div>
      <div className="flex items-baseline justify-between border-t border-border px-4 py-3">
        <span className="font-semibold text-text-muted">Totale</span>
        <span className="text-[28px] font-bold tracking-tight tabular-nums">{euro(conto.totaleCents)}</span>
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <Pulsante className="flex-1" disabled={righe.length === 0}
          onClick={() => void esegui(() => db.preconto(comanda.id, nuovaChiave()), 'Preconto in stampa')}>Preconto</Pulsante>
        <Pulsante className="flex-1" disabled={righe.length === 0 || daInviare.length > 0} onClick={() => nav(`/conto/${comanda.id}`)}
          title={daInviare.length ? 'Invia prima le righe in attesa' : undefined}>Conto</Pulsante>
        <Pulsante variante="conferma" className="flex-[1.6]" icona={Icona.stampa} caricamento={inCorso && daInviare.length > 0}
          disabled={daInviare.length === 0} onClick={invia}>
          Invia{daInviare.length ? ` (${daInviare.length})` : ''}
        </Pulsante>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata indietro="/sala" titolo={`Tavolo ${tavolo?.numero ?? ''}`} sotto={`${comanda.coperti} coperti · ${comanda.operatore || operatore?.nome || ''}`}>
        <button type="button" onClick={() => setAllergeniAperto(true)}
          className={`premibile flex h-10 flex-none items-center gap-1.5 rounded-md px-3 text-sm font-bold ${comanda.allergeniTavolo.length ? 'bg-allergene text-on-allergene' : 'border border-border bg-surface-2'}`}>
          {comanda.allergeniTavolo.length > 0 && <Warning size={16} weight="fill" aria-hidden />}
          Allergie{comanda.allergeniTavolo.length ? ` (${comanda.allergeniTavolo.length})` : ''}
        </button>
      </Testata>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Categorie" className="hidden w-44 flex-none flex-col gap-1.5 overflow-y-auto border-r border-border p-2.5 md:flex">
          {setup.categorie.map((c) => {
            const attiva = c.id === categoriaId && !q;
            return (
              <button key={c.id} type="button" onClick={() => { setCategoriaId(c.id); setCerca(''); }} aria-pressed={attiva}
                style={attiva ? { background: c.colore, color: c.testoColore } : undefined}
                className={`premibile relative flex h-14 flex-none items-center overflow-hidden rounded-md pl-5 pr-3 text-left text-[15px] font-bold ${attiva ? '' : 'bg-surface text-text'}`}>
                <i aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.colore }} />
                {c.nome}
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 md:px-4">
            <div role="radiogroup" aria-label="Portata" className="flex gap-1 overflow-x-auto rounded-pill bg-surface p-1">
              <button type="button" role="radio" aria-checked={portata === null} onClick={() => setPortata(null)}
                className={`premibile h-9 flex-none rounded-pill px-3.5 text-sm font-semibold ${portata === null ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>Auto</button>
              {PORTATE.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={portata === p} onClick={() => setPortata(p)}
                  className={`premibile h-9 flex-none rounded-pill px-3.5 text-sm font-semibold ${portata === p ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{nomePortata(p).replace(' portata', '')}</button>
              ))}
            </div>
            <span className="flex-1" />
            <label className="flex h-10 w-full items-center gap-2 rounded-md border border-border-input bg-bg px-3 text-text-muted focus-within:border-focus sm:w-64">
              {Icona.cerca}<span className="sr-only">Cerca piatto</span>
              <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca piatto" className="w-full bg-transparent text-base text-text outline-none placeholder:text-text-muted" />
            </label>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-3 py-2 md:hidden" role="tablist" aria-label="Categorie">
            {setup.categorie.map((c) => {
              const attiva = c.id === categoriaId && !q;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={attiva} onClick={() => { setCategoriaId(c.id); setCerca(''); }}
                  style={attiva ? { background: c.colore, color: c.testoColore, borderColor: c.colore } : { borderColor: c.colore }}
                  className={`premibile h-10 flex-none rounded-pill border-2 px-3.5 text-sm font-bold ${attiva ? '' : 'bg-surface text-text'}`}>{c.nome}</button>
              );
            })}
          </div>

          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4 md:p-4">
            {articoli.length === 0 && <p className="col-span-full py-12 text-center text-base text-text-muted">{q ? `Nessun piatto per “${cerca}”.` : 'Nessun piatto in questa categoria.'}</p>}
            {articoli.map((a) => {
              const n = nelConto(a);
              return (
                <button key={a.id} type="button" aria-disabled={a.esaurito}
                  onPointerDown={() => premi(a)} onPointerUp={() => rilascia(a)} onPointerLeave={() => clearTimeout(timer.current)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!a.esaurito) aggiungi(a); } if (e.key === 'v') setVarianti(a); }}
                  onContextMenu={(e) => { e.preventDefault(); setVarianti(a); }}
                  aria-label={`${a.nome}, ${euro(a.prezzoCents)}${a.allergeni.length ? ', contiene ' + a.allergeni.map((x) => ALLERGENI_ETICHETTA[x]).join(', ') : ''}${a.esaurito ? ', esaurito' : ''}${n ? `, ${n} nel conto` : ''}`}
                  className={`premibile relative flex min-h-[92px] flex-col justify-between gap-2 rounded-md border bg-surface p-3 text-left ${n ? 'border-accent' : 'border-border'} ${a.esaurito ? 'opacity-45' : ''}`}>
                  <span className="pr-8 text-[15px] font-semibold leading-5">{a.nome}</span>
                  {n > 0 && <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-pill bg-accent px-1.5 text-xs font-bold text-on-accent">{n}</span>}
                  <span className="flex items-center justify-between gap-2 text-sm tabular-nums">
                    <span className={`font-medium text-text-muted ${a.esaurito ? 'line-through' : ''}`}>{euro(a.prezzoCents)}</span>
                    {a.esaurito ? <span className="font-bold text-danger">Esaurito</span>
                      : a.variantiIds.length ? <span className="text-xs font-semibold text-accent">varianti</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hidden px-4 pb-2 text-xs text-text-muted md:block">Tocco: aggiungi. Tocco lungo o tasto destro: varianti, posto e note.</p>
        </main>

        <div className="hidden w-[380px] flex-none border-l border-border md:block">{riepilogo}</div>
      </div>

      <div className="flex h-[76px] flex-none gap-2 border-t border-border bg-surface p-2.5 md:hidden">
        <button type="button" onClick={() => setRiepilogoMobile(true)} className="premibile flex-1 rounded-md bg-surface-2 text-[15px] font-semibold">
          Conto<span className="block text-[13px] text-text-muted tabular-nums">{euro(conto.totaleCents)}</span>
        </button>
        <Pulsante variante="conferma" className="flex-[1.8]" disabled={!daInviare.length} caricamento={inCorso && daInviare.length > 0} onClick={invia}>Invia{daInviare.length ? ` (${daInviare.length})` : ''}</Pulsante>
      </div>
      {riepilogoMobile && (
        <div className="fixed inset-0 z-40 flex flex-col bg-bg md:hidden">
          <div className="flex h-14 items-center gap-2 border-b border-border px-3">
            <button type="button" onClick={() => setRiepilogoMobile(false)} aria-label="Chiudi riepilogo" className="premibile grid h-10 w-10 place-items-center rounded-md bg-surface-2">{Icona.indietro}</button>
            <h2 className="text-lg font-bold">Tavolo {tavolo?.numero}</h2>
          </div>
          <div className="min-h-0 flex-1">{riepilogo}</div>
        </div>
      )}

      <FoglioVarianti articolo={varianti} onChiudi={() => setVarianti(null)} onConferma={(a, extra) => { aggiungi(a, extra); setVarianti(null); }} />

      <Foglio aperto={!!storno} onChiudi={() => setStorno(null)} titolo={`Storna ${storno?.descrizione ?? ''}`}>
        <p className="mb-4 text-base text-text-muted">La cucina riceve un ticket di storno. Perché?</p>
        <div className="grid grid-cols-2 gap-2">
          {['Errore del cameriere', 'Il cliente ha cambiato idea', 'Piatto non riuscito', 'Offerto dalla casa'].map((m) => (
            <Pulsante key={m} className="h-auto min-h-touch-comodo whitespace-normal py-2" onClick={() => {
              const r = storno!; setStorno(null);
              conferma.chiedi(`“${r.descrizione}” viene tolto dal conto e la cucina riceve lo storno. Motivo: ${m.toLowerCase()}.`,
                () => void esegui(() => db.storna(r.id, m, nuovaChiave(), operatore ?? undefined), 'Storno inviato'), 'Storna');
            }}>{m}</Pulsante>
          ))}
        </div>
      </Foglio>

      <FoglioAllergeni aperto={allergeniAperto} valore={comanda.allergeniTavolo} onChiudi={() => setAllergeniAperto(false)}
        onSalva={(v) => void esegui(() => db.impostaAllergeni(comanda.id, v))} />
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
  const reset = () => { setScelte([]); setNote(''); setPosto(undefined); };
  const extra = varianti.filter((v) => scelte.includes(v.id)).reduce((s, v) => s + v.deltaCents, 0);
  return (
    <Foglio aperto={!!articolo} onChiudi={() => { reset(); onChiudi(); }} titolo={articolo?.nome ?? ''}>
      {varianti.length > 0 && (
        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-text-muted">Varianti</legend>
          <div className="flex flex-wrap gap-2">
            {varianti.map((v) => {
              const on = scelte.includes(v.id);
              return (
                <button key={v.id} type="button" aria-pressed={on} onClick={() => setScelte((s) => on ? s.filter((x) => x !== v.id) : [...s, v.id])}
                  className={`premibile h-touch rounded-pill px-4 text-sm font-bold ${on ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>
                  {v.nome}{v.deltaCents ? ` ${euro(v.deltaCents, false)}` : ''}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-semibold text-text-muted">Per chi (posto)</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <button key={p} type="button" aria-pressed={posto === p} onClick={() => setPosto(posto === p ? undefined : p)}
              className={`premibile h-touch w-touch rounded-pill text-base font-bold ${posto === p ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{p}</button>
          ))}
        </div>
      </fieldset>
      <label className="mb-5 flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Nota per la cucina
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. niente noci, poco sale"
          className="h-touch rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text outline-none placeholder:text-text-muted focus:border-focus" />
      </label>
      <Pulsante variante="primario" taglia="xl" className="w-full" onClick={() => {
        if (!articolo) return;
        onConferma(articolo, { varianti: varianti.filter((v) => scelte.includes(v.id)).map((v) => ({ nome: v.nome, deltaCents: v.deltaCents })), note: note.trim() || undefined, posto });
        reset();
      }}>Aggiungi{articolo ? ` · ${euro(articolo.prezzoCents + extra)}` : ''}</Pulsante>
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
      <p className="mb-4 text-sm text-text-muted">Escono in evidenza su ogni comanda di questo tavolo, in cucina e al bar.</p>
      {valore.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Allergie registrate">
          {valore.map((v, i) => (
            <li key={i}><button type="button" onClick={() => onSalva(valore.filter((_, j) => j !== i))}
              className="premibile flex h-10 items-center gap-1.5 rounded-pill bg-allergene px-3.5 text-sm font-bold text-on-allergene" aria-label={`Rimuovi ${ALLERGENI_ETICHETTA[v.allergene]}`}>
              {ALLERGENI_ETICHETTA[v.allergene]}{v.posto ? ` · posto ${v.posto}` : ''}{Icona.chiudi}</button></li>
          ))}
        </ul>
      )}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ELENCO_ALLERGENI.map((a) => (
          <button key={a} type="button" aria-pressed={sel.includes(a)} onClick={() => setSel((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a])}
            className={`premibile h-touch rounded-md px-2 text-sm font-semibold ${sel.includes(a) ? 'bg-allergene text-on-allergene' : 'border border-border bg-bg'}`}>{ALLERGENI_ETICHETTA[a]}</button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-text-muted">Posto (facoltativo)</span>
        {[1, 2, 3, 4, 5, 6].map((p) => (
          <button key={p} type="button" aria-pressed={posto === p} onClick={() => setPosto(posto === p ? undefined : p)}
            className={`premibile h-10 w-10 rounded-pill text-sm font-bold ${posto === p ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{p}</button>
        ))}
      </div>
      <Pulsante variante="primario" className="w-full" disabled={!sel.length}
        onClick={() => { onSalva([...valore, ...sel.map((allergene) => ({ allergene, posto }))]); setSel([]); setPosto(undefined); onChiudi(); }}>Aggiungi allergie</Pulsante>
    </Foglio>
  );
}
