// Sceglie come escono i ticket:
// - dentro l'app Windows (Tauri) → comandi Rust che parlano con stampanti ed Epson in LAN;
// - nel browser o su Android → trasporto simulato (la carta si vede a schermo).
//   Su Android i palmari non stampano: mettono in coda e stampa la cassa (con il database vero).
import { TrasportoSimulato, TrasportoIncerto, type Trasporto } from '@gr/core';

export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

class TrasportoTauri implements Trasporto {
  async inviaTcp(host: string, porta: number, dati: Uint8Array, timeoutMs: number) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tcp_send', { host, port: porta, data: Array.from(dati), timeoutMs });
  }
  async postXml(url: string, xml: string, timeoutMs: number) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke<string>('http_post_xml', { url, body: xml, timeoutMs });
    } catch (e) {
      const msg = String(e);
      // Il lato Rust distingue "non partito" da "partito ma risposta persa".
      if (msg.startsWith('INCERTO')) throw new TrasportoIncerto(msg);
      throw new Error(msg);
    }
  }
}

export function creaTrasporto(): { trasporto: Trasporto; simulato?: TrasportoSimulato } {
  if (inTauri()) return { trasporto: new TrasportoTauri() };
  const simulato = new TrasportoSimulato();
  return { trasporto: simulato, simulato };
}

/** Ricerca delle stampanti in rete: solo dalla cassa installata (il browser non vede la LAN). */
export async function cercaStampanti(rete?: string): Promise<{ rete: string; trovate: import('@gr/core').Trovata[] }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('cerca_stampanti', { rete: rete || null });
}

/** Demo: una rete finta con le stampanti del Moorea, una nuova e un router. */
export async function cercaStampantiDemo(): Promise<{ rete: string; trovate: import('@gr/core').Trovata[] }> {
  await new Promise((r) => setTimeout(r, 1800));
  return {
    rete: '192.168.1',
    trovate: [
      { ip: '192.168.1.1', porta: 80, genere: 'web', dettaglio: 'Router TIM' },
      { ip: '192.168.1.101', porta: 9100, genere: 'escpos', marca: 'MATCHPOWER', modello: null },
      { ip: '192.168.1.102', porta: 9100, genere: 'escpos', marca: 'MATCHPOWER', modello: null },
      { ip: '192.168.1.103', porta: 9100, genere: 'escpos', marca: 'MATCHPOWER', modello: null },
      { ip: '192.168.1.110', porta: 80, genere: 'epson_rt', marca: 'EPSON', modello: 'FP-81', dettaglio: 'EPSON FP-81 II RT' },
      { ip: '192.168.1.120', porta: 9100, genere: 'porta9100' },
    ],
  };
}

/** Pagamento sul POS collegato (Protocollo 17). Solo dall'app di cassa; nella demo si simula. */
export async function pagaSulPos(pos: import('@gr/core').PosConfig, importoCents: number, demo: boolean): Promise<import('@gr/core').EsitoPos> {
  const { conferma, incornicia, leggiEsitoPos, messaggioPagamento } = await import('@gr/core');
  if (!inTauri()) {
    if (!demo) throw new Error('Il POS si comanda solo dalla cassa installata sul computer del locale');
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true, codice: '00', carta: '**** 4242', lettura: 'CLI', autorizzazione: 'DEMO01', tipoCarta: 'credito' };
  }
  if (!pos.host || !pos.porta) throw new Error(`Manca l'indirizzo del POS ${pos.nome} (Gestione → Pagamenti)`);
  const { invoke } = await import('@tauri-apps/api/core');
  const chiave = `gr.pos.lrc.${pos.id}`;
  const prova = async (v: 'senza_stx' | 'con_stx') => {
    const msg = messaggioPagamento({ terminale: pos.terminale, cassa: '1', importoCents });
    const r = await invoke<number[]>('pos_scambio', { host: pos.host, port: pos.porta, richiesta: Array.from(incornicia(msg, v)), conferma: Array.from(conferma(v)), timeoutMs: 180_000 });
    localStorage.setItem(chiave, v);
    return leggiEsitoPos(String.fromCharCode(...r));
  };
  const prima = (localStorage.getItem(chiave) as 'senza_stx' | 'con_stx' | null) ?? 'senza_stx';
  try { return await prova(prima); }
  catch (e) {
    const msg = String(e);
    // Il POS ha scartato la richiesta per il controllo (NAK): si prova l'altro calcolo una volta sola.
    if (msg.includes('NAK')) return prova(prima === 'senza_stx' ? 'con_stx' : 'senza_stx');
    throw new Error(msg);
  }
}
