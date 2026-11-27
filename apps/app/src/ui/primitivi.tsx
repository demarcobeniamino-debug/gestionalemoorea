// Primitivi dell'interfaccia (specifiche in replica/design/components.md). Solo classi dai token.
// Regola dei raggi: pulsanti, campi e tile = md; pannelli, fogli e card = lg; chip e filtri = pill.
import { Fragment, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  ArrowLeft, Printer, Receipt, Warning, UserCircle, MagnifyingGlass, X, Scroll, Check, CheckCircle,
  WarningCircle, Info, Clock, ForkKnife, CookingPot, Wine, Pause, Prohibit, SignOut, Backspace,
} from '@phosphor-icons/react';
import { useApp, useDati } from '../dati/contesto';

type Variante = 'primario' | 'conferma' | 'pericolo' | 'secondario' | 'fantasma';
type Taglia = 'md' | 'lg' | 'xl';

const VARIANTI: Record<Variante, string> = {
  primario: 'bg-accent text-on-accent font-bold',
  conferma: 'bg-success text-on-success font-bold',
  pericolo: 'bg-danger text-on-danger font-bold',
  secondario: 'bg-surface-2 text-text font-semibold',
  fantasma: 'bg-transparent text-text font-semibold',
};
const TAGLIE: Record<Taglia, string> = { md: 'h-touch px-4 text-base', lg: 'h-touch-comodo px-5 text-base', xl: 'h-[72px] px-6 text-lg' };

export function Pulsante({ variante = 'secondario', taglia = 'lg', caricamento, icona, className = '', children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; taglia?: Taglia; caricamento?: boolean; icona?: ReactNode }) {
  return (
    <button
      type="button"
      {...p}
      disabled={disabled || caricamento}
      aria-busy={caricamento || undefined}
      className={`premibile inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTI[variante]} ${TAGLIE[taglia]} ${className}`}
    >
      {caricamento ? <Spinner /> : icona}
      <span>{children}</span>
    </button>
  );
}

export const Spinner = () => (
  <svg className="animate-spin [animation-duration:600ms]" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 20" strokeLinecap="round" />
  </svg>
);

/** Icone: solo Phosphor, peso "bold" per le azioni, 20px. */
const I = { size: 20, weight: 'bold' as const, 'aria-hidden': true };
export const Icona = {
  indietro: <ArrowLeft {...I} />,
  stampa: <Printer {...I} />,
  scontrino: <Receipt {...I} size={22} />,
  avviso: <Warning {...I} weight="fill" />,
  utente: <UserCircle {...I} />,
  cerca: <MagnifyingGlass {...I} size={18} />,
  chiudi: <X {...I} />,
  carta: <Scroll {...I} size={18} />,
  spunta: <Check {...I} size={16} />,
  orologio: <Clock {...I} size={14} />,
  pausa: <Pause {...I} size={14} weight="fill" />,
  storno: <Prohibit {...I} size={14} />,
  esci: <SignOut {...I} size={18} />,
  cancella: <Backspace {...I} size={24} />,
  cucina: <CookingPot {...I} size={18} />,
  bar: <Wine {...I} size={18} />,
  sala: <ForkKnife {...I} size={18} />,
};

