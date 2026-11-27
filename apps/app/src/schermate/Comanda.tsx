import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowsLeftRight, BellRinging, ChatCircleText, Check, Lightning, Minus, Pause, PencilSimpleLine, Plus, Prohibit, Star, UserCircle, Warning } from '@phosphor-icons/react';
import {
  ALLERGENI_ETICHETTA, calcolaConto, euro, importoRiga, nomeCliente, nomePortata,
  type Allergene, type Articolo, type Cliente, type RigaComanda, type RigaVariante, type VoceLibera,
} from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Icona, Pulsante, useConferma } from '../ui/primitivi';
import { vibra } from '../dati/piattaforma';
import { AzioniTavolo } from './AzioniTavolo';
import { puoGestire } from '../dati/ruoli';
import { TastierinoPin, verificaResponsabile } from '../ui/PinResponsabile';
import { Gift } from '@phosphor-icons/react';
import { FoglioVoceLibera } from './VoceLibera';
import { FoglioMessaggio } from './Messaggi';
import { FoglioClienteTavolo } from './Clienti';

const PORTATE = [0, 1, 2, 3, 9];
const RAPIDI = '__rapidi';
const MOLTIPLICATORI = [2, 3, 4, 5, 6];

// Piatti più usati su questo dispositivo: la prima scheda, per i tocchi di tutte le sere.
const CHIAVE_USO = 'cassa.usoArticoli';
const leggiUso = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(CHIAVE_USO) ?? '{}'); } catch { return {}; } };
const contaUso = (id: string) => { try { const u = leggiUso(); u[id] = (u[id] ?? 0) + 1; localStorage.setItem(CHIAVE_USO, JSON.stringify(u)); } catch { /* niente */ } };
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
  const [uso] = useState(leggiUso);
  const rapidi = useMemo(() => Object.entries(uso).sort((a, b) => b[1] - a[1]).map(([id]) => setup.articoli.find((a) => a.id === id)).filter((a): a is Articolo => !!a).slice(0, 16), [uso, setup.articoli]);
  const [categoriaId, setCategoriaId] = useState(rapidi.length >= 4 ? RAPIDI : setup.categorie[0]?.id);
  const [molt, setMolt] = useState(1);
  const [liberaAperta, setLiberaAperta] = useState(false);
  const [messaggioAperto, setMessaggioAperto] = useState(false);
  const [clienteAperto, setClienteAperto] = useState(false);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [portata, setPortata] = useState<number | null>(null);
  const [cerca, setCerca] = useState('');
  const [varianti, setVarianti] = useState<Articolo | null>(null);
  const [storno, setStorno] = useState<RigaComanda | null>(null);
  const [allergeniAperto, setAllergeniAperto] = useState(false);
  const [azioniAperte, setAzioniAperte] = useState(false);
  const [riepilogoMobile, setRiepilogoMobile] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);
  const conferma = useConferma();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lungo = useRef(false);

  const tavolo = setup.tavoli.find((t) => t.id === comanda?.tavoloId);
  useEffect(() => {
    if (!comanda?.clienteId) { setCliente(null); return; }
    let v = true; db.cliente(comanda.clienteId).then((c) => v && setCliente(c)).catch(() => undefined); return () => { v = false; };
  }, [comanda?.clienteId, db]);
  const conto = useMemo(() => calcolaConto(righe, comanda?.coperti ?? 0, setup.locale.copertoCents), [righe, comanda, setup]);

  if (!comanda) return <main className="p-8 text-text"><p className="mb-4 text-base">Questa comanda non esiste più.</p><Link className="underline" to="/sala">Torna alla sala</Link></main>;
  if (comanda.stato === 'chiusa' || comanda.stato === 'annullata') { nav('/sala', { replace: true }); return null; }

  const q = cerca.trim().toLowerCase();
  const articoli = q ? setup.articoli.filter((a) => a.nome.toLowerCase().includes(q))
    : categoriaId === RAPIDI ? rapidi.map((a) => setup.articoli.find((x) => x.id === a.id) ?? a)
    : setup.articoli.filter((a) => a.categoriaId === categoriaId);
  const categorieNav = [...(rapidi.length ? [{ id: RAPIDI, nome: 'Più usati', colore: 'var(--c-accent)', testoColore: 'var(--c-on-accent)' }] : []), ...setup.categorie];
  const portataEffettiva = (a: Articolo) => portata ?? setup.categorie.find((c) => c.id === a.categoriaId)!.portataPredefinita;
  const daInviare = righe.filter((r) => r.stato === 'da_inviare');
  const nelConto = (a: Articolo) => righe.filter((r) => r.articoloId === a.id && r.stato !== 'stornata').reduce((s, r) => s + r.quantita, 0);

  const aggiungi = (a: Articolo, extra: { varianti?: RigaVariante[]; note?: string; posto?: number } = {}) => {
    const quantita = molt; setMolt(1); contaUso(a.id);
    void esegui(async () => { const r = await db.aggiungiRiga(comanda.id, { articoloId: a.id, portata: portataEffettiva(a), quantita, ...extra }); setUltima(r.id); });
  };
  const aggiungiLibera = (v: VoceLibera, extra: { portata: number; quantita: number; note?: string }) => {
    setLiberaAperta(false);
    void esegui(async () => { const r = await db.aggiungiRiga(comanda.id, { libera: v, ...extra }); setUltima(r.id); }, `${v.descrizione} aggiunto`);
  };
  const sollecita = (tipo: 'marcia' | 'sollecito', p: number) => void esegui(
    () => db.inviaMessaggio({ centriIds: setup.centri.map((c) => c.id), tipo, portata: p, comandaId: comanda.id }, nuovaChiave(), operatore ?? undefined),
    `${tipo === 'marcia' ? 'Marcia' : 'Sollecito'} ${nomePortata(p).toLowerCase()} inviato`);

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
            <p className="mt-1 text-sm text-text-muted">Tocca un piatto per aggiungerlo, tienilo premuto per varianti e note. Fuori menu? “Voce libera”.</p>
          </div>
        )}
        {conto.perPortata.map(({ portata: p, righe: rr }) => {
          const nuove = rr.some((r) => r.stato === 'da_inviare');
          const inCucina = rr.some((r) => ['inviata', 'in_preparazione'].includes(r.stato));
          return (
            <section key={p} className="mb-3">
              <h3 className="sticky top-0 z-[1] mb-1 flex min-h-8 items-center gap-1.5 bg-surface px-2 py-1 text-xs font-bold uppercase tracking-wide">
                <span className={`flex-1 ${nuove ? 'text-accent' : 'text-text-muted'}`}>{nomePortata(p)}</span>
                {inCucina && !nuove && (<>
                  <button type="button" onClick={() => sollecita('marcia', p)} aria-label={`Marcia ${nomePortata(p)}`}
                    className="premibile flex h-8 items-center gap-1 rounded-pill bg-accent px-3 text-[12px] font-bold normal-case tracking-normal text-on-accent">
                    <Lightning size={13} weight="fill" aria-hidden />Marcia</button>
                  <button type="button" onClick={() => sollecita('sollecito', p)} aria-label={`Sollecita ${nomePortata(p)}`}
                    className="premibile flex h-8 items-center gap-1 rounded-pill border border-border px-3 text-[12px] font-bold normal-case tracking-normal text-text">
                    <BellRinging size={13} weight="bold" aria-hidden />Sollecita</button>
                </>)}
                {(nuove || !inCucina) && <span className={nuove ? 'text-accent' : 'text-text-muted'}>{nuove ? 'Da inviare' : rr.every((r) => r.stato === 'pronta' || r.stato === 'stornata') ? 'Pronta' : 'Inviata'}</span>}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {rr.map((r) => {
                  const st = STATO_RIGA[r.stato];
                  const daInv = r.stato === 'da_inviare';
                  return (
                    <li key={r.id} className={daInv ? 'flex items-start gap-1' : ''}>
                      {daInv && (
                        <span className="flex flex-none items-center gap-0.5 pt-0.5" role="group" aria-label={`Quantità di ${r.descrizione}`}>
                          <button type="button" aria-label={r.quantita > 1 ? `Uno in meno: ${r.descrizione}` : `Togli ${r.descrizione}`}
                            onClick={() => void esegui(() => db.cambiaQuantita(r.id, r.quantita - 1))}
                            className="premibile grid h-9 w-9 place-items-center rounded-md bg-surface-2 text-text">{r.quantita > 1 ? <Minus size={16} weight="bold" aria-hidden /> : <Prohibit size={16} weight="bold" aria-hidden />}</button>
                          <button type="button" aria-label={`Uno in più: ${r.descrizione}`}
                            onClick={() => void esegui(() => db.cambiaQuantita(r.id, r.quantita + 1))}
                            className="premibile grid h-9 w-9 place-items-center rounded-md bg-surface-2 text-text"><Plus size={16} weight="bold" aria-hidden /></button>
                        </span>
                      )}
                      <button type="button" disabled={daInv}
                        onClick={() => r.stato !== 'stornata' && setStorno(r)}
                        aria-label={`${r.quantita} ${r.descrizione}, ${euro(importoRiga(r))}${daInv ? ', da inviare' : '. Tocca per stornare'}`}
                        className={`premibile min-w-0 flex-1 w-full rounded-md disabled:cursor-default px-2 py-1.5 text-left text-[15px] tabular-nums ${daInv ? 'bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)]' : 'text-text-muted'} ${r.id === ultima ? 'riga-nuova' : ''}`}>
                        <span className={`flex justify-between gap-2 ${r.stato === 'stornata' ? 'line-through' : ''}`}>
                          <span className={daInv ? 'font-semibold text-text' : ''}>{r.quantita} × {r.descrizione}{r.articoloId === null && <PencilSimpleLine size={13} weight="bold" aria-label="voce libera" className="ml-1 inline align-[-1px] text-text-muted" />}</span>
                          <span>{euro(importoRiga(r), false)}</span>
                        </span>
                        {r.varianti.map((v) => <span key={v.nome} className="block pl-5 text-[13px] text-text-muted">{v.nome}{v.deltaCents ? ` ${euro(v.deltaCents, false)}` : ''}</span>)}
                        {r.posto && <span className="block pl-5 text-[13px] text-text-muted">posto {r.posto}</span>}
                        {r.note && <span className="block pl-5 text-[13px] italic text-text-muted">{r.note}</span>}
                        {r.omaggio && <span className="flex items-center gap-1 pl-5 text-[12px] font-semibold text-success"><Gift size={12} weight="fill" aria-hidden />offerto dalla casa</span>}
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
        <button type="button" onClick={() => setClienteAperto(true)} aria-label={cliente ? `Cliente: ${nomeCliente(cliente)}` : 'Collega un cliente'}
          className={`premibile flex h-10 max-w-[12rem] flex-none items-center gap-1.5 rounded-md px-3 text-sm font-bold ${cliente ? 'bg-surface-2 text-accent ring-1 ring-accent' : 'border border-border bg-surface-2'}`}>
          <UserCircle size={18} weight={cliente ? 'fill' : 'bold'} aria-hidden /><span className="hidden truncate xl:inline">{cliente ? nomeCliente(cliente) : 'Cliente'}</span>
        </button>
        <button type="button" onClick={() => setMessaggioAperto(true)} aria-label="Messaggio ai reparti"
          className="premibile flex h-10 flex-none items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-sm font-bold">
          <ChatCircleText size={18} weight="bold" aria-hidden /><span className="hidden xl:inline">Messaggio</span>
        </button>
        <button type="button" onClick={() => setAzioniAperte(true)} aria-label="Sposta, unisci o dividi il tavolo"
          className="premibile flex h-10 flex-none items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-sm font-bold">
          <ArrowsLeftRight size={16} weight="bold" aria-hidden /><span className="hidden xl:inline">Tavolo</span>
        </button>
        <button type="button" onClick={() => setAllergeniAperto(true)}
          className={`premibile flex h-10 flex-none items-center gap-1.5 rounded-md px-3 text-sm font-bold ${comanda.allergeniTavolo.length ? 'bg-allergene text-on-allergene' : 'border border-border bg-surface-2'}`}>
          <Warning size={16} weight={comanda.allergeniTavolo.length ? 'fill' : 'bold'} aria-hidden />
          <span className={comanda.allergeniTavolo.length ? '' : 'hidden md:inline'}>Allergie{comanda.allergeniTavolo.length ? ` (${comanda.allergeniTavolo.length})` : ''}</span>
        </button>
      </Testata>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Categorie" className="hidden w-44 flex-none flex-col gap-1.5 overflow-y-auto border-r border-border p-2.5 md:flex">
          {categorieNav.map((c) => {
            const attiva = c.id === categoriaId && !q;
            return (
              <button key={c.id} type="button" onClick={() => { setCategoriaId(c.id); setCerca(''); }} aria-pressed={attiva}
                style={attiva ? { background: c.colore, color: c.testoColore } : undefined}
                className={`premibile relative flex h-14 flex-none items-center overflow-hidden rounded-md pl-5 pr-3 text-left text-[15px] font-bold ${attiva ? '' : 'bg-surface text-text'}`}>
                <i aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.colore }} />
                {c.id === RAPIDI && <Star size={15} weight="fill" aria-hidden className="mr-1.5 flex-none" />}{c.nome}
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 md:px-4">
            <div className="-mx-3 flex min-w-0 max-w-full gap-2 overflow-x-auto px-3 md:mx-0 md:px-0">
            <div role="radiogroup" aria-label="Portata" className="flex flex-none gap-1 rounded-pill bg-surface p-1">
              <button type="button" role="radio" aria-checked={portata === null} onClick={() => setPortata(null)}
                className={`premibile h-9 flex-none rounded-pill px-3.5 text-sm font-semibold ${portata === null ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>Auto</button>
              {PORTATE.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={portata === p} onClick={() => setPortata(p)}
                  className={`premibile h-9 flex-none rounded-pill px-3.5 text-sm font-semibold ${portata === p ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{nomePortata(p).replace(' portata', '')}</button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Quantità per il prossimo piatto" className="flex flex-none gap-1 rounded-pill bg-surface p-1">
              {MOLTIPLICATORI.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={molt === m} onClick={() => setMolt(molt === m ? 1 : m)}
                  className={`premibile h-9 min-w-9 flex-none rounded-pill px-2.5 text-sm font-bold tabular-nums ${molt === m ? 'bg-warning text-on-warning' : 'text-text-muted'}`}>×{m}</button>
              ))}
            </div>
            </div>
            <span className="flex-1" />
            <label className="flex h-10 w-full items-center gap-2 rounded-md border border-border-input bg-bg px-3 text-text-muted focus-within:border-focus sm:w-64">
              {Icona.cerca}<span className="sr-only">Cerca piatto</span>
              <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca piatto" className="w-full bg-transparent text-base text-text outline-none placeholder:text-text-muted" />
            </label>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-3 py-2 md:hidden" role="tablist" aria-label="Categorie">
            {categorieNav.map((c) => {
              const attiva = c.id === categoriaId && !q;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={attiva} onClick={() => { setCategoriaId(c.id); setCerca(''); }}
                  style={attiva ? { background: c.colore, color: c.testoColore, borderColor: c.colore } : { borderColor: c.colore }}
                  className={`premibile h-10 flex-none rounded-pill border-2 px-3.5 text-sm font-bold ${attiva ? '' : 'bg-surface text-text'}`}>{c.nome}</button>
              );
            })}
          </div>

          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4 md:p-4">
            <button type="button" onClick={() => setLiberaAperta(true)} aria-label="Voce libera: un piatto fuori menu, con prezzo a scelta"
              className="premibile flex min-h-[92px] flex-col justify-between gap-2 rounded-md border-2 border-dashed border-border p-3 text-left text-text-muted hover:border-accent hover:text-text">
              <span className="flex items-center gap-1.5 text-[15px] font-bold"><PencilSimpleLine size={18} weight="bold" aria-hidden />Voce libera</span>
              <span className="text-sm">{q ? `“${cerca}” fuori menu` : 'Fuori menu, prezzo a scelta'}</span>
            </button>
            {articoli.length === 0 && <p className="col-span-full py-12 text-center text-base text-text-muted">{q ? `Nessun piatto per “${cerca}”.` : categoriaId === RAPIDI ? 'I piatti che usi di più compariranno qui.' : 'Nessun piatto in questa categoria.'}</p>}
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
          <p className="hidden px-4 pb-2 text-xs text-text-muted md:block">{molt > 1 ? `Il prossimo piatto entra ×${molt}.` : 'Tocco: aggiungi. Tocco lungo o tasto destro: varianti, posto e note. ×2…×6: quantità del prossimo piatto.'}</p>
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

      <FoglioRigaInviata riga={storno} onChiudi={() => setStorno(null)} conferma={conferma.chiedi} />

      <AzioniTavolo comanda={comanda} aperto={azioniAperte} onChiudi={() => setAzioniAperte(false)} />
      <FoglioVoceLibera aperto={liberaAperta} portataIniziale={portata} descrizioneIniziale={cerca.trim()} onChiudi={() => setLiberaAperta(false)} onAggiungi={aggiungiLibera} />
      <FoglioMessaggio aperto={messaggioAperto} comanda={comanda} onChiudi={() => setMessaggioAperto(false)} />
      <FoglioClienteTavolo aperto={clienteAperto} comanda={comanda} onChiudi={() => setClienteAperto(false)} />
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
  const { db } = useApp();
  const { esegui } = useAzione();
  const [scelte, setScelte] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [posto, setPosto] = useState<number | undefined>();
  const varianti = articolo ? setup.varianti.filter((v) => articolo.variantiIds.includes(v.id)) : [];
  const reset = () => { setScelte([]); setNote(''); setPosto(undefined); };
  const extra = varianti.filter((v) => scelte.includes(v.id)).reduce((s, v) => s + v.deltaCents, 0);
  return (
    <Foglio aperto={!!articolo} onChiudi={() => { reset(); onChiudi(); }} titolo={articolo?.nome ?? ''}>
      {articolo && (articolo.descrizione || articolo.allergeni.length > 0) && (
        <div className="mb-5 rounded-md bg-bg p-3">
          {articolo.descrizione && <p className="text-[15px] text-text">{articolo.descrizione}</p>}
          {articolo.allergeni.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {articolo.allergeni.map((a) => <span key={a} className="rounded-pill bg-allergene px-2.5 py-0.5 text-xs font-bold text-on-allergene">{ALLERGENI_ETICHETTA[a]}</span>)}
            </p>
          )}
        </div>
      )}
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
      }} disabled={articolo?.esaurito}>Aggiungi{articolo ? ` · ${euro(articolo.prezzoCents + extra)}` : ''}</Pulsante>
      {articolo && (
        <button type="button" onClick={() => void esegui(async () => { await db.impostaEsaurito(articolo.id, !articolo.esaurito); reset(); onChiudi(); },
          articolo.esaurito ? `${articolo.nome} di nuovo disponibile` : `${articolo.nome} segnato come finito su tutti i dispositivi`)}
          className="premibile mt-3 h-touch w-full rounded-md text-sm font-semibold text-text-muted hover:bg-surface-2">
          {articolo.esaurito ? 'È tornato disponibile' : 'Segna come finito (esaurito)'}
        </button>
      )}
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

const MOTIVI_STORNO = ['Errore del cameriere', 'Il cliente ha cambiato idea', 'Piatto non riuscito', 'Piatto finito'];

/** Riga già inviata: offrirla (resta, vale 0, nessun ticket) oppure toglierla (storno al suo reparto). */
function FoglioRigaInviata({ riga, onChiudi, conferma }: { riga: RigaComanda | null; onChiudi: () => void; conferma: (testo: string, ok: () => void, azione?: string) => void }) {
  const { db, operatore } = useApp();
  const { esegui } = useAzione();
  const setup = useDati((d) => d.setup());
  const [pin, setPin] = useState('');
  const [chiediPin, setChiediPin] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const reparto = setup.centri.find((c) => c.id === riga?.centroProduzioneId)?.nome;
  const chiudi = () => { setPin(''); setChiediPin(false); setErrore(null); onChiudi(); };

  const offri = async () => {
    if (!riga) return;
    let chi = operatore ?? undefined;
    if (!puoGestire(operatore?.ruolo)) {
      if (!chiediPin) return setChiediPin(true);
      const r = await verificaResponsabile(db, pin).catch(() => null);
      if (!r) { setPin(''); return setErrore('Serve il PIN di un responsabile'); }
      chi = r;
    }
    const ok = await esegui(() => db.offri(riga.id, !riga.omaggio, chi), riga.omaggio ? `${riga.descrizione}: di nuovo a pagamento` : `${riga.descrizione} offerto dalla casa`);
    if (ok) chiudi();
  };

  return (
    <Foglio aperto={!!riga} onChiudi={chiudi} titolo={riga?.descrizione ?? ''}>
      <section className="mb-6">
        <h3 className="mb-1 text-base font-bold">{riga?.omaggio ? 'Offerto dalla casa' : 'Offrire?'}</h3>
        <p className="mb-3 text-sm text-text-muted">{riga?.omaggio ? 'Il piatto è sul conto a 0 €. Puoi rimetterlo a pagamento.' : `Il piatto resta e si serve: sul conto vale 0 €. ${reparto ? `${reparto} non riceve niente.` : ''}`}</p>
        {chiediPin && !riga?.omaggio && <div className="mb-3"><TastierinoPin pin={pin} onCambia={(p) => { setPin(p); setErrore(null); }} /></div>}
        {errore && <p role="alert" className="mb-2 text-sm font-semibold text-danger">{errore}</p>}
        <Pulsante variante={riga?.omaggio ? 'secondario' : 'conferma'} className="w-full" icona={<Gift size={20} weight="bold" aria-hidden />} onClick={() => void offri()}>
          {riga?.omaggio ? 'Rimetti a pagamento' : chiediPin ? 'Conferma con il PIN' : 'Offerto dalla casa'}
        </Pulsante>
      </section>
      <section>
        <h3 className="mb-1 text-base font-bold">Togliere dal conto?</h3>
        <p className="mb-3 text-sm text-text-muted">{reparto ? `${reparto} riceve un ticket di storno.` : 'Nessun reparto da avvisare.'} Perché?</p>
        <div className="grid grid-cols-2 gap-2">
          {MOTIVI_STORNO.map((m) => (
            <Pulsante key={m} className="h-auto min-h-touch-comodo whitespace-normal py-2" onClick={() => {
              const r = riga!; chiudi();
              conferma(`“${r.descrizione}” viene tolto dal conto${reparto ? ` e ${reparto.toLowerCase()} riceve lo storno` : ''}. Motivo: ${m.toLowerCase()}.`,
                () => void esegui(() => db.storna(r.id, m, nuovaChiave(), operatore ?? undefined), 'Storno inviato'), 'Storna');
            }}>{m}</Pulsante>
          ))}
        </div>
      </section>
    </Foglio>
  );
}
