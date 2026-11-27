import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowsMerge, BeerBottle, CalendarCheck, ChatCircleText, Clock, ChartBar, GearSix, Handbag, Receipt, Warning } from '@phosphor-icons/react';
import { FoglioMessaggio } from './Messaggi';
import { ALLERGENI_ETICHETTA, calcolaConto, comandaSulTavolo, daAccogliere, euro, nomeConto, numeriTavolo, type Comanda, type Prenotazione, type Tavolo } from '@gr/core';
import { useApp, useAzione, useDati, useOra } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { puoGestire } from '../dati/ruoli';
import { Foglio, Icona, Pulsante, useConferma } from '../ui/primitivi';

const RITARDO_MIN = 20;
/** Un tavolo libero risulta prenotato da 3 ore prima a 45 minuti dopo l'orario. */
const PRIMA_MIN = 180, DOPO_MIN = 45;
const ora2 = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

type Stato = 'libero' | 'prenotato' | 'occupato' | 'conto' | 'ritardo';
const STILE: Record<Stato, string> = {
  libero: 'bg-tavolo-libero border-2 border-tavolo-libero-bordo text-text',
  prenotato: 'bg-tavolo-prenotato text-on-tavolo',
  occupato: 'bg-tavolo-occupato text-on-tavolo',
  conto: 'bg-tavolo-conto text-on-tavolo',
  ritardo: 'bg-tavolo-ritardo text-on-tavolo',
};
const NOME_STATO: Record<Stato, string> = { libero: 'Liberi', prenotato: 'Prenotati', occupato: 'Occupati', conto: 'Conto chiesto', ritardo: 'In ritardo' };

/** Larghezza della piantina misurata, per adattare i tavoli allo schermo (da 390 a 1920 px). */
function useLarghezza<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

