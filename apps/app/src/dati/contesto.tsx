import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CodaStampa, FakeDataLayer, seedMoorea, type DataLayer, type TrasportoSimulato } from '@gr/core';
import { creaTrasporto } from './trasporto';

interface Ctx {
  db: DataLayer;
  simulato?: TrasportoSimulato;
  operatore: { nome: string; ruolo: string } | null;
  setOperatore: (o: { nome: string; ruolo: string } | null) => void;
  toast: (t: { testo: string; tipo?: 'ok' | 'errore' | 'info' }) => void;
  toasts: { id: number; testo: string; tipo: 'ok' | 'errore' | 'info' }[];
}

const C = createContext<Ctx | null>(null);

export function DatiProvider({ children }: { children: ReactNode }) {
  const valore = useMemo(() => {
    const db = new FakeDataLayer(seedMoorea());
    const { trasporto, simulato } = creaTrasporto();
    const coda = new CodaStampa(db, trasporto);
    return { db, simulato, coda };
  }, []);
  useEffect(() => valore.coda.avvia(), [valore]);

  const [operatore, setOperatore] = useState<{ nome: string; ruolo: string } | null>(null);
  const [toasts, setToasts] = useState<Ctx['toasts']>([]);
  const toast: Ctx['toast'] = ({ testo, tipo = 'info' }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, testo, tipo }]);
    if (tipo !== 'errore') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
    else setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
  };

  return <C.Provider value={{ db: valore.db, simulato: valore.simulato, operatore, setOperatore, toast, toasts }}>{children}</C.Provider>;
}

export function useApp() {
  const c = useContext(C);
  if (!c) throw new Error('DatiProvider mancante');
  return c;
}

/** Rilegge dal livello dati a ogni modifica (in memoria ora, Realtime con Supabase dopo). */
export function useDati<T>(sel: (db: DataLayer) => T): T {
  const { db } = useApp();
  const [, forza] = useState(0);
  useEffect(() => db.subscribe(() => forza((n) => n + 1)), [db]);
  return sel(db);
}

/** Orologio che fa ridisegnare minuti trascorsi e ora in testata. */
export function useOra(ogniMs = 15000) {
  const [ora, setOra] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setOra(new Date()), ogniMs); return () => clearInterval(t); }, [ogniMs]);
  return ora;
}

export const nuovaChiave = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random());
