import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, GearSix, Receipt, Warning } from '@phosphor-icons/react';
import { calcolaConto, euro, type Comanda, type Tavolo } from '@gr/core';
import { useApp, useAzione, useDati, useOra } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { puoGestire } from './gestione/Layout';
import { Foglio, Icona, Pulsante } from '../ui/primitivi';

const RITARDO_MIN = 20;

type Stato = 'libero' | 'occupato' | 'conto' | 'ritardo';
const STILE: Record<Stato, string> = {
  libero: 'bg-tavolo-libero border-2 border-tavolo-libero-bordo text-text',
  occupato: 'bg-tavolo-occupato text-on-tavolo',
  conto: 'bg-tavolo-conto text-on-tavolo',
  ritardo: 'bg-tavolo-ritardo text-on-tavolo',
};
const NOME_STATO: Record<Stato, string> = { libero: 'Liberi', occupato: 'Occupati', conto: 'Conto chiesto', ritardo: 'In ritardo' };

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
  const { sale, tavoli, aperte, copertoCents } = useDati((d) => ({
    sale: d.setup().sale, tavoli: d.setup().tavoli, aperte: d.comandeAperte(), copertoCents: d.setup().locale.copertoCents,
  }));
  const [salaId, setSalaId] = useState(sale[0]?.id);
  const [daAprire, setDaAprire] = useState<Tavolo | null>(null);
  const [coperti, setCoperti] = useState(2);
  const { ref: pianta, w } = useLarghezza<HTMLDivElement>();

  const info = (t: Tavolo): { stato: Stato; comanda?: Comanda; minuti?: number; totale?: number } => {
    const c = aperte.find((x) => x.tavoloId === t.id);
    if (!c) return { stato: 'libero' };
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
  const conteggi = (['libero', 'occupato', 'conto', 'ritardo'] as Stato[]).map((s) => [s, visibili.filter((t) => info(t).stato === s).length] as const);
  const copertiInSala = aperte.reduce((s, c) => s + c.coperti, 0);
  const inSala = aperte
    .map((c) => ({ c, t: tavoli.find((x) => x.id === c.tavoloId) }))
    .filter((x): x is { c: Comanda; t: Tavolo } => !!x.t)
    .map(({ c, t }) => ({ c, t, i: info(t) }))
    .sort((a, b) => a.c.apertaAt.localeCompare(b.c.apertaAt));

  const tocca = (t: Tavolo) => {
    const i = info(t);
    if (i.comanda) nav(`/comanda/${i.comanda.id}`);
    else { setCoperti(Math.min(t.posti, 2)); setDaAprire(t); }
  };

  const apri = () => {
    if (!daAprire || !operatore) return;
    void esegui(async () => {
      const c = await db.apriTavolo(daAprire.id, coperti, operatore);
      setDaAprire(null);
      nav(`/comanda/${c.id}`);
    });
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata titolo={db.setup().locale.nome} sotto={operatore ? operatore.nome : undefined}>
        {sale.length > 1 && (
          <nav aria-label="Sale" className="flex flex-none gap-1 rounded-pill bg-bg p-1">
            {sale.map((s) => (
              <button key={s.id} type="button" onClick={() => setSalaId(s.id)} aria-pressed={s.id === salaId}
                className={`premibile h-9 rounded-pill px-4 text-sm font-semibold ${s.id === salaId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{s.nome}</button>
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
            <Link to="/cucina" className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text">{Icona.cucina}Monitor cucina</Link>
            {puoGestire(operatore?.ruolo) && (
              <Link to="/gestione" className="premibile flex h-9 items-center gap-2 rounded-md border border-border px-3 text-text"><GearSix size={18} weight="bold" aria-hidden="true" />Gestione</Link>
            )}
          </div>

          <div ref={pianta} className="relative flex-1 overflow-auto px-4 pb-4">
            {visibili.length === 0 ? (
              <p className="py-16 text-center text-base text-text-muted">Questa sala non ha ancora tavoli. Si disegna dalle impostazioni.</p>
            ) : (
              <div className="relative" style={{ width: colonne * unita, height: righeGriglia * unita }}>
                {visibili.map((t) => {
                  const i = info(t);
                  const tondo = t.forma === 'tondo' || t.forma === 'sgabello';
                  const piccolo = unita < 96;
                  const etichetta = i.stato === 'libero'
                    ? `Tavolo ${t.numero}, libero, ${t.posti} posti`
                    : `Tavolo ${t.numero}, ${NOME_STATO[i.stato].toLowerCase()}, ${i.comanda!.coperti} coperti, ${i.minuti} minuti, ${euro(i.totale!)}`;
                  return (
                    <button key={t.id} type="button" onClick={() => tocca(t)} aria-label={etichetta}
                      className={`premibile absolute flex flex-col items-center justify-center gap-0.5 tabular-nums ${tondo ? 'rounded-pill' : 'rounded-lg'} ${STILE[i.stato]}`}
                      style={{ left: t.x * unita, top: t.y * unita, width: t.larghezza * unita - 12, height: t.altezza * unita - 12 }}>
                      <b className={`${piccolo ? 'text-lg' : 'text-[26px]'} font-bold leading-none tracking-tight`}>{t.numero}</b>
                      {i.stato === 'libero' ? (
                        !piccolo && <span className="text-xs font-medium text-text-muted">{t.posti} posti</span>
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
          <div className="flex items-baseline justify-between px-5 pb-3 pt-5">
            <h2 className="text-base font-bold">In sala adesso</h2>
            <span className="text-sm font-semibold text-text-muted">{copertiInSala} coperti</span>
          </div>
          {inSala.length === 0 ? (
            <p className="px-5 py-6 text-base text-text-muted">Nessun tavolo aperto. Tocca un tavolo libero per iniziare.</p>
          ) : (
            <ul className="flex-1 overflow-y-auto px-3 pb-4">
              {inSala.map(({ c, t, i }) => (
                <li key={c.id}>
                  <button type="button" onClick={() => nav(`/comanda/${c.id}`)}
                    className="premibile flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-2">
                    <span className={`grid h-11 w-11 flex-none place-items-center rounded-md text-base font-bold ${STILE[i.stato]}`}>{t.numero}</span>
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

      <Foglio aperto={!!daAprire} onChiudi={() => setDaAprire(null)} titolo={`Apri il tavolo ${daAprire?.numero ?? ''}`}>
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
        <Pulsante variante="primario" taglia="xl" className="w-full" caricamento={inCorso} onClick={apri}>Apri e prendi la comanda</Pulsante>
      </Foglio>
    </div>
  );
}
