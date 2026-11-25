// Livello dati. Due implementazioni con la stessa interfaccia:
//  - FakeDataLayer: in memoria (modalità demo e test);
//  - SupabaseDataLayer (nell'app): database vero, con cache locale aggiornata in tempo reale.
// Le letture sono immediate (dalla cache); le scritture sono asincrone.

import type { Allergene, Comanda, Documento, PrintJob, RigaComanda, RigaVariante } from './types';
import type { Setup } from './seed';
import { ErroreDominio, preparaIncasso, preparaInvio, preparaPreconto, preparaStorno, type Incasso } from './operazioni';
import { calcolaConto } from './conto';

export { ErroreDominio, type Incasso };

export interface NuovaRiga {
  articoloId: string; quantita?: number; varianti?: RigaVariante[]; note?: string; portata?: number; posto?: number;
}

export interface Operatore { id: string; nome: string; ruolo: string }

export interface EsitoLavoro {
  ok: boolean; errore?: string; incerto?: boolean; zNumero?: number; docNumero?: number; data?: string; matricola?: string;
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

  login(pin: string): Promise<Operatore | null>;
  apriTavolo(tavoloId: string, coperti: number, operatore: Operatore): Promise<Comanda>;
  aggiungiRiga(comandaId: string, r: NuovaRiga): Promise<RigaComanda>;
  togliRiga(rigaId: string): Promise<void>;
  impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]): Promise<void>;
  invia(comandaId: string, idempotencyKey: string, operatore?: Operatore, portata?: number): Promise<PrintJob[]>;
  storna(rigaId: string, motivo: string, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  segnaPronte(rigaIds: string[]): Promise<void>;
  preconto(comandaId: string, idempotencyKey: string, persone?: number): Promise<void>;
  incassa(comandaId: string, incasso: Incasso, idempotencyKey: string, operatore?: Operatore): Promise<Documento>;

  /** Solo l'app di cassa: prende i lavori da stampare (nessun altro dispositivo li riceve). */
  prendiLavori(max?: number): Promise<PrintJob[]>;
  esitoLavoro(jobId: string, esito: EsitoLavoro): Promise<void>;

  subscribe(fn: () => void): () => void;
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export class FakeDataLayer implements DataLayer {
  private s: Setup;
  private _comande = new Map<string, Comanda>();
  private _righe = new Map<string, RigaComanda>();
  private _documenti = new Map<string, Documento>();
  private _lavori = new Map<string, PrintJob>();
  private chiavi = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private numero = 0;
  private seq = 0;

  constructor(setup: Setup, private now: () => Date = () => new Date()) { this.s = setup; }

  private emit() { for (const l of this.listeners) l(); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private idem<T>(key: string, fn: () => T): T {
    if (this.chiavi.has(key)) return this.chiavi.get(key) as T;
    const r = fn(); this.chiavi.set(key, r); this.emit(); return r;
  }
  private stamp() { return this.now().toISOString() + String(++this.seq).padStart(6, '0'); }

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

  async login(pin: string) {
    const o = this.s.operatori.find((x) => x.pin === pin);
    return o ? { id: o.id, nome: o.nome, ruolo: o.ruolo } : null;
  }

  async apriTavolo(tavoloId: string, coperti: number, operatore: Operatore): Promise<Comanda> {
    if (this.comandaDelTavolo(tavoloId)) throw new ErroreDominio('Il tavolo è già aperto');
    if (!this.s.tavoli.some((t) => t.id === tavoloId)) throw new ErroreDominio('Tavolo inesistente');
    const c: Comanda = {
      id: uid(), numero: ++this.numero, tavoloId, coperti, operatore: operatore.nome, stato: 'aperta',
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

  async aggiungiRiga(comandaId: string, r: NuovaRiga): Promise<RigaComanda> {
    const c = this.comandaAperta(comandaId);
    const riga = nuovaRiga(this.s, comandaId, r, uid(), this.stamp());
    this._righe.set(riga.id, riga);
    if (c.stato === 'preconto') c.stato = 'aperta';
    c.version++; this.emit(); return riga;
  }

  async togliRiga(rigaId: string) {
    const r = this._righe.get(rigaId);
    if (!r) return;
    if (r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    this._righe.delete(rigaId); this.emit();
  }

  async impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]) {
    this.comandaAperta(comandaId).allergeniTavolo = a; this.emit();
  }

  private nuovoLavoro(p: Omit<PrintJob, 'id' | 'stato' | 'tentativi' | 'createdAt'>): PrintJob {
    const j: PrintJob = { ...p, id: uid(), stato: 'in_coda', tentativi: 0, createdAt: this.stamp() };
    this._lavori.set(j.id, j); return j;
  }

  async invia(comandaId: string, key: string, _op?: Operatore, portata?: number): Promise<PrintJob[]> {
    return this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      const quando = this.now().toISOString();
      const prep = preparaInvio(this.s, c, this.righe(comandaId), quando, portata);
      const jobs = prep.lavori.map((l, i) => this.nuovoLavoro({ tipo: 'comanda', stampanteId: l.stampanteId, idempotencyKey: `${key}:${i + 1}`, comandaId, ticket: l.ticket }));
      for (const id of prep.righeIds) { const r = this._righe.get(id)!; r.stato = 'inviata'; r.inviataAt = quando; }
      c.version++;
      return jobs;
    });
  }

  async storna(rigaId: string, motivo: string, key: string) {
    this.idem(key, () => {
      const r = this._righe.get(rigaId);
      if (!r) throw new ErroreDominio('Riga inesistente');
      const c = this.comandaAperta(r.comandaId);
      const prep = preparaStorno(this.s, c, r, motivo, this.now().toISOString());
      r.stato = 'stornata'; r.motivoStorno = motivo;
      if (prep) this.nuovoLavoro({ tipo: 'comanda', stampanteId: prep.stampanteId, idempotencyKey: key, comandaId: c.id, ticket: prep.ticket });
      return true;
    });
  }

  async segnaPronte(rigaIds: string[]) {
    for (const id of rigaIds) { const r = this._righe.get(id); if (r && r.stato !== 'stornata') r.stato = 'pronta'; }
    this.emit();
  }

  async preconto(comandaId: string, key: string, persone?: number) {
    this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      const prep = preparaPreconto(this.s, c, this.righe(comandaId), this.now().toISOString(), persone);
      c.stato = 'preconto';
      return this.nuovoLavoro({ tipo: 'preconto', stampanteId: prep.stampanteId, idempotencyKey: key, comandaId, ticket: prep.ticket });
    });
  }

  async incassa(comandaId: string, inc: Incasso, key: string): Promise<Documento> {
    return this.idem(key, () => {
      const c = this.comandaAperta(comandaId);
      if (this.documenti(comandaId).some((d) => d.stato === 'in_emissione' || d.stato === 'da_verificare'))
        throw new ErroreDominio('C’è uno scontrino in stampa o da verificare: controlla la cassa prima di continuare');
      const prep = preparaIncasso(this.s, c, this.righe(comandaId), inc);
      const doc: Documento = {
        id: uid(), comandaId, tipo: 'documento_commerciale', stato: 'in_emissione', righe: prep.righe, scontoCents: prep.scontoCents,
        totaleCents: prep.totaleCents, pagamenti: inc.pagamenti, quota: inc.quota, idempotencyKey: key, createdAt: this.now().toISOString(),
      };
      this._documenti.set(doc.id, doc);
      this.nuovoLavoro({ tipo: 'documento_commerciale', stampanteId: prep.stampanteId, idempotencyKey: key, comandaId, documentoId: doc.id, xml: prep.xml });
      return doc;
    });
  }

  async prendiLavori(max = 10) {
    const presi = this.lavori()
      .filter((x) => x.stato === 'in_coda' || (x.stato === 'errore' && x.tipo !== 'documento_commerciale' && x.tentativi < 3))
      .slice(0, max);
    for (const j of presi) j.stato = 'preso';
    return presi;
  }

  async esitoLavoro(jobId: string, e: EsitoLavoro) {
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
      } else if (!e.incerto) {
        this.chiavi.delete(d.idempotencyKey);
      }
    }
    this.emit();
  }

  private chiudiSePagata(comandaId: string) {
    const c = this._comande.get(comandaId)!;
    const conto = calcolaConto(this.righe(comandaId), c.coperti, this.s.locale.copertoCents);
    const emessi = this.documenti(comandaId).filter((d) => d.stato === 'emesso');
    const pagato = emessi.reduce((s, d) => s + d.totaleCents + d.scontoCents, 0);
    const quoteTotali = emessi.find((d) => d.quota)?.quota?.di;
    const tutteLeQuote = quoteTotali !== undefined && emessi.filter((d) => d.quota).length >= quoteTotali;
    if (pagato >= conto.totaleCents || tutteLeQuote) { c.stato = 'chiusa'; c.chiusaAt = this.now().toISOString(); }
  }
}

/** Costruisce una riga di comanda dall'articolo (prezzo, IVA, centro, allergeni copiati al momento dell'ordine). */
export function nuovaRiga(s: Setup, comandaId: string, r: NuovaRiga, id: string, createdAt: string): RigaComanda {
  const art = s.articoli.find((x) => x.id === r.articoloId);
  if (!art) throw new ErroreDominio('Articolo inesistente');
  if (art.esaurito) throw new ErroreDominio(`${art.nome} è esaurito`);
  const cat = s.categorie.find((x) => x.id === art.categoriaId)!;
  return {
    id, comandaId, articoloId: art.id, descrizione: art.nomeBreve ?? art.nome,
    quantita: r.quantita ?? 1, prezzoUnitarioCents: art.prezzoCents, varianti: r.varianti ?? [], note: r.note,
    portata: r.portata ?? cat.portataPredefinita, centroProduzioneId: art.centroProduzioneId ?? cat.centroProduzioneId,
    aliquotaIvaId: art.aliquotaIvaId, allergeni: [...art.allergeni], posto: r.posto, omaggio: false,
    stato: 'da_inviare', createdAt,
  };
}