// S03: sala con stato dei tavoli.
export function Sala() {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const nav = useNavigate();
  const ora = useOra();
  const { sale, tavoli, aperte, copertoCents, prenotazioni } = useDati((d) => ({
    sale: d.setup().sale, tavoli: d.setup().tavoli, aperte: d.comandeAperte(), copertoCents: d.setup().locale.copertoCents,
    prenotazioni: d.prenotazioni(),
  }));
  const [pren, setPren] = useState<string>('');
  const [aspettaTavolo, setAspettaTavolo] = useState<Prenotazione | null>(null);
  const [vista, setVista] = useState<'sala' | 'prenotazioni'>('sala');
  const [messaggio, setMessaggio] = useState(false);
  const [listaAperta, setListaAperta] = useState(false);
  const { chiedi, ui: conferma } = useConferma();
  const daSedere = prenotazioni.filter(daAccogliere);
  const prenotazioneDel = (t: Tavolo) => daSedere.find((p) => {
    if (p.tavoloId !== t.id) return false;
    const min = (new Date(p.inizio).getTime() - ora.getTime()) / 60000;
    return min <= PRIMA_MIN && min >= -DOPO_MIN;
  });
  const [salaId, setSalaId] = useState(sale[0]?.id);
  const [daAprire, setDaAprire] = useState<Tavolo | null>(null);
  const [coperti, setCoperti] = useState(2);
  /** Unisci tavoli prima di aprire: i tavoli liberi scelti (il primo è quello del conto). */
  const [unendo, setUnendo] = useState<string[] | null>(null);
  const [uniti, setUniti] = useState<string[]>([]);
  const [banco, setBanco] = useState(false);
  const alBanco = aperte.filter((c) => !c.tavoloId);
  const { ref: pianta, w } = useLarghezza<HTMLDivElement>();

  const info = (t: Tavolo): { stato: Stato; comanda?: Comanda; minuti?: number; totale?: number } => {
    const c = comandaSulTavolo(aperte, t.id);
    if (!c) return { stato: prenotazioneDel(t) ? 'prenotato' : 'libero' };
    const righe = db.righe(c.id);
    const minuti = Math.max(0, Math.floor((ora.getTime() - new Date(c.apertaAt).getTime()) / 60000));
    const inRitardo = righe.some((r) => r.stato === 'inviata' && r.inviataAt && ora.getTime() - new Date(r.inviataAt).getTime() > RITARDO_MIN * 60000);
    const totale = calcolaConto(righe, c.coperti, copertoCents).totaleCents;
    return { stato: c.stato === 'preconto' ? 'conto' : inRitardo ? 'ritardo' : 'occupato', comanda: c, minuti, totale };
  };

  const visibili = tavoli.filter((t) => t.salaId === salaId);
  const colonne = Math.max(5, ...visibili.map((t) => t.x + t.larghezza));
  const righeGriglia = Math.max(3, ...visibili.map((t) => t.y + t.altezza));
  const unita = Math.max(64, Math.min(140, Math.floor(w / colonne)));
  const conteggi = (['libero', 'prenotato', 'occupato', 'conto', 'ritardo'] as Stato[]).map((s) => [s, visibili.filter((t) => info(t).stato === s).length] as const);
  const copertiInSala = aperte.reduce((s, c) => s + c.coperti, 0);
  const inSala = aperte
    .map((c) => ({ c, t: tavoli.find((x) => x.id === c.tavoloId) }))
    .filter((x): x is { c: Comanda; t: Tavolo } => !!x.t)
    .map(({ c, t }) => ({ c, t, i: info(t) }))
    .sort((a, b) => a.c.apertaAt.localeCompare(b.c.apertaAt));

  const tocca = (t: Tavolo) => {
    const i = info(t);
    if (unendo) {
      if (i.comanda) return;
      return setUnendo(unendo.includes(t.id) ? unendo.filter((x) => x !== t.id) : [...unendo, t.id]);
    }
    setUniti([]);
    if (i.comanda) return nav(`/comanda/${i.comanda.id}`);
    const p = aspettaTavolo ?? prenotazioneDel(t);
    setAspettaTavolo(null);
    setPren(p?.id ?? '');
    setCoperti(p ? p.coperti : Math.min(t.posti, 2));
    setDaAprire(t);
  };

  /** Dall'elenco: se ha il tavolo ed è libero si apre quello, altrimenti si sceglie il tavolo in sala. */
  const accogli = (p: Prenotazione) => {
    setListaAperta(false);
    const t = tavoli.find((x) => x.id === p.tavoloId);
    if (t && !comandaSulTavolo(aperte, t.id)) {
      if (t.salaId !== salaId) setSalaId(t.salaId);
      setPren(p.id); setCoperti(p.coperti); setDaAprire(t);
    } else {
      setAspettaTavolo(p); setVista('sala');
    }
  };

  /** Tavoli scelti in modalità "unisci": si apre il primo e gli altri si uniscono. */
  const apriUniti = () => {
    if (!unendo?.length) return;
    const [primo, ...resto] = unendo;
    const t = tavoli.find((x) => x.id === primo)!;
    setUniti(resto); setUnendo(null);
    setPren(''); setCoperti(Math.min(40, unendo.reduce((n, id) => n + (tavoli.find((x) => x.id === id)?.posti ?? 0), 0)));
    setDaAprire(t);
  };

  const apriBanco = (canale: 'banco' | 'asporto', nome: string) => {
    if (!operatore) return;
    void esegui(async () => {
      const c = await db.apriBanco(canale, nome, operatore);
      setBanco(false);
      nav(`/comanda/${c.id}`);
    });
  };

  const apri = () => {
    if (!daAprire || !operatore) return;
    void esegui(async () => {
      const c = await db.apriTavolo(daAprire.id, coperti, operatore, pren || undefined);
      if (uniti.length) await db.unisciTavoli(c.id, uniti);
      setUniti([]);
      setDaAprire(null);
      nav(`/comanda/${c.id}`);
    });
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata titolo={sale.length > 1 ? <span className="hidden sm:inline">{db.setup().locale.nome}</span> : db.setup().locale.nome} sotto={operatore ? <span className={sale.length > 1 ? 'hidden sm:inline' : ''}>{operatore.nome}</span> : undefined}>
        {sale.length > 1 && (
          <nav aria-label="Sale" className="-ml-3 flex min-w-0 gap-1 overflow-x-auto rounded-pill bg-bg p-1 sm:ml-0 sm:flex-none">
            {sale.map((s) => (
              <button key={s.id} type="button" onClick={() => setSalaId(s.id)} aria-pressed={s.id === salaId}
                className={`premibile h-9 flex-none whitespace-nowrap rounded-pill px-3 text-sm font-semibold sm:px-4 ${s.id === salaId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{s.nome}</button>
            ))}
          </nav>
        )}
      </Testata>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-2 pt-4 text-sm font-semibold text-text-muted">
            {conteggi.map(([s, n]) => (
              <span key={s} className="flex items-center gap-2">
                <i aria-hidden="true" className={`block h-3 w-3 rounded-sm ${STILE[s]}`} />{NOME_STATO[s]} <span className="text-text">{n}</span>
              </span>
            ))}
            <span className="flex-1" />
            <button type="button" onClick={() => setBanco(true)} className="premibile flex h-9 items-center gap-2 rounded-md bg-accent px-3 font-bold text-on-accent">
              <BeerBottle size={18} weight="bold" aria-hidden="true" />Banco / Asporto{alBanco.length ? ` · ${alBanco.length}` : ''}
            </button>
            <button type="button" onClick={() => setUnendo(unendo ? null : [])} aria-pressed={!!unendo}
              className={`premibile flex h-9 items-center gap-2 rounded-md px-3 ${unendo ? 'bg-text text-bg' : 'border border-border text-text'}`}>
              <ArrowsMerge size={18} weight="bold" aria-hidden="true" />Unisci tavoli
            </button>
            <button type="button" onClick={() => setListaAperta(true)} className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text lg:hidden">
              <CalendarCheck size={18} weight="bold" aria-hidden="true" />Prenotazioni {daSedere.length}
            </button>
            <button type="button" onClick={() => setMessaggio(true)} className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text"><ChatCircleText size={18} weight="bold" aria-hidden="true" />Messaggio</button>
            <Link to="/cucina" className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text">{Icona.cucina}Monitor cucina</Link>
            {(puoGestire(operatore?.ruolo) || operatore?.ruolo === 'cassiere') && (
              <Link to="/cassa" className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text"><ChartBar size={18} weight="bold" aria-hidden="true" />Cassa</Link>
            )}
            {puoGestire(operatore?.ruolo) && (
              <Link to="/gestione" className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text"><GearSix size={18} weight="bold" aria-hidden="true" />Gestione</Link>
            )}
          </div>

          {unendo && (
            <div role="status" className="mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-md bg-text px-4 py-2.5 font-semibold text-bg">
              <ArrowsMerge size={20} weight="bold" aria-hidden="true" />
              <span className="flex-1">{unendo.length ? `Tavoli ${unendo.map((id) => tavoli.find((t) => t.id === id)?.numero).join(' + ')}` : 'Tocca i tavoli liberi da unire (anche di sale diverse)'}</span>
              <button type="button" onClick={() => setUnendo(null)} className="premibile h-10 rounded-md px-3">Annulla</button>
              <button type="button" disabled={unendo.length < 2} onClick={apriUniti} className="premibile h-10 rounded-md bg-accent px-4 font-bold text-on-accent disabled:opacity-40">Apri insieme</button>
            </div>
          )}
          {alBanco.length > 0 && !unendo && (
            <div className="mx-4 mb-2 flex gap-2 overflow-x-auto" aria-label="Conti al banco e asporto">
              {alBanco.map((c) => (
                <button key={c.id} type="button" onClick={() => nav(`/comanda/${c.id}`)}
                  className="premibile flex h-11 flex-none items-center gap-2 rounded-pill bg-surface-2 px-4 text-sm font-semibold ring-1 ring-border">
                  {c.canale === 'asporto' ? <Handbag size={16} weight="bold" aria-hidden /> : <BeerBottle size={16} weight="bold" aria-hidden />}
                  {nomeConto(db.setup(), c)}
                  <span className="tabular-nums text-text-muted">{euro(calcolaConto(db.righe(c.id), 0, 0).totaleCents)}</span>
                </button>
              ))}
            </div>
          )}
          {aspettaTavolo && (
            <div role="status" className="mx-4 mb-2 flex items-center gap-3 rounded-md bg-tavolo-prenotato px-4 py-2.5 font-semibold text-on-tavolo">
              <CalendarCheck size={20} weight="bold" aria-hidden="true" />
              <span className="flex-1">Tocca un tavolo libero per {aspettaTavolo.nome} ({aspettaTavolo.coperti})</span>
              <button type="button" onClick={() => setAspettaTavolo(null)} className="premibile h-9 rounded-md px-3 underline-offset-2 hover:underline">Annulla</button>
            </div>
          )}
          <div ref={pianta} className="relative flex-1 overflow-auto px-4 pb-4">
            {visibili.length === 0 ? (
              <p className="py-16 text-center text-base text-text-muted">Questa sala non ha ancora tavoli. Si disegna dalle impostazioni.</p>
            ) : (
              <div className="relative" style={{ width: colonne * unita, height: righeGriglia * unita }}>
                {visibili.map((t) => {
                  const i = info(t);
                  const tondo = t.forma === 'tondo' || t.forma === 'sgabello';
                  const piccolo = unita < 96;
                  const pt = i.stato === 'prenotato' ? prenotazioneDel(t) : undefined;
                  const scelto = unendo?.includes(t.id);
                  const unitoA = i.comanda && i.comanda.tavoloId !== t.id ? tavoli.find((x) => x.id === i.comanda!.tavoloId)?.numero : undefined;
                  const etichetta = i.stato === 'libero'
                    ? `Tavolo ${t.numero}, libero, ${t.posti} posti`
                    : pt ? `Tavolo ${t.numero}, prenotato alle ${ora2(pt.inizio)} per ${pt.nome}, ${pt.coperti} persone`
                    : unitoA ? `Tavolo ${t.numero}, unito al tavolo ${unitoA}`
                    : `Tavolo ${t.numero}, ${NOME_STATO[i.stato].toLowerCase()}, ${i.comanda!.coperti} coperti, ${i.minuti} minuti, ${euro(i.totale!)}`;
                  return (
                    <button key={t.id} type="button" onClick={() => tocca(t)} aria-label={etichetta} aria-pressed={unendo ? !!scelto : undefined}
                      className={`premibile absolute flex flex-col items-center justify-center gap-0.5 tabular-nums ${tondo ? 'rounded-pill' : 'rounded-lg'} ${scelto ? 'bg-accent text-on-accent ring-4 ring-accent/40' : STILE[i.stato]} ${unendo && i.comanda ? 'opacity-40' : ''}`}
                      style={{ left: t.x * unita, top: t.y * unita, width: t.larghezza * unita - 12, height: t.altezza * unita - 12 }}>
                      <b className={`${piccolo ? 'text-lg' : 'text-[26px]'} font-bold leading-none tracking-tight`}>{t.numero}</b>
                      {unitoA ? (
                        <span className="flex items-center gap-1 text-xs font-bold"><ArrowsMerge size={13} weight="bold" aria-hidden />con {unitoA}</span>
                      ) : i.stato === 'libero' ? (
                        !piccolo && <span className={`text-xs font-medium ${scelto ? '' : 'text-text-muted'}`}>{t.posti} posti</span>
                      ) : pt ? (
                        <>
                          <span className="flex items-center gap-1 text-xs font-bold"><CalendarCheck size={13} weight="bold" aria-hidden />{ora2(pt.inizio)}</span>
                          {!piccolo && <span className="max-w-full truncate px-1.5 text-xs font-semibold">{pt.nome} · {pt.coperti}</span>}
                        </>
                      ) : (
                        <>
                          <span className="flex items-center gap-1 text-xs font-semibold">
                            {i.stato === 'conto' ? <Receipt size={13} weight="bold" aria-hidden /> : i.stato === 'ritardo' ? <Warning size={13} weight="fill" aria-hidden /> : <Clock size={13} weight="bold" aria-hidden />}
                            {i.stato === 'conto' ? 'Conto' : `${i.minuti}′`}
                          </span>
                          {!piccolo && <span className="text-xs font-semibold">{euro(i.totale!)}</span>}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <aside aria-label="In sala adesso" className="hidden w-[320px] flex-none flex-col border-l border-border bg-surface lg:flex">
          <div role="tablist" aria-label="Colonna" className="mx-4 mt-4 flex gap-1 rounded-md bg-bg p-1">
            {([['sala', `In sala · ${copertiInSala}`], ['prenotazioni', `Prenotazioni · ${daSedere.length}`]] as const).map(([v, t]) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                className={`premibile h-10 flex-1 rounded-md text-sm font-semibold ${vista === v ? 'bg-surface-2 text-text shadow-card' : 'text-text-muted'}`}>{t}</button>
            ))}
          </div>
          {vista === 'prenotazioni' ? (
            <ListaPrenotazioni prenotazioni={prenotazioni} tavoli={tavoli} ora={ora} onAccogli={accogli}
              onNonArrivati={(p) => chiedi(`${p.nome} (${p.coperti}) non si è presentato? Su Table Flow risulterà "no show".`, () => void esegui(() => db.segnaNonPresentato(p.id), 'Segnato come non presentato'), 'Non si è presentato')} />
          ) : inSala.length === 0 ? (
            <p className="px-5 py-6 text-base text-text-muted">Nessun tavolo aperto. Tocca un tavolo libero per iniziare.</p>
          ) : (
            <ul className="mt-2 flex-1 overflow-y-auto px-3 pb-4">
              {inSala.map(({ c, t, i }) => (
                <li key={c.id}>
                  <button type="button" onClick={() => nav(`/comanda/${c.id}`)}
                    className="premibile flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-2">
                    <span className={`grid h-11 min-w-11 flex-none place-items-center rounded-md px-1.5 text-base font-bold ${STILE[i.stato]}`}>{numeriTavolo(db.setup(), c)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-semibold">{c.coperti} coperti · {c.operatore || 'n.d.'}</span>
                      <span className="text-sm text-text-muted">{i.stato === 'conto' ? 'Conto chiesto' : i.stato === 'ritardo' ? 'Piatti in ritardo' : `Aperto da ${i.minuti} min`}</span>
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">{euro(i.totale!)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <Foglio aperto={!!daAprire} onChiudi={() => { setDaAprire(null); setUniti([]); }} titolo={uniti.length ? `Apri i tavoli ${[daAprire?.numero, ...uniti.map((id) => tavoli.find((t) => t.id === id)?.numero)].join(' + ')}` : `Apri il tavolo ${daAprire?.numero ?? ''}`}>
        {(() => {
          const scelte = daSedere.filter((p) => p.id === pren || !p.tavoloId || p.tavoloId === daAprire?.id || !tavoli.some((t) => t.id === p.tavoloId));
          const p = prenotazioni.find((x) => x.id === pren);
          if (!scelte.length && !p) return null;
          return (
            <div className="mb-5">
              <label htmlFor="apri-pren" className="mb-1.5 block text-sm font-semibold text-text-muted">Prenotazione</label>
              <select id="apri-pren" value={pren} onChange={(e) => { setPren(e.target.value); const x = prenotazioni.find((y) => y.id === e.target.value); if (x) setCoperti(x.coperti); }}
                className="h-touch w-full rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none focus:border-focus">
                <option value="">Nessuna (cliente senza prenotazione)</option>
                {scelte.map((x) => <option key={x.id} value={x.id}>{ora2(x.inizio)} · {x.nome} · {x.coperti} pers.</option>)}
              </select>
              {p && (
                <div className="mt-3 rounded-md bg-bg p-3 text-sm">
                  <p className="font-semibold text-text">{p.nome}{p.telefono ? ` · ${p.telefono}` : ''}</p>
                  {p.note && <p className="mt-1 text-text-muted">{p.note}</p>}
                  {p.tag.length > 0 && <p className="mt-1 text-text-muted">{p.tag.join(' · ')}</p>}
                  {p.allergeni.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {p.allergeni.map((a) => <span key={a} className="rounded-pill bg-allergene px-2.5 py-0.5 text-xs font-bold text-on-allergene">{ALLERGENI_ETICHETTA[a]}</span>)}
                      <span className="text-xs text-text-muted">vanno sulla comanda</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        <p className="mb-4 text-sm font-semibold text-text-muted">Coperti</p>
        <div className="mb-4 flex items-center justify-center gap-6">
          <button type="button" aria-label="Meno coperti" onClick={() => setCoperti((c) => Math.max(1, c - 1))} className="premibile h-16 w-16 rounded-md bg-surface-2 text-2xl font-semibold">−</button>
          <output aria-live="polite" className="w-24 text-center text-display font-bold tabular-nums">{coperti}<span className="sr-only"> coperti</span></output>
          <button type="button" aria-label="Più coperti" onClick={() => setCoperti((c) => Math.min(40, c + 1))} className="premibile h-16 w-16 rounded-md bg-surface-2 text-2xl font-semibold">+</button>
        </div>
        <div className="mb-6 flex flex-wrap justify-center gap-2" role="group" aria-label="Scelta rapida coperti">
          {[1, 2, 3, 4, 5, 6, 8].map((n) => (
            <button key={n} type="button" aria-pressed={coperti === n} onClick={() => setCoperti(n)}
              className={`premibile h-11 min-w-11 rounded-pill px-3 text-base font-semibold ${coperti === n ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{n}</button>
          ))}
        </div>
        <Pulsante variante="primario" taglia="xl" className="w-full" caricamento={inCorso} onClick={apri}>
          {pren ? `Apri per ${prenotazioni.find((x) => x.id === pren)?.nome ?? ''}` : 'Apri e prendi la comanda'}
        </Pulsante>
      </Foglio>

      <FoglioBanco aperto={banco} onChiudi={() => setBanco(false)} aperti={alBanco} inCorso={inCorso} onApri={apriBanco}
        onRiprendi={(c) => { setBanco(false); nav(`/comanda/${c.id}`); }} />

      <Foglio aperto={listaAperta} onChiudi={() => setListaAperta(false)} titolo="Prenotazioni di oggi">
        <ListaPrenotazioni prenotazioni={prenotazioni} tavoli={tavoli} ora={ora} onAccogli={accogli}
          onNonArrivati={(p) => chiedi(`${p.nome} (${p.coperti}) non si è presentato? Su Table Flow risulterà "no show".`, () => void esegui(() => db.segnaNonPresentato(p.id), 'Segnato come non presentato'), 'Non si è presentato')} />
      </Foglio>
      {conferma}
      <FoglioMessaggio aperto={messaggio} onChiudi={() => setMessaggio(false)} />
    </div>
  );
}

/** Prenotazioni della serata: da far sedere in alto, poi quelle già passate. */
function ListaPrenotazioni({ prenotazioni, tavoli, ora, onAccogli, onNonArrivati }: {
  prenotazioni: Prenotazione[]; tavoli: Tavolo[]; ora: Date;
  onAccogli: (p: Prenotazione) => void; onNonArrivati: (p: Prenotazione) => void;
}) {
  const attese = prenotazioni.filter(daAccogliere);
  const altre = prenotazioni.filter((p) => !daAccogliere(p));
  const ETICHETTA: Record<string, string> = { arrivata: 'Seduti', terminata: 'Andati via', mancata: 'Non presentati' };
  if (!prenotazioni.length) return <p className="px-5 py-6 text-base text-text-muted">Nessuna prenotazione per oggi. Arrivano da sole da Table Flow.</p>;
  return (
    <ul className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
      {attese.map((p) => {
        const ritardo = Math.floor((ora.getTime() - new Date(p.inizio).getTime()) / 60000);
        const tav = tavoli.find((t) => t.id === p.tavoloId)?.numero ?? (p.tavoliExt.length ? p.tavoliExt.join('+') : null);
        return (
          <li key={p.id} className="flex items-center gap-2">
            <button type="button" onClick={() => onAccogli(p)} className="premibile flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-2">
              <span className="w-12 flex-none text-[15px] font-bold tabular-nums">{new Date(p.inizio).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{p.nome} · {p.coperti}{p.allergeni.length ? ' ·' : ''}{p.allergeni.length > 0 && <span className="ml-1 text-allergene">allergie</span>}</span>
                <span className={`truncate text-sm ${ritardo > 15 ? 'font-semibold text-warning' : 'text-text-muted'}`}>
                  {tav ? `Tavolo ${tav}` : 'Tavolo da scegliere'}{p.stato === 'richiesta' ? ' · da confermare' : ''}{ritardo > 15 ? ` · in ritardo ${ritardo}′` : ''}
                </span>
              </span>
            </button>
            {ritardo > 15 && (
              <button type="button" onClick={() => onNonArrivati(p)} aria-label={`${p.nome} non si è presentato`}
                className="premibile h-10 flex-none rounded-md px-2.5 text-xs font-semibold text-text-muted hover:bg-surface-2">No show</button>
            )}
          </li>
        );
      })}
      {altre.length > 0 && <li className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Già gestite</li>}
      {altre.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-2 py-2 text-text-muted">
          <span className="w-12 flex-none text-sm tabular-nums">{new Date(p.inizio).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="flex-1 truncate text-sm">{p.nome} · {p.coperti}</span>
          <span className="text-xs font-semibold">{ETICHETTA[p.stato] ?? p.stato}</span>
        </li>
      ))}
    </ul>
  );
}

/** Banco e asporto: un conto senza tavolo, in un tocco. Il nome è facoltativo (per richiamarlo dopo). */
function FoglioBanco({ aperto, onChiudi, aperti, inCorso, onApri, onRiprendi }: {
  aperto: boolean; onChiudi: () => void; aperti: Comanda[]; inCorso: boolean;
  onApri: (canale: 'banco' | 'asporto', nome: string) => void; onRiprendi: (c: Comanda) => void;
}) {
  const { db } = useApp();
  const [nome, setNome] = useState('');
  useEffect(() => { if (aperto) setNome(''); }, [aperto]);
  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo="Banco e asporto">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={inCorso} onClick={() => onApri('banco', nome)}
          className="premibile flex h-28 flex-col items-center justify-center gap-2 rounded-lg bg-accent text-lg font-bold text-on-accent disabled:opacity-50">
          <BeerBottle size={32} weight="bold" aria-hidden />Banco
        </button>
        <button type="button" disabled={inCorso} onClick={() => onApri('asporto', nome)}
          className="premibile flex h-28 flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-lg font-bold ring-1 ring-border disabled:opacity-50">
          <Handbag size={32} weight="bold" aria-hidden />Asporto
        </button>
      </div>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (facoltativo, es. Marco)" aria-label="Nome del cliente"
        className="mt-3 h-touch w-full rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
      <p className="mt-2 text-sm text-text-muted">Niente tavolo né coperti: scegli i prodotti e tocca <strong className="text-text">Incassa</strong>. Quello che va preparato parte da solo in cucina o al bar.</p>
      {aperti.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-text-muted">Ancora da incassare</h3>
          <ul className="flex flex-col gap-1.5">
            {aperti.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onRiprendi(c)} className="premibile flex w-full items-center gap-3 rounded-md bg-bg px-3 py-2.5 text-left">
                  {c.canale === 'asporto' ? <Handbag size={20} weight="bold" aria-hidden /> : <BeerBottle size={20} weight="bold" aria-hidden />}
                  <span className="flex-1 font-semibold">{nomeConto(db.setup(), c)}</span>
                  <span className="text-sm text-text-muted">{new Date(c.apertaAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="font-semibold tabular-nums">{euro(calcolaConto(db.righe(c.id), 0, 0).totaleCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Foglio>
  );
}
