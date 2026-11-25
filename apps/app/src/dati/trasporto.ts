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
