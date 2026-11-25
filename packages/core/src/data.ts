// Livello dati. L'interfaccia è quella che avrà la versione Supabase (RPC dell'architettura):
// le schermate usano solo questa, quindi sostituire il finto con il vero non tocca le schermate.

import type { Comanda, Documento, Pagamento, PrintJob, RigaComanda, RigaVariante, Allergene } from './types';
import type { Setup } from './seed';
import { calcolaConto, righeDocumento, totaleRighe } from './conto';
import { ticketComanda, ticketPreconto } from './comande';
import { dividiAllaRomana } from './money';
import { xmlDocumentoCommerciale } from './epson';

export interface NuovaRiga {
  articoloId: string; quantita?: number; varianti?: RigaVariante[]; note?: string; portata?: number; posto?: number;
}

export interface Incasso {
  pagamenti: Pagamento[];
  scontoCents?: number;
  /** Alla romana: quale quota si sta pagando. */
  quota?: { indice: number; di: number };
}

export interface DataLayer {
  setup(): Setup;
  comandeAperte(): Comanda[];
  comanda(id: string): Comanda | undefined;
  comandaDelTavolo(tavoloId: string): Comanda | undefined;
  righe(comandaId: string): RigaComanda[];
  documenti(comandaId: string): Documento[];
  lavori(): PrintJob[];
  righeDaPreparare(centroId: string): { comanda: Comanda; righe: RigaComanda[] }[];

  login(pin: string): { nome: string; ruolo: string } | null;
  apriTavolo(tavoloId: string, coperti: number, operatore: string): Comanda;
  aggiungiRiga(comandaId: string, r: NuovaRiga): RigaComanda;
  togliRiga(rigaId: string): void;              // solo righe non ancora inviate
  impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]): void;
  invia(comandaId: string, idempotencyKey: string, portata?: number): PrintJob[];
  storna(rigaId: string, motivo: string, idempotencyKey: string): PrintJob[];
  segnaPronte(rigaIds: string[]): void;
  preconto(comandaId: string, idempotencyKey: string, persone?: number): PrintJob;
  incassa(comandaId: string, incasso: Incasso, idempotencyKey: string): { documento: Documento; lavoro: PrintJob };
  esitoLavoro(jobId: string, esito: { ok: boolean; errore?: string; incerto?: boolean; zNumero?: number; docNumero?: number; data?: string }): void;

  subscribe(fn: () => void): () => void;
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export class ErroreDominio extends Error {}

export class FakeDataLayer implements DataLayer {
  private s: Setup;
  private _comande = new Map<string, Comanda>();
  private _righe = new Map<string, RigaComanda>();
  private _documenti = new Map<string, Documento>();
  private _lavori = new Map<string, PrintJob>();
  private chiavi = new Map<string, unknown>();   // idempotenza
  private listeners = new Set<() => void>();
  private numero = 0;
  private now: () => Date;

  constructor(setup: Setup, now: () => Date = () => new Date()) { this.s = setup; this.now = now; }