/** Indicatore stato stampanti: legge la coda (lavori in coda / in errore per stampante). */
export function StatoStampanti({ compatto = false }: { compatto?: boolean }) {
  const { stampanti, lavori } = useDati((db) => ({ stampanti: db.setup().stampanti, lavori: db.lavori() }));
  const stato = (id: string) => {
    const miei = lavori.filter((j) => j.stampanteId === id);
    // Conta com'è andata l'ultima stampa: un errore di stamattina, seguito da stampe riuscite, non è più un problema.
    // Uno scontrino "da verificare" invece resta in evidenza finché qualcuno non lo controlla.
    const ultima = [...miei].filter((j) => j.stato === 'stampato' || j.stato === 'errore').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const errore = miei.find((j) => j.stato === 'da_verificare') ?? (ultima?.stato === 'errore' ? ultima : undefined);
    const inCoda = miei.filter((j) => j.stato === 'in_coda' || j.stato === 'preso').length;
    return errore ? { cls: 'bg-danger', testo: errore.stato === 'da_verificare' ? 'da verificare' : 'errore' } : inCoda ? { cls: 'bg-warning', testo: `${inCoda} in coda` } : { cls: 'bg-success', testo: '' };
  };
  if (compatto) {
    const problemi = stampanti.filter((s) => stato(s.id).cls === 'bg-danger');
    const coda = stampanti.some((s) => stato(s.id).cls === 'bg-warning');
    return (
      <span aria-live="polite" className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <i aria-hidden="true" className={`block h-2.5 w-2.5 rounded-pill ${problemi.length ? 'bg-danger' : coda ? 'bg-warning' : 'bg-success'}`} />
        <span className={problemi.length ? 'text-danger' : 'sr-only'}>{problemi.length ? problemi.map((s) => s.nome).join(', ') : 'Stampanti pronte'}</span>
      </span>
    );
  }
  return (
    <ul aria-label="Stato stampanti" aria-live="polite" className="flex gap-3 text-xs font-semibold text-text-muted">
      {stampanti.map((s) => {
        const st = stato(s.id);
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            <i className={`block h-2 w-2 rounded-pill ${st.cls}`} aria-hidden="true" />
            <span className={st.cls === 'bg-danger' ? 'text-danger' : ''}>{s.nome}{st.testo ? ` · ${st.testo}` : ''}</span>
            <span className="sr-only">{st.testo || 'pronta'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tastierino numerico. */
export function Tastierino({ onTasto }: { onTasto: (t: string) => void }) {
  const tasti = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', ','];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tasti.map((t) => (
        <Fragment key={t}>
          <button type="button" onClick={() => onTasto(t)} className="premibile h-14 rounded-md bg-surface-2 text-xl font-semibold tabular-nums">{t}</button>
        </Fragment>
      ))}
    </div>
  );
}

/** Foglio: sale dal basso sul palmare, compare al centro su cassa. Dialog nativo: focus intrappolato, Esc chiude. */
export function Foglio({ aperto, onChiudi, titolo, children, piede }: { aperto: boolean; onChiudi: () => void; titolo: string; children: ReactNode; piede?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (aperto && !d.open) d.showModal();
    if (!aperto && d.open) d.close();
  }, [aperto]);
  return (
    <dialog ref={ref} onClose={onChiudi} aria-label={titolo}
      onClick={(e) => { if (e.target === ref.current) onChiudi(); }}
      className="foglio m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-lg border border-border bg-surface p-0 text-text shadow-pop sm:m-auto sm:w-[540px] sm:rounded-lg">
      <div className="flex max-h-[92dvh] flex-col">
        <div className="mx-auto mt-2 h-1 w-10 flex-none rounded-pill bg-border-input sm:hidden" aria-hidden="true" />
        <div className="flex flex-none items-center justify-between px-5 pb-2 pt-3 sm:pt-4">
          <h2 className="text-lg font-semibold">{titolo}</h2>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="premibile grid h-touch w-touch place-items-center rounded-md text-text-muted hover:bg-surface-2">{Icona.chiudi}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {piede && <div className="flex flex-none flex-wrap items-center gap-2 border-t border-border px-5 py-4">{piede}</div>}
      </div>
    </dialog>
  );
}

const ICONA_AVVISO = {
  ok: <CheckCircle size={20} weight="fill" aria-hidden="true" />,
  errore: <WarningCircle size={20} weight="fill" aria-hidden="true" />,
  info: <Info size={20} weight="fill" aria-hidden="true" />,
};

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-auto md:top-16">
      {toasts.map((t) => (
        <div key={t.id} role={t.tipo === 'errore' ? 'alert' : 'status'}
          className={`avviso pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-2.5 rounded-lg px-4 py-3 text-[15px] font-semibold shadow-pop ${t.tipo === 'errore' ? 'bg-danger text-on-danger' : t.tipo === 'ok' ? 'bg-success text-on-success' : 'bg-surface-2 text-text'}`}>
          {ICONA_AVVISO[t.tipo]}{t.testo}
        </div>
      ))}
    </div>
  );
}

export function useConferma() {
  const [stato, set] = useState<{ testo: string; azione: string; ok: () => void } | null>(null);
  const ui = (
    <Foglio aperto={!!stato} onChiudi={() => set(null)} titolo="Conferma">
      <p className="mb-5 text-base text-text-muted">{stato?.testo}</p>
      <div className="flex justify-end gap-2">
        <Pulsante onClick={() => set(null)}>Annulla</Pulsante>
        <Pulsante variante="pericolo" onClick={() => { stato?.ok(); set(null); }}>{stato?.azione ?? 'Conferma'}</Pulsante>
      </div>
    </Foglio>
  );
  return { chiedi: (testo: string, ok: () => void, azione = 'Conferma') => set({ testo, ok, azione }), ui };
}

export const IconaCentro = ({ nome }: { nome: string }) => (/bar/i.test(nome) ? Icona.bar : Icona.cucina);
export { Check, CheckCircle, Clock, Warning };
