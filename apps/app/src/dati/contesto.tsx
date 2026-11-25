import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CodaStampa, FakeDataLayer, seedMoorea, type DataLayer, type Operatore, type TrasportoSimulato } from '@gr/core';
import { creaTrasporto, inTauri } from './trasporto';
import { SupabaseDataLayer, supabase, supabaseConfigurato } from './supabase';

export type Modalita = 'demo' | 'locale';

interface Ctx {
  db: DataLayer;
  modalita: Modalita;
  simulato?: TrasportoSimulato;
  stampaDaQui: boolean;
  operatore: Operatore | null;
  setOperatore: (o: Operatore | null) => void;
  toast: (t: { testo: string; tipo?: 'ok' | 'errore' | 'info' }) => void;
  toasts: { id: number; testo: string; tipo: 'ok' | 'errore' | 'info' }[];
  scollega: () => Promise<void>;
}

const C = createContext<Ctx | null>(null);
const CHIAVE_MODALITA = 'gr.modalita';

/** Stampa da questo dispositivo? Sì sull'app Windows di cassa (e nella demo); mai da un browser col database vero,
 *  salvo per le prove: localStorage "gr.stampa" = "simulata" (la carta finisce nel pannello Carta). */
const deveStampare = (m: Modalita) => m === 'demo' || inTauri() || localStorage.getItem('gr.stampa') === 'simulata';

type Stato =
  | { fase: 'avvio' }
  | { fase: 'collega'; errore?: string }
  | { fase: 'pronto'; db: DataLayer; modalita: Modalita; simulato?: TrasportoSimulato };

export function DatiProvider({ children, schermataCollega }: { children: ReactNode; schermataCollega: (p: { onDemo: () => void; onCollegato: () => void; errore?: string }) => ReactNode }) {
  const [stato, setStato] = useState<Stato>({ fase: 'avvio' });
  const [operatore, setOperatore] = useState<Operatore | null>(null);
  const [toasts, setToasts] = useState<Ctx['toasts']>([]);
  const fermaCoda = useRef<(() => void) | undefined>(undefined);

  const pronto = useCallback((db: DataLayer, modalita: Modalita) => {
    fermaCoda.current?.();
    let simulato: TrasportoSimulato | undefined;
    if (deveStampare(modalita)) {
      const t = creaTrasporto();
      simulato = t.simulato;
      fermaCoda.current = new CodaStampa(db, t.trasporto).avvia(modalita === 'demo' ? 500 : 1500);
    }
    setStato({ fase: 'pronto', db, modalita, simulato });
  }, []);

  const avviaDemo = useCallback(() => {
    localStorage.setItem(CHIAVE_MODALITA, 'demo');
    pronto(new FakeDataLayer(seedMoorea()), 'demo');
  }, [pronto]);

  const avviaLocale = useCallback(async () => {
    try {
      localStorage.setItem(CHIAVE_MODALITA, 'locale');
      pronto(await SupabaseDataLayer.avvia(), 'locale');
    } catch (e) {
      setStato({ fase: 'collega', errore: (e as Error).message });
    }
  }, [pronto]);

  useEffect(() => {
    (async () => {
      const scelta = localStorage.getItem(CHIAVE_MODALITA);
      if (!supabaseConfigurato() || scelta === 'demo') return avviaDemo();
      const { data } = await supabase().auth.getSession();
      if (data.session) await avviaLocale();
      else setStato({ fase: 'collega' });
    })();
    return () => fermaCoda.current?.();
  }, [avviaDemo, avviaLocale]);

  const toast: Ctx['toast'] = useCallback(({ testo, tipo = 'info' }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, testo, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'errore' ? 7000 : 2400);
  }, []);

  const scollega = useCallback(async () => {
    fermaCoda.current?.();
    localStorage.removeItem(CHIAVE_MODALITA);
    if (supabaseConfigurato()) await supabase().auth.signOut();
    setOperatore(null);
    setStato(supabaseConfigurato() ? { fase: 'collega' } : { fase: 'avvio' });
    if (!supabaseConfigurato()) avviaDemo();
  }, [avviaDemo]);

  if (stato.fase === 'avvio') {
    return (
      <main className="grid h-full place-items-center bg-bg text-text-muted" aria-busy="true">
        <p className="text-base">Avvio in corso…</p>
      </main>
    );
  }
  if (stato.fase === 'collega') {
    return <>{schermataCollega({ onDemo: avviaDemo, onCollegato: () => void avviaLocale(), errore: stato.errore })}</>;
  }
  return (
    <C.Provider value={{
      db: stato.db, modalita: stato.modalita, simulato: stato.simulato, stampaDaQui: deveStampare(stato.modalita),
      operatore, setOperatore, toast, toasts, scollega,
    }}>{children}</C.Provider>
  );
}

export function useApp() {
  const c = useContext(C);
  if (!c) throw new Error('DatiProvider mancante');
  return c;
}

/** Rilegge dal livello dati a ogni modifica (in memoria o in tempo reale dal database). */
export function useDati<T>(sel: (db: ReturnType<typeof useApp>['db']) => T): T {
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

/** Esegue un'azione asincrona mostrando l'errore in un avviso. Restituisce true se è andata. */
export function useAzione() {
  const { toast } = useApp();
  const [inCorso, setInCorso] = useState(false);
  const esegui = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setInCorso(true);
    try { await fn(); if (ok) toast({ testo: ok, tipo: 'ok' }); return true; }
    catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); return false; }
    finally { setInCorso(false); }
  }, [toast]);
  return { esegui, inCorso };
}

export const nuovaChiave = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random());
