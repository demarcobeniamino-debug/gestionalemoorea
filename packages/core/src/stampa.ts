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
  constructor(private db: DataLayer, private trasporto: Trasporto, private opzioni = { tentativiComande: 3 }) {}

  avvia(intervalloMs = 500) {
    this.timer = setInterval(() => void this.elabora(), intervalloMs);
    const unsub = this.db.subscribe(() => void this.elabora());
    return () => { clearInterval(this.timer); unsub(); };
  }

  async elabora() {
    if (this.occupato) return;
    this.occupato = true;
    try {
      for (const j of this.db.lavori().filter((x) => x.stato === 'in_coda' || (x.stato === 'errore' && x.tipo !== 'documento_commerciale' && x.tentativi < this.opzioni.tentativiComande))) {
        await this.esegui(j);
      }
    } finally { this.occupato = false; }
  }

  private stampante(id: string): Stampante {
    const s = this.db.setup().stampanti.find((x) => x.id === id);
    if (!s) throw new Error(`Stampante ${id} non configurata`);
    return s;
  }

  async esegui(j: PrintJob) {
    const st = this.stampante(j.stampanteId);
    if (j.tipo === 'comanda' || j.tipo === 'preconto') {
      try {
        const dati = renderEscPos(j.ticket!, { colonne: st.colonne });
        await this.trasporto.inviaTcp(st.host, st.porta, dati, 5000);
        this.db.esitoLavoro(j.id, { ok: true });
      } catch (e) {
        this.db.esitoLavoro(j.id, { ok: false, errore: `${st.nome}: ${(e as Error).message}` });
      }
      return;
    }
    // Fiscale
    try {
      const corpo = await this.trasporto.postXml(urlFpMate({ host: st.host }), j.xml!, 15000);
      const r = leggiRispostaEpson(corpo);
      if (r.ok) this.db.esitoLavoro(j.id, { ok: true, zNumero: r.zNumero, docNumero: r.numeroDocumento, data: r.data });
      else this.db.esitoLavoro(j.id, { ok: false, errore: `Epson: codice ${r.codice || '?'} stato ${r.stato || '?'}` });
    } catch (e) {
      const incerto = e instanceof TrasportoIncerto;
      this.db.esitoLavoro(j.id, {
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