  private emit() { for (const l of this.listeners) l(); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private idem<T>(key: string, fn: () => T): T {
    if (this.chiavi.has(key)) return this.chiavi.get(key) as T;
    const r = fn(); this.chiavi.set(key, r); this.emit(); return r;
  }

  setup() { return this.s; }
  comandeAperte() { return [...this._comande.values()].filter((c) => c.stato === 'aperta' || c.stato === 'preconto'); }
  comanda(id: string) { return this._comande.get(id); }
  comandaDelTavolo(tavoloId: string) { return this.comandeAperte().find((c) => c.tavoloId === tavoloId); }
  righe(comandaId: string) { return [...this._righe.values()].filter((r) => r.comandaId === comandaId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  documenti(comandaId: string) { return [...this._documenti.values()].filter((d) => d.comandaId === comandaId); }
  lavori() { return [...this._lavori.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }

  righeDaPreparare(centroId: string) {
    const out: { comanda: Comanda; righe: RigaComanda[] }[] = [];
    for (const c of this.comandeAperte()) {
      const r = this.righe(c.id).filter((x) => x.centroProduzioneId === centroId && (x.stato === 'inviata' || x.stato === 'in_preparazione' || x.stato === 'pronta'));
      if (r.some((x) => x.stato !== 'pronta')) out.push({ comanda: c, righe: r });
    }
    return out.sort((a, b) => (a.righe[0].inviataAt ?? '').localeCompare(b.righe[0].inviataAt ?? ''));
  }

  login(pin: string) {
    const o = this.s.operatori.find((x) => x.pin === pin);
    return o ? { nome: o.nome, ruolo: o.ruolo } : null;
  }

  apriTavolo(tavoloId: string, coperti: number, operatore: string): Comanda {
    if (this.comandaDelTavolo(tavoloId)) throw new ErroreDominio('Il tavolo è già aperto');
    if (!this.s.tavoli.some((t) => t.id === tavoloId)) throw new ErroreDominio('Tavolo inesistente');
    const c: Comanda = {
      id: uid(), numero: ++this.numero, tavoloId, coperti, operatore, stato: 'aperta',
      apertaAt: this.now().toISOString(), allergeniTavolo: [], version: 1,
    };
    this._comande.set(c.id, c); this.emit(); return c;
  }

  private comandaAperta(id: string) {
    const c = this._comande.get(id);
    if (!c) throw new ErroreDominio('Comanda inesistente');
    if (c.stato === 'chiusa' || c.stato === 'annullata') throw new ErroreDominio('La comanda è chiusa');
    return c;
  }

  aggiungiRiga(comandaId: string, r: NuovaRiga): RigaComanda {
    const c = this.comandaAperta(comandaId);
    const art = this.s.articoli.find((x) => x.id === r.articoloId);
    if (!art) throw new ErroreDominio('Articolo inesistente');
    if (art.esaurito) throw new ErroreDominio(`${art.nome} è esaurito`);
    const cat = this.s.categorie.find((x) => x.id === art.categoriaId)!;
    const riga: RigaComanda = {
      id: uid(), comandaId, articoloId: art.id, descrizione: art.nomeBreve ?? art.nome,
      quantita: r.quantita ?? 1, prezzoUnitarioCents: art.prezzoCents, varianti: r.varianti ?? [], note: r.note,
      portata: r.portata ?? cat.portataPredefinita, centroProduzioneId: art.centroProduzioneId ?? cat.centroProduzioneId,
      aliquotaIvaId: art.aliquotaIvaId, allergeni: [...art.allergeni], posto: r.posto, omaggio: false,
      stato: 'da_inviare', createdAt: this.now().toISOString() + String(this._righe.size).padStart(5, '0'),
    };
    this._righe.set(riga.id, riga);
    if (c.stato === 'preconto') c.stato = 'aperta';
    c.version++; this.emit(); return riga;
  }

  togliRiga(rigaId: string) {
    const r = this._righe.get(rigaId);
    if (!r) return;
    if (r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    this._righe.delete(rigaId); this.emit();
  }

  impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]) {
    this.comandaAperta(comandaId).allergeniTavolo = a; this.emit();
  }

  private tavoloLabel(c: Comanda) {
    const t = this.s.tavoli.find((x) => x.id === c.tavoloId);
    return { numero: t?.numero ?? '?', sala: this.s.sale.find((s) => s.id === t?.salaId)?.nome };
  }

  private nuovoLavoro(p: Omit<PrintJob, 'id' | 'stato' | 'tentativi' | 'createdAt'>): PrintJob {
    const j: PrintJob = { ...p, id: uid(), stato: 'in_coda', tentativi: 0, createdAt: this.now().toISOString() + String(this._lavori.size).padStart(5, '0') };
    this._lavori.set(j.id, j); return j;
  }

  invia(comandaId: string, key: string, portata?: number): PrintJob[] {
    return this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      const daInviare = this.righe(comandaId).filter((r) => (r.stato === 'da_inviare' || r.stato === 'in_attesa_marcia') && (portata === undefined || r.portata === portata));
      if (!daInviare.length) throw new ErroreDominio('Niente da inviare');
      const quando = this.now().toISOString();
      const restano = this.righe(comandaId).filter((r) => r.stato === 'da_inviare' && !daInviare.includes(r));
      const jobs: PrintJob[] = [];
      const perCentro = new Map<string | null, RigaComanda[]>();
      for (const r of daInviare) perCentro.set(r.centroProduzioneId, [...(perCentro.get(r.centroProduzioneId) ?? []), r]);
      const { numero, sala } = this.tavoloLabel(c);
      for (const [centroId, righe] of perCentro) {
        const centro = this.s.centri.find((x) => x.id === centroId);
        const marcia = righe.every((r) => r.stato === 'in_attesa_marcia');
        if (centro?.stampanteId) {
          jobs.push(this.nuovoLavoro({
            tipo: 'comanda', stampanteId: centro.stampanteId, idempotencyKey: `${key}:${centroId}`, comandaId,
            ticket: ticketComanda({ centro: centro.nome, comanda: c, tavolo: numero, sala, righe, tipo: marcia ? 'marcia' : 'invio', quando, inAttesa: [...new Set(restano.map((r) => r.portata))] }),
          }));
        }
        for (const r of righe) { r.stato = 'inviata'; r.inviataAt = quando; }
      }
      c.version++;
      return jobs;
    });
  }

  storna(rigaId: string, motivo: string, key: string): PrintJob[] {
    return this.idem(key, () => {
      const r = this._righe.get(rigaId);
      if (!r) throw new ErroreDominio('Riga inesistente');
      if (!motivo.trim()) throw new ErroreDominio('Serve il motivo dello storno');
      const c = this.comandaAperta(r.comandaId);
      const eraInviata = !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato);
      r.stato = 'stornata'; r.motivoStorno = motivo;
      const centro = this.s.centri.find((x) => x.id === r.centroProduzioneId);
      if (!eraInviata || !centro?.stampanteId) return [];
      const { numero, sala } = this.tavoloLabel(c);
      return [this.nuovoLavoro({
        tipo: 'comanda', stampanteId: centro.stampanteId, idempotencyKey: key, comandaId: c.id,
        ticket: ticketComanda({ centro: centro.nome, comanda: c, tavolo: numero, sala, righe: [r], tipo: 'storno', quando: this.now().toISOString() }),
      })];
    });
  }

