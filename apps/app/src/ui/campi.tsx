// Campi dei moduli della Gestione. Stessa regola dei raggi: campi = md, chip = pill.
import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { euro, parseEuro } from '@gr/core';

const BASE = 'h-touch w-full rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text outline-none transition-colors duration-fast focus:border-focus aria-[invalid=true]:border-danger';

export function Campo({ etichetta, aiuto, errore, children, className = '' }: {
  etichetta: string; aiuto?: ReactNode; errore?: string | null; children: (id: string, descr?: string) => ReactNode; className?: string;
}) {
  const id = useId();
  const descr = errore || aiuto ? `${id}-d` : undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-text-muted">{etichetta}</label>
      {children(id, descr)}
      {errore ? <p id={descr} className="text-sm font-semibold text-danger">{errore}</p>
        : aiuto ? <p id={descr} className="text-xs text-text-muted">{aiuto}</p> : null}
    </div>
  );
}

export function Testo({ etichetta, aiuto, errore, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { etichetta: string; aiuto?: ReactNode; errore?: string | null }) {
  return (
    <Campo etichetta={etichetta} aiuto={aiuto} errore={errore} className={className}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errore || undefined} className={BASE} {...p} />}
    </Campo>
  );
}

export function Seleziona({ etichetta, aiuto, opzioni, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & {
  etichetta: string; aiuto?: ReactNode; opzioni: { valore: string; testo: string }[];
}) {
  return (
    <Campo etichetta={etichetta} aiuto={aiuto} className={className}>
      {(id, d) => (
        <select id={id} aria-describedby={d} className={`${BASE} appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9`}
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27%23a3acba%27 stroke-width=%272%27%3E%3Cpath d=%27M4 6l4 4 4-4%27/%3E%3C/svg%3E")' }} {...p}>
          {opzioni.map((o) => <option key={o.valore} value={o.valore}>{o.testo}</option>)}
        </select>
      )}
    </Campo>
  );
}

/** Importo in euro: si scrive "16,50"; restituisce centesimi (null se non valido). */
export function CampoEuro({ etichetta, valore, onCambia, aiuto, className }: {
  etichetta: string; valore: number | null; onCambia: (cents: number | null) => void; aiuto?: ReactNode; className?: string;
}) {
  const [testo, setTesto] = useState(valore == null ? '' : euro(valore, false));
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => { setTesto(valore == null ? '' : euro(valore, false)); }, [valore]);
  return (
    <Campo etichetta={etichetta} aiuto={aiuto} errore={errore} className={className}>
      {(id, d) => (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">€</span>
          <input id={id} aria-describedby={d} aria-invalid={!!errore || undefined} inputMode="decimal" autoComplete="off"
            className={`${BASE} pl-7 tabular-nums`} value={testo} placeholder="0,00"
            onChange={(e) => setTesto(e.target.value)}
            onBlur={() => {
              if (testo.trim() === '') { setErrore(null); onCambia(null); return; }
              try { const c = parseEuro(testo); setErrore(null); onCambia(c); setTesto(euro(c, false)); }
              catch { setErrore('Scrivi un importo, per esempio 16,50'); onCambia(null); }
            }} />
        </div>
      )}
    </Campo>
  );
}

/** Numero con virgola (quantità in kg, l, pz). */
export function CampoNumero({ etichetta, valore, onCambia, unita, aiuto, className, min = 0 }: {
  etichetta: string; valore: number | null; onCambia: (n: number | null) => void; unita?: string; aiuto?: ReactNode; className?: string; min?: number;
}) {
  const fmt = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));
  const [testo, setTesto] = useState(fmt(valore));
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => { setTesto(fmt(valore)); }, [valore]);
  return (
    <Campo etichetta={etichetta} aiuto={aiuto} errore={errore} className={className}>
      {(id, d) => (
        <div className="relative">
          <input id={id} aria-describedby={d} aria-invalid={!!errore || undefined} inputMode="decimal" autoComplete="off"
            className={`${BASE} tabular-nums ${unita ? 'pr-12' : ''}`} value={testo}
            onChange={(e) => setTesto(e.target.value)}
            onBlur={() => {
              const t = testo.trim().replace(',', '.');
              if (t === '') { setErrore(null); onCambia(null); return; }
              const n = Number(t);
              if (!Number.isFinite(n) || n < min) { setErrore('Numero non valido'); onCambia(null); return; }
              setErrore(null); onCambia(n);
            }} />
          {unita && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">{unita}</span>}
        </div>
      )}
    </Campo>
  );
}

export function Interruttore({ etichetta, descrizione, attivo, onCambia }: { etichetta: string; descrizione?: string; attivo: boolean; onCambia: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={attivo} onClick={() => onCambia(!attivo)}
      className="premibile flex min-h-touch w-full items-center justify-between gap-4 rounded-md bg-bg px-3 py-2 text-left">
      <span className="flex flex-col">
        <span className="text-base font-semibold">{etichetta}</span>
        {descrizione && <span className="text-sm text-text-muted">{descrizione}</span>}
      </span>
      <span aria-hidden="true" className={`relative h-7 w-12 flex-none rounded-pill transition-colors duration-fast ${attivo ? 'bg-accent' : 'bg-surface-2 ring-1 ring-inset ring-border-input'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-pill bg-text transition-transform duration-fast ease-out ${attivo ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

/** Chip selezionabile (allergeni, varianti, filtri). */
export function Chip({ attivo, onClick, children, tono = 'accent' }: { attivo: boolean; onClick: () => void; children: ReactNode; tono?: 'accent' | 'allergene' }) {
  const on = tono === 'allergene' ? 'bg-allergene text-on-allergene border-allergene' : 'bg-accent text-on-accent border-accent';
  return (
    <button type="button" aria-pressed={attivo} onClick={onClick}
      className={`premibile inline-flex h-10 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-semibold transition-colors duration-fast ${attivo ? on : 'border-border-input bg-bg text-text'}`}>
      {children}
    </button>
  );
}

/** Scelta tra poche opzioni (tipo di movimento, forma del tavolo). */
export function Segmenti<T extends string>({ etichetta, valore, opzioni, onCambia }: { etichetta: string; valore: T; opzioni: { valore: T; testo: string }[]; onCambia: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={etichetta} className="flex flex-wrap gap-1 rounded-md bg-bg p-1">
      {opzioni.map((o) => (
        <button key={o.valore} type="button" role="radio" aria-checked={o.valore === valore} onClick={() => onCambia(o.valore)}
          className={`premibile h-10 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors duration-fast ${o.valore === valore ? 'bg-surface-2 text-text shadow-card' : 'text-text-muted'}`}>
          {o.testo}
        </button>
      ))}
    </div>
  );
}

/** Ricerca nelle liste. */
export function Cerca({ valore, onCambia, segnaposto }: { valore: string; onCambia: (v: string) => void; segnaposto: string }) {
  return (
    <input type="search" value={valore} onChange={(e) => onCambia(e.target.value)} placeholder={segnaposto} aria-label={segnaposto}
      className={`${BASE} max-w-sm`} />
  );
}
