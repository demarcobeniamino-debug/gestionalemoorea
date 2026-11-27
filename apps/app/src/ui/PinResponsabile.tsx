// Autorizzazione al volo: un responsabile mette il suo PIN sul dispositivo del cameriere.
import type { DataLayer, Operatore } from '@gr/core';
import { puoGestire } from '../dati/ruoli';
import { Icona } from './primitivi';

export function TastierinoPin({ pin, onCambia, etichetta = 'PIN del responsabile' }: { pin: string; onCambia: (p: string) => void; etichetta?: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-text-muted">{etichetta}</p>
      <output className="mb-2 block h-10 rounded-md bg-bg px-3 text-2xl leading-10 tracking-[0.5em]" aria-label="PIN inserito">{'•'.repeat(pin.length)}</output>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((t, i) => t === '' ? <span key={i} /> : (
          <button key={t} type="button" aria-label={t === 'del' ? 'Cancella' : t}
            onClick={() => onCambia(t === 'del' ? pin.slice(0, -1) : (pin + t).slice(0, 6))}
            className="premibile grid h-12 place-items-center rounded-md bg-surface-2 text-xl font-semibold tabular-nums">{t === 'del' ? Icona.cancella : t}</button>
        ))}
      </div>
    </div>
  );
}

/** Restituisce il responsabile se il PIN è suo, altrimenti null. */
export async function verificaResponsabile(db: DataLayer, pin: string): Promise<Operatore | null> {
  if (!pin) return null;
  const r = await db.login(pin);
  return r && puoGestire(r.ruolo) ? r : null;
}