  segnaPronte(rigaIds: string[]) {
    for (const id of rigaIds) { const r = this._righe.get(id); if (r && r.stato !== 'stornata') r.stato = 'pronta'; }
    this.emit();
  }

  preconto(comandaId: string, key: string, persone?: number): PrintJob {
    return this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      const st = this.s.stampanti.find((x) => x.perPreconto);
      if (!st) throw new ErroreDominio('Nessuna stampante preconto configurata');
      const righe = this.righe(comandaId);
      const conto = calcolaConto(righe, c.coperti, this.s.locale.copertoCents);
      const { numero } = this.tavoloLabel(c);
      c.stato = 'preconto';
      return this.nuovoLavoro({
        tipo: 'preconto', stampanteId: st.id, idempotencyKey: key, comandaId,
        ticket: ticketPreconto({
          intestazione: [this.s.locale.nome.toUpperCase(), this.s.locale.citta], tavolo: numero, coperti: c.coperti,
          operatore: c.operatore, quando: this.now().toISOString(), righe, copertoUnitarioCents: this.s.locale.copertoCents,
          scontoCents: 0, totaleCents: conto.totaleCents, quote: persone && persone > 1 ? dividiAllaRomana(conto.totaleCents, persone) : undefined,
        }),
      });
    });
  }

  incassa(comandaId: string, inc: Incasso, key: string) {
    return this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      if (this.documenti(comandaId).some((d) => d.stato === 'in_emissione' || d.stato === 'da_verificare'))
        throw new ErroreDominio('C’è uno scontrino in stampa o da verificare: controlla la cassa prima di continuare');
      const rt = this.s.stampanti.find((x) => x.tipo === 'rt_epson_xml');
      if (!rt) throw new ErroreDominio('Nessun registratore telematico configurato');
      const righe = this.righe(comandaId);
      if (righe.some((r) => r.stato === 'da_inviare')) throw new ErroreDominio('Ci sono righe non ancora inviate');
      let righeDoc = righeDocumento(righe, c.coperti, this.s.locale.copertoCents, this.s.aliquote, this.s.locale.aliquotaCopertoId);
      let sconto = inc.scontoCents ?? 0;
      if (inc.quota) {
        // Quota alla romana: una riga per reparto, ripartita in proporzione; il resto dei centesimi sull'ultima quota.
        const totale = totaleRighe(righeDoc) - sconto;
        const importo = dividiAllaRomana(totale, inc.quota.di)[inc.quota.indice - 1];
        const perReparto = new Map<number, number>();
        for (const r of righeDoc) perReparto.set(r.repartoRt, (perReparto.get(r.repartoRt) ?? 0) + Math.round(r.prezzoUnitarioCents * r.quantita));
        const lordo = [...perReparto.values()].reduce((s, x) => s + x, 0);
        const reparti = [...perReparto.entries()];
        let assegnato = 0;
        righeDoc = reparti.map(([rep, v], i) => {
          const quotaRep = i === reparti.length - 1 ? importo - assegnato : Math.round((importo * v) / lordo);
          assegnato += quotaRep;
          return { descrizione: `Quota ${inc.quota!.indice}/${inc.quota!.di} conto`, quantita: 1, prezzoUnitarioCents: quotaRep, repartoRt: rep };
        });
        sconto = 0;
      }
      const totale = totaleRighe(righeDoc) - sconto;
      const doc: Documento = {
        id: uid(), comandaId, tipo: 'documento_commerciale', stato: 'in_emissione', righe: righeDoc, scontoCents: sconto,
        totaleCents: totale, pagamenti: inc.pagamenti, quota: inc.quota, idempotencyKey: key, createdAt: this.now().toISOString(),
      };
      const xml = xmlDocumentoCommerciale({ righe: righeDoc, scontoCents: sconto, pagamenti: inc.pagamenti }, { host: rt.host });
      this._documenti.set(doc.id, doc);
      const lavoro = this.nuovoLavoro({ tipo: 'documento_commerciale', stampanteId: rt.id, idempotencyKey: key, comandaId, documentoId: doc.id, xml });
      return { documento: doc, lavoro };
    });
  }

  esitoLavoro(jobId: string, e: { ok: boolean; errore?: string; incerto?: boolean; zNumero?: number; docNumero?: number; data?: string }) {
    const j = this._lavori.get(jobId);
    if (!j) return;
    j.tentativi++;
    j.stato = e.ok ? 'stampato' : e.incerto ? 'da_verificare' : 'errore';
    j.errore = e.errore;
    if (j.documentoId) {
      const d = this._documenti.get(j.documentoId)!;
      d.stato = e.ok ? 'emesso' : e.incerto ? 'da_verificare' : 'errore';
      d.errore = e.errore;
      if (e.ok) {
        d.rtZNumero = e.zNumero; d.rtDocNumero = e.docNumero; d.rtData = e.data;
        this.chiudiSePagata(d.comandaId);
      } else {
        // Uno scontrino fallito libera la chiave: si può riprovare con un nuovo tocco.
        if (!e.incerto) this.chiavi.delete(d.idempotencyKey);
      }
    }
    this.emit();
  }

  /** La comanda si chiude quando i documenti emessi coprono il totale. */
  private chiudiSePagata(comandaId: string) {
    const c = this._comande.get(comandaId)!;
    const conto = calcolaConto(this.righe(comandaId), c.coperti, this.s.locale.copertoCents);
    const emessi = this.documenti(comandaId).filter((d) => d.stato === 'emesso');
    const pagato = emessi.reduce((s, d) => s + d.totaleCents + d.scontoCents, 0);
    const quoteTotali = emessi[0]?.quota?.di;
    const tutteLeQuote = quoteTotali !== undefined && emessi.filter((d) => d.quota).length >= quoteTotali;
    if (pagato >= conto.totaleCents || tutteLeQuote) { c.stato = 'chiusa'; c.chiusaAt = this.now().toISOString(); }
  }
}
