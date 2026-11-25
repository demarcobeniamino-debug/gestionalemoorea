import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useOra } from '../dati/contesto';
import { Icona, StatoStampanti } from './primitivi';

export function Testata({ titolo, sotto, indietro, children }: { titolo: ReactNode; sotto?: ReactNode; indietro?: string; children?: ReactNode }) {
  const { operatore, setOperatore } = useApp();
  const ora = useOra();
  const nav = useNavigate();
  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-3 md:px-4">
      {indietro && (
        <Link to={indietro} aria-label="Indietro" className="grid h-10 w-10 place-items-center rounded-md bg-surface-2">{Icona.indietro}</Link>
      )}
      <div className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-3">
        <h1 className="truncate text-lg font-bold md:text-xl">{titolo}</h1>
        {sotto && <span className="truncate text-xs font-medium text-text-muted md:text-sm">{sotto}</span>}
      </div>
      <div className="flex-1" />
      {children}
      <div className="hidden lg:block"><StatoStampanti /></div>
      <div className="lg:hidden"><StatoStampanti compatto /></div>
      {operatore && (
        <button type="button" onClick={() => { setOperatore(null); nav('/accesso'); }}
          className="hidden h-10 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-sm font-semibold sm:flex"
          aria-label={`Operatore ${operatore.nome}: tocca per cambiare`}>
          {Icona.utente}{operatore.nome}
        </button>
      )}
      <time className="hidden text-xl font-semibold tabular-nums md:block">
        {ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </time>
    </header>
  );
}
