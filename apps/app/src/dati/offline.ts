// Cassa senza internet: controllo della linea, PIN ricordati sul dispositivo, istantanea e stato salvati sul disco,
// sincronizzazione al ritorno. Solo per l'app di cassa installata (che stampa da sé).
import { datiDaSincronizzare, type CassaOffline, type Istantanea, type Operatore, type StatoOffline } from '@gr/core';
import { supabase } from './supabase';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const K_ISTANTANEA = 'gr.istantanea';
const K_OFFLINE = 'gr.offline';
const K_PIN = 'gr.pinOffline';

/** La linea c'è? Una richiesta leggera al servizio, con un tempo massimo breve. */
export async function lineaOk(timeoutMs = 4000): Promise<boolean> {
  if (!URL || !KEY) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: KEY }, signal: ctl.signal, cache: 'no-store' });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

const leggi = <T,>(k: string): T | null => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : null; } catch { return null; } };
const scrivi = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* disco pieno: si riprova al prossimo cambio */ } };

export const salvaIstantanea = (i: Istantanea) => scrivi(K_ISTANTANEA, i);
export const ultimaIstantanea = () => leggi<Istantanea>(K_ISTANTANEA);

export const salvaStatoOffline = (base: Istantanea, stato: StatoOffline) => scrivi(K_OFFLINE, { base, stato });
export const statoOfflineSalvato = () => leggi<{ base: Istantanea; stato: StatoOffline }>(K_OFFLINE);
export const pulisciOffline = () => localStorage.removeItem(K_OFFLINE);

async function impronta(pin: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gr:${pin}`));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Dopo un accesso riuscito online: il PIN (solo l'impronta) si ricorda per entrare anche senza linea. */
export async function ricordaPin(pin: string, o: Operatore) {
  const tutti = leggi<Record<string, Operatore>>(K_PIN) ?? {};
  tutti[await impronta(pin)] = o;
  scrivi(K_PIN, tutti);
}
export async function verificaPinOffline(pin: string): Promise<Operatore | null> {
  return (leggi<Record<string, Operatore>>(K_PIN) ?? {})[await impronta(pin)] ?? null;
}

/** Manda al database quello che la cassa ha fatto da sola. Lancia un errore se qualcosa è ancora da chiarire. */
export async function sincronizza(off: CassaOffline): Promise<{ comande: number; documenti: number }> {
  const s = off.stato();
  if (s.documenti.some((d) => d.stato === 'in_emissione' || d.stato === 'da_verificare'))
    throw new Error('C’è uno scontrino in stampa o da verificare: chiariscilo in Cassa → Invio scontrini, poi la cassa rimanda tutto.');
  const p = datiDaSincronizzare(off.base, s);
  if (p.vuoto) return { comande: 0, documenti: 0 };
  const { data, error } = await supabase().rpc('importa_offline', { p_locale: off.base.localeId, p });
  if (error) throw new Error(`Sincronizzazione non riuscita: ${error.message}`);
  return data as { comande: number; documenti: number };
}
