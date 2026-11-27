// Coda di stampa: prende i lavori e li manda alle stampanti tramite un "trasporto".
// - App di cassa (Tauri): trasporto reale, TCP 9100 verso le Matchpower e HTTP verso l'Epson.
// - Browser / sviluppo: trasporto simulato, mostra la carta a schermo.
// Regola d'oro: un lavoro fiscale NON si ripete mai da solo. Se la risposta si perde va "da verificare".

import type { DataLayer } from './data';
import type { PrintJob, Stampante } from './types';
import { renderEscPos } from './ticket';
import { erroreEpsonIncerto, leggiRispostaEpson, leggiStato, spiegaErroreEpson, TIMEOUT_Z_MS, urlFpMate, xmlLeggiData, xmlStato, type StatoRt } from './epson';

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

  /**
   * Avvia la coda. Con `ponte` la cassa batte un colpo ogni 30 secondi (gli altri dispositivi sanno che le comande escono)
   * e ogni 5 minuti legge lo stato del registratore (carta, Z da fare, invii all'Agenzia, orologio). Sono solo letture:
   * non stampano nulla e passano dalla stessa fila dei lavori, quindi non si accavallano mai con uno scontrino.
   */
  avvia(intervalloMs = 500, ponte?: { nome: string; versione: string; leggiRt?: boolean }) {
    this.timer = setInterval(() => void this.elabora(), intervalloMs);
    const unsub = this.db.subscribe(() => void this.elabora());
    let battito: ReturnType<typeof setInterval> | undefined;
    if (ponte) {
      let ultimaLettura = 0;
      const batti = async () => {
        let stato: StatoRt | undefined;
        if (ponte.leggiRt && Date.now() - ultimaLettura > 5 * 60_000) {
          ultimaLettura = Date.now();
          stato = await this.leggiRt().catch((e) => ({ letto: new Date().toISOString(), errore: typeof e === 'string' ? e : (e as Error).message } as StatoRt));
        }
        await this.db.battito(ponte.nome, ponte.versione, stato).catch(() => undefined);
      };
      void batti();
      battito = setInterval(() => void batti(), 30_000);
    }
    return () => { clearInterval(this.timer); clearInterval(battito); unsub(); };
  }

  /** Stato del registratore: base (carta, giornale), RT (invii, Z, certificati) e orologio. Aspetta che la fila sia libera. */
  async leggiRt(): Promise<StatoRt | undefined> {
    const rt = this.db.setup().stampanti.find((s) => s.tipo === 'rt_epson_xml');
    if (!rt) return undefined;
    while (this.occupato) await new Promise((r) => setTimeout(r, 200));
    this.occupato = true;
    try {
      const url = urlFpMate({ host: rt.host, timeoutMs: 5000 });
      let s: StatoRt = { letto: new Date().toISOString() };
      s = leggiStato(await this.trasporto.postXml(url, xmlStato(0), 8000), s);
      s = leggiStato(await this.trasporto.postXml(url, xmlStato(1), 8000), s);
      s = leggiStato(await this.trasporto.postXml(url, xmlLeggiData(), 8000), s);
      return s;
    } finally { this.occupato = false; }
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
        // Tauri restituisce l'errore come testo, il browser come Error: si accettano entrambi.
        const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
        await this.db.esitoLavoro(j.id, { ok: false, errore: `${st.nome} non risponde (${msg || 'nessun dettaglio'}). Controlla che sia accesa e sulla rete del locale.` });
      }
      return;
    }
    // Fiscale
    try {
      const z = j.tipo === 'chiusura_fiscale';
      const corpo = await this.trasporto.postXml(urlFpMate({ host: st.host, timeoutMs: z ? TIMEOUT_Z_MS - 5000 : 10000 }), j.xml!, z ? TIMEOUT_Z_MS : 15000);
      const r = leggiRispostaEpson(corpo);
      if (r.ok) await this.db.esitoLavoro(j.id, { ok: true, zNumero: r.zNumero, docNumero: r.numeroDocumento, data: r.data, matricola: st.matricolaRt });
      else if (erroreEpsonIncerto(r.codice)) {
        // Il registratore non ha confermato: il documento potrebbe essere uscito. Mai ripetere da solo.
        await this.db.esitoLavoro(j.id, { ok: false, incerto: true, errore: `${spiegaErroreEpson(r.codice, r.stato)} Controlla sulla carta se è uscito prima di riprovare.` });
      } else await this.db.esitoLavoro(j.id, { ok: false, errore: spiegaErroreEpson(r.codice, r.stato) });
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
    const oggi = new Date();
    const risp = (c: Record<string, string | number>) => `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><response success="true" code="" status="2"><addInfo><elementList>${Object.keys(c).join(',')}</elementList>${Object.entries(c).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</addInfo></response></soapenv:Body></soapenv:Envelope>`;
    if (xml.includes('statusType="0"')) return risp({ lastCommand: 74, cpuRel: '04.30', mfRel: '01', mfStatus: 'OK', fpStatus: '00110' });
    if (xml.includes('statusType="1"')) return risp({ lastCommand: 138, rtType: 'M', rtMainStatus: '02', rtSubStatus: '08', rtDailyOpen: 1, rtNoWorkingPeriod: 0, rtFileToSend: 0, rtOldFileToSend: 0, rtFileRejected: 0, rtExpiryCD: '20290101', rtExpiryCA: '20290101', rtTrainingMode: 0, rtUpgradeResult: 0 });
    if (xml.includes('<getDate')) return risp({ day: oggi.getDate(), month: oggi.getMonth() + 1, year: oggi.getFullYear(), hour: oggi.getHours(), minute: oggi.getMinutes() });
    this.carta.push({ host, quando: new Date(), xml });
    const data = `${String(oggi.getDate()).padStart(2, '0')}/${String(oggi.getMonth() + 1).padStart(2, '0')}/${oggi.getFullYear()}`;
    return `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><response success="true" code="" status="2"><addInfo><elementList>lastCommand,printerStatus,fiscalReceiptNumber,fiscalReceiptAmount,fiscalReceiptDate,fiscalReceiptTime,zRepNumber</elementList><lastCommand>74</lastCommand><printerStatus>20110</printerStatus><fiscalReceiptNumber>${++this.doc}</fiscalReceiptNumber><fiscalReceiptAmount>0</fiscalReceiptAmount><fiscalReceiptDate>${data}</fiscalReceiptDate><fiscalReceiptTime>20:51</fiscalReceiptTime><zRepNumber>${this.z}</zRepNumber></addInfo></response></soapenv:Body></soapenv:Envelope>`;
  }
}
