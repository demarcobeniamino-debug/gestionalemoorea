// Coda di stampa: prende i lavori e li manda alle stampanti tramite un "trasporto".
// - App di cassa (Tauri): trasporto reale, TCP 9100 verso le Matchpower e HTTP verso l'Epson.
// - Browser / sviluppo: trasporto simulato, mostra la carta a schermo.
// Regola d'oro: un lavoro fiscale NON si ripete mai da solo. Se la risposta si perde va "da verificare".

import type { DataLayer } from './data';
import type { PrintJob, Stampante } from './types';
import { renderEscPos } from './ticket';
import { leggiRispostaEpson, urlFpMate } from './epson';

export interface Trasporto {
  /** Byte grezzi su TCP (ESC/POS). Errore = non è uscito niente. */
  inviaTcp(host: string, porta: number, dati: Uint8Array, timeoutMs: number): Promise<void>;
  /** POST di un XML; restituisce il corpo. `TrasportoIncerto` se la richiesta è partita ma la risposta non è arrivata. */
  postXml(url: string, xml: string, timeoutMs: number): Promise<string>;
}

export class TrasportoIncerto extends Error {}

export class CodaStampa {
  private occupato = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private db: DataLayer, private trasporto: Trasporto) {}

  avvia(intervalloMs = 500) {
    this.timer = setInterval(() => void this.elabora(), intervalloMs);
    const unsub = this.db.subscribe(() => void this.elabora());
    return () => { clearInterval(this.timer); unsub(); };
  }

  async elabora() {
    if (this.occupato) return;
    this.occupato = true;
    try {
      // Il livello dati "prende" i lavori: con il database li riceve un solo dispositivo (la cassa).
      for (const j of await this.db.prendiLavori(10)) await this.esegui(j);
    } finally { this.occupato = false; }
  }

  private stampante(id: string): Stampante {
    const s = this.db.setup().stampanti.find((x) => x.id === id);
    if (!s) throw new Error(`Stampante ${id} non configurata`);
    return s;
  }

  async esegui(j: PrintJob) {
    const st = this.stampante(j.stampanteId);
    if (j.ticket) {
      try {
        const dati = renderEscPos(j.ticket!, { colonne: st.colonne, codePage: st.codePage });
        await this.trasporto.inviaTcp(st.host, st.porta, dati, 5000);
        await this.db.esitoLavoro(j.id, { ok: true });
      } catch (e) {
        await this.db.esitoLavoro(j.id, { ok: false, errore: `${st.nome}: ${(e as Error).message}` });
      }
      return;
    }
    // Fiscale
    try {
      const corpo = await this.trasporto.postXml(urlFpMate({ host: st.host }), j.xml!, 15000);
      const r = leggiRispostaEpson(corpo);
      if (r.ok) await this.db.esitoLavoro(j.id, { ok: true, zNumero: r.zNumero, docNumero: r.numeroDocumento, data: r.data, matricola: st.matricolaRt });
      else await this.db.esitoLavoro(j.id, { ok: false, errore: `Epson: codice ${r.codice || '?'} stato ${r.stato || '?'}` });
    } catch (e) {
      const incerto = e instanceof TrasportoIncerto;
      await this.db.esitoLavoro(j.id, {
        ok: false, incerto,
        errore: incerto ? 'Risposta del registratore persa: controlla se lo scontrino è uscito prima di riprovare'
                        : `Cassa RT non raggiungibile: ${(e as Error).message}`,
      });
    }
  }
}

/** Trasporto per lo sviluppo: tiene la "carta" in memoria e simula l'Epson. */
export class TrasportoSimulato implements Trasporto {
  carta: { host: string; quando: Date; dati?: Uint8Array; xml?: string }[] = [];
  private z = 41; private doc = 0;
  guasti: Partial<Record<string, 'offline' | 'incerto'>> = {};
  async inviaTcp(host: string, _porta: number, dati: Uint8Array) {
    await new Promise((r) => setTimeout(r, 150));
    if (this.guasti[host] === 'offline') throw new Error('non risponde');
    this.carta.push({ host, quando: new Date(), dati });
  }
  async postXml(url: string, xml: string) {
    await new Promise((r) => setTimeout(r, 400));
    const host = new URL(url).host;
    if (this.guasti[host] === 'offline') throw new Error('non risponde');
    if (this.guasti[host] === 'incerto') throw new TrasportoIncerto('timeout');
    this.carta.push({ host, quando: new Date(), xml });
    const oggi = new Date();
    const data = `${String(oggi.getDate()).padStart(2, '0')}/${String(oggi.getMonth() + 1).padStart(2, '0')}/${oggi.getFullYear()}`;
    return `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><response success="true" code="" status="2"><addInfo><elementList>lastCommand,printerStatus,fiscalReceiptNumber,fiscalReceiptAmount,fiscalReceiptDate,fiscalReceiptTime,zRepNumber</elementList><lastCommand>74</lastCommand><printerStatus>20110</printerStatus><fiscalReceiptNumber>${++this.doc}</fiscalReceiptNumber><fiscalReceiptAmount>0</fiscalReceiptAmount><fiscalReceiptDate>${data}</fiscalReceiptDate><fiscalReceiptTime>20:51</fiscalReceiptTime><zRepNumber>${this.z}</zRepNumber></addInfo></response></soapenv:Body></soapenv:Envelope>`;
  }
}
