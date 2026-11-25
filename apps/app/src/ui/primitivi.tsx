// Primitivi dell'interfaccia (specifiche in replica/design/components.md). Solo classi dai token.
import { Fragment, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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
      {...p}
      disabled={disabled || caricamento}
      aria-busy={caricamento || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md transition-transform duration-fast ease-base active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTI[variante]} ${TAGLIE[taglia]} ${className}`}
    >
      {caricamento ? <Spinner /> : icona}
      <span>{children}</span>
    </button>
  );
}

export const Spinner = () => (
  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 20" /></svg>
);

/** Icone: tratti semplici disegnati qui (stile Lucide, nessun file esterno). */
export const Icona = {
  indietro: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  stampa: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>,
  scontrino: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>,
  avviso: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  utente: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>,
  cerca: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>,
  chiudi: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  carta: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z" /></svg>,
};

/** Indicatore stato stampanti: legge la coda (lavori in coda / in errore per stampante). */
export function StatoStampanti({ compatto = false }: { compatto?: boolean }) {
  const { stampanti, lavori } = useDati((db) => ({ stampanti: db.setup().stampanti, lavori: db.lavori() }));
  if (compatto) {
    const problemi = stampanti.filter((s) => lavori.some((j) => j.stampanteId === s.id && (j.stato === 'errore' || j.stato === 'da_verificare')));
    const coda = lavori.filter((j) => j.stato === 'in_coda' || j.stato === 'preso').length;
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
        const miei = lavori.filter((j) => j.stampanteId === s.id);
        const errore = miei.find((j) => j.stato === 'errore' || j.stato === 'da_verificare');
        const inCoda = miei.filter((j) => j.stato === 'in_coda' || j.stato === 'preso').length;
        const colore = errore ? 'bg-danger' : inCoda ? 'bg-warning' : 'bg-success';
        const testo = errore ? (errore.stato === 'da_verificare' ? 'da verificare' : 'errore') : inCoda ? `${inCoda} in coda` : '';
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            <i className={`block h-2 w-2 rounded-pill ${colore}`} aria-hidden="true" />
            <span>{s.nome}{testo ? ` · ${testo}` : ''}</span>
            <span className="sr-only">{testo || 'pronta'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tastierino numerico. */
export function Tastierino({ onTasto, extra }: { onTasto: (t: string) => void; extra?: { etichetta: string; valore: string }[] }) {
  const tasti = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', ','];
  return (
    <div className={`grid gap-2 ${extra ? 'grid-cols-4' : 'grid-cols-3'}`}>
      {tasti.map((t, i) => (
        <Fragment key={t}>
          <button type="button" onClick={() => onTasto(t)} className="h-14 rounded-md bg-surface-2 text-xl font-semibold tabular-nums active:scale-[.98]">{t}</button>
          {extra && i % 3 === 2 && (
            <button type="button" onClick={() => onTasto(extra[Math.floor(i / 3)]?.valore ?? '')} className="h-14 rounded-md bg-border text-base font-semibold">
              {extra[Math.floor(i / 3)]?.etichetta}
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Pannello che sale dal basso (palmare) o finestra (cassa). Dialog nativo: focus intrappolato, Esc chiude. */
export function Foglio({ aperto, onChiudi, titolo, children }: { aperto: boolean; onChiudi: () => void; titolo: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (aperto && !d.open) d.showModal();
    if (!aperto && d.open) d.close();
  }, [aperto]);
  return (
    <dialog ref={ref} onClose={onChiudi} aria-label={titolo}
      className="m-0 mt-auto w-full max-w-none rounded-t-lg bg-surface-2 p-0 text-text shadow-pop backdrop:bg-black/60 sm:m-auto sm:w-[520px] sm:rounded-lg">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{titolo}</h2>
        <button type="button" onClick={onChiudi} aria-label="Chiudi" className="grid h-touch w-touch place-items-center rounded-md hover:bg-surface">{Icona.chiudi}</button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div aria-live="assertive" className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} role={t.tipo === 'errore' ? 'alert' : 'status'}
          className={`pointer-events-auto max-w-[90vw] rounded-md px-4 py-3 text-base font-semibold shadow-pop ${t.tipo === 'errore' ? 'bg-danger text-on-danger' : t.tipo === 'ok' ? 'bg-success text-on-success' : 'bg-surface-2 text-text'}`}>
          {t.testo}
        </div>
      ))}
    </div>
  );
}

export function useConferma() {
  const [stato, set] = useState<{ testo: string; ok: () => void } | null>(null);
  const ui = (
    <Foglio aperto={!!stato} onChiudi={() => set(null)} titolo="Conferma">
      <p className="mb-4 text-base">{stato?.testo}</p>
      <div className="flex justify-end gap-2">
        <Pulsante onClick={() => set(null)}>Annulla</Pulsante>
        <Pulsante variante="pericolo" onClick={() => { stato?.ok(); set(null); }}>Conferma</Pulsante>
      </div>
    </Foglio>
  );
  return { chiedi: (testo: string, ok: () => void) => set({ testo, ok }), ui };
}
