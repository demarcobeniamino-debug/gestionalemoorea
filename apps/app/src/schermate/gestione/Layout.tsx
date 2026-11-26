// Pannello Gestione: menu a sinistra (o in alto sul telefono) e la sezione scelta.
// Solo per i responsabili: i camerieri vedono un messaggio e tornano in sala.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Armchair, Basket, ClockCounterClockwise, ForkKnife, ListPlus, Swatches, Truck } from '@phosphor-icons/react';
import type { Tabelle } from '@gr/core';
import { useApp, useAzione } from '../../dati/contesto';
import { Testata } from '../../ui/Testata';
import { Pulsante } from '../../ui/primitivi';

export const puoGestire = (ruolo?: string) => ruolo === 'responsabile' || ruolo === 'admin';

const I = { size: 20, weight: 'bold' as const, 'aria-hidden': true };
const VOCI: { a: string; testo: string; icona: ReactNode; gruppo: string }[] = [
  { a: 'articoli', testo: 'Articoli', icona: <ForkKnife {...I} />, gruppo: 'Menu' },
  { a: 'categorie', testo: 'Categorie', icona: <Swatches {...I} />, gruppo: 'Menu' },
  { a: 'varianti', testo: 'Varianti', icona: <ListPlus {...I} />, gruppo: 'Menu' },
  { a: 'sale', testo: 'Sale e tavoli', icona: <Armchair {...I} />, gruppo: 'Sala' },
  { a: 'magazzino', testo: 'Scorte', icona: <Basket {...I} />, gruppo: 'Magazzino' },
  { a: 'movimenti', testo: 'Movimenti', icona: <ClockCounterClockwise {...I} />, gruppo: 'Magazzino' },
  { a: 'fornitori', testo: 'Fornitori', icona: <Truck {...I} />, gruppo: 'Magazzino' },
];

/** Tabelle della Gestione, aggiornate a ogni salvataggio. */
export function useTabelle(): Tabelle {
  const { archivio } = useApp();
  const [, forza] = useState(0);
  useEffect(() => archivio.subscribe(() => forza((n) => n + 1)), [archivio]);
  return archivio.tabelle();
}

/** Salva con l'avviso di conferma o di errore. */
export function useSalva() {
  const { archivio } = useApp();
  const { esegui, inCorso } = useAzione();
  return { archivio, esegui, inCorso };
}

export function GestioneLayout() {
  const { archivio, operatore } = useApp();
  const [stato, setStato] = useState<'carica' | 'pronto' | { errore: string }>('carica');

  const carica = useCallback(async () => {
    setStato('carica');
    try { await archivio.ricarica(); setStato('pronto'); }
    catch (e) { setStato({ errore: (e as Error).message }); }
  }, [archivio]);
  useEffect(() => { void carica(); }, [carica]);

  if (!puoGestire(operatore?.ruolo)) {
    return (
      <main className="grid h-full place-items-center bg-bg p-6 text-text">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-bold">Solo per i responsabili</h1>
          <p className="mb-6 text-text-muted">La Gestione di menu, sale e magazzino è riservata a chi ha il ruolo di responsabile.</p>
          <Link to="/sala" className="premibile inline-flex h-touch items-center rounded-md bg-surface-2 px-5 font-semibold">Torna alla sala</Link>
        </div>
      </main>
    );
  }

  const gruppi = [...new Set(VOCI.map((v) => v.gruppo))];
  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata titolo="Gestione" sotto="Menu, sale e magazzino" indietro="/sala" />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Sezioni della Gestione"
          className="flex flex-none gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4">
          {gruppi.map((g) => (
            <div key={g} className="contents md:mb-4 md:block">
              <p className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted md:block">{g}</p>
              {VOCI.filter((v) => v.gruppo === g).map((v) => (
                <NavLink key={v.a} to={v.a}
                  className={({ isActive }) => `premibile flex h-11 flex-none items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[15px] font-semibold transition-colors duration-fast ${isActive ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text'}`}>
                  {v.icona}{v.testo}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {stato === 'carica' ? <Caricamento /> : typeof stato === 'object' ? (
            <div className="mx-auto max-w-md p-8 text-center">
              <p className="mb-4 text-base text-text-muted">Non riesco a leggere i dati: {stato.errore}</p>
              <Pulsante onClick={() => void carica()}>Riprova</Pulsante>
            </div>
          ) : <Outlet />}
        </main>
      </div>
    </div>
  );
}

function Caricamento() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6" aria-busy="true" aria-label="Caricamento">
      <div className="scheletro mb-6 h-9 w-48 rounded-md" />
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="scheletro mb-2 h-16 rounded-md" />)}
    </div>
  );
}

/** Intestazione di sezione: titolo, conteggio e azione principale. */
export function Sezione({ titolo, sotto, azioni, children }: { titolo: string; sotto?: ReactNode; azioni?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-4 pb-24 md:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{titolo}</h2>
          {sotto && <p className="mt-0.5 text-sm text-text-muted">{sotto}</p>}
        </div>
        <div className="flex flex-wrap gap-2">{azioni}</div>
      </div>
      {children}
    </div>
  );
}

/** Stato vuoto con l'azione per riempirlo. */
export function Vuoto({ titolo, testo, azione }: { titolo: string; testo: string; azione?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-input px-6 py-12 text-center">
      <p className="mb-1 text-lg font-semibold">{titolo}</p>
      <p className="mx-auto mb-5 max-w-sm text-text-muted">{testo}</p>
      {azione}
    </div>
  );
}
