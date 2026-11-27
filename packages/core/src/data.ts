// Livello dati. Due implementazioni con la stessa interfaccia:
//  - FakeDataLayer: in memoria (modalità demo e test);
//  - SupabaseDataLayer (nell'app): database vero, con cache locale aggiornata in tempo reale.
// Le letture sono immediate (dalla cache); le scritture sono asincrone.

import type { Allergene, Cliente, Comanda, DatiFiscali, Documento, Fattura, MessaggioReparto, Prenotazione, PrintJob, RigaComanda, RigaVariante, StatoFattura, StoricoCliente, TipoMessaggio } from './types';
import { nomeCliente } from './types';
import type { Setup } from './seed';
import { ErroreDominio, preparaAnnullo, preparaChiusura, preparaIncasso, preparaInvio, preparaMessaggio, preparaPreconto, preparaStorno, type Incasso } from './operazioni';
import type { CalcoloFattura } from './fattura';
import type { DatiPeriodo } from './report';
import { calcolaConto } from './conto';

export { ErroreDominio, type Incasso };

export interface NuovaRiga {
  /** Articolo del menu. Assente = voce libera (serve "libera"). */
  articoloId?: string;
  libera?: VoceLibera;
  quantita?: number; varianti?: RigaVariante[]; note?: string; portata?: number; posto?: number;
}

/** Voce fuori menu, creata al volo: non diventa un articolo. */
export interface VoceLibera { descrizione: string; prezzoCents: number; centroId: string | null; aliquotaIvaId: string }

export interface NuovoMessaggio { centriIds: string[]; tipo: TipoMessaggio; testo?: string; portata?: number; comandaId?: string }

export interface NuovaFattura {
  clienteId: string; documentoId?: string; comandaId?: string; data: string;
  calcolo: CalcoloFattura; xml: string; progressivo: string; intestatario: string;
}

export type ClienteNuovo = Omit<Cliente, 'id'> & { id?: string };

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
  apriTavolo(tavoloId: string, coperti: number, operatore: Operatore, prenotazioneId?: string): Promise<Comanda>;
  /** Prenotazioni della giornata di servizio (da Table Flow). */
  prenotazioni(): Prenotazione[];
  segnaNonPresentato(prenotazioneId: string): Promise<void>;
  /** Legge subito le prenotazioni nuove da Table Flow (dove c'è il collegamento). */
  sincronizzaPrenotazioni?(): Promise<{ importate: number; inviate: number; errori: string[] }>;
  /** Aggiunge un piatto (o una voce libera). Lo stesso piatto senza varianti, non ancora inviato, aumenta la quantità. */
  aggiungiRiga(comandaId: string, r: NuovaRiga): Promise<RigaComanda>;
  togliRiga(rigaId: string): Promise<void>;
  /** Solo righe non ancora inviate. 0 = toglie la riga. */
  cambiaQuantita(rigaId: string, quantita: number): Promise<void>;
  impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]): Promise<void>;
  invia(comandaId: string, idempotencyKey: string, operatore?: Operatore, portata?: number): Promise<PrintJob[]>;
  storna(rigaId: string, motivo: string, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  segnaPronte(rigaIds: string[]): Promise<void>;
  preconto(comandaId: string, idempotencyKey: string, persone?: number): Promise<void>;
  incassa(comandaId: string, incasso: Incasso, idempotencyKey: string, operatore?: Operatore): Promise<Documento>;

  /** Piatto finito ("86"): sparisce dalla scelta su tutti i dispositivi finché non torna disponibile. */
  impostaEsaurito(articoloId: string, esaurito: boolean): Promise<void>;
  /** Sposta il conto su un tavolo libero. */
  spostaComanda(comandaId: string, tavoloId: string): Promise<void>;
  /** Unisce il conto di un altro tavolo a questo (righe e coperti). */
  unisciComande(destinazioneId: string, origineId: string): Promise<void>;
  /** Sposta alcune righe su un altro conto aperto. */
  spostaRighe(rigaIds: string[], destinazioneId: string): Promise<void>;
  annullaDocumento(documentoId: string, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  /** Chiusura fiscale (Z) con i totali della giornata. */
  chiusuraFiscale(totali: object, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  /** Conti, righe e scontrini degli ultimi n giorni di servizio (1 = oggi). */
  datiPeriodo(giorni: number): Promise<DatiPeriodo>;

  /** Messaggi ai reparti delle ultime ore (i più recenti per primi). */
  messaggi(): MessaggioReparto[];
  inviaMessaggio(m: NuovoMessaggio, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  segnaMessaggioVisto(id: string): Promise<void>;

  /** Anagrafica clienti (condivisa tra i locali del gruppo). */
  cercaClienti(testo: string): Promise<Cliente[]>;
  cliente(id: string): Promise<Cliente | null>;
  salvaCliente(c: ClienteNuovo): Promise<Cliente>;
  impostaCliente(comandaId: string, clienteId: string | null): Promise<void>;
  storicoCliente(id: string): Promise<StoricoCliente>;

  /** Dati del locale per le fatture. */
  salvaDatiFiscali(d: DatiFiscali): Promise<void>;
  emettiFattura(f: NuovaFattura, idempotencyKey: string, operatore?: Operatore): Promise<Fattura>;
  fatture(giorni: number): Promise<Fattura[]>;
  impostaStatoFattura(id: string, stato: StatoFattura): Promise<void>;
  /** Stampa non fiscale (es. copia di cortesia della fattura) sulla stampante dei preconti. */
  stampaNonFiscale(ticket: import('./ticket').Ticket, idempotencyKey: string): Promise<void>;

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
  private _prenotazioni = new Map<string, Prenotazione>();
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
  /** Demo: la Gestione ha cambiato listino o sala. */
  impostaSetup(s: Setup) { this.s = s; this.emit(); }
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

  async apriTavolo(tavoloId: string, coperti: number, operatore: Operatore, prenotazioneId?: string): Promise<Comanda> {
    if (this.comandaDelTavolo(tavoloId)) throw new ErroreDominio('Il tavolo è già aperto');
    if (!this.s.tavoli.some((t) => t.id === tavoloId)) throw new ErroreDominio('Tavolo inesistente');
    const p = prenotazioneId ? this._prenotazioni.get(prenotazioneId) : undefined;
    const c: Comanda = {
      id: uid(), numero: ++this.numero, tavoloId, coperti, operatore: operatore.nome, stato: 'aperta',
      apertaAt: this.now().toISOString(), allergeniTavolo: (p?.allergeni ?? []).map((allergene) => ({ allergene })), version: 1,
      prenotazioneId: p?.id,
    };
    if (p) this._prenotazioni.set(p.id, { ...p, stato: 'arrivata', tavoloId });
    this._comande.set(c.id, c); this.emit(); return c;
  }

  prenotazioni() { return [...this._prenotazioni.values()].sort((a, b) => a.inizio.localeCompare(b.inizio)); }
  /** Demo e test: prenotazioni come se fossero arrivate da Table Flow. */
  impostaPrenotazioni(p: Prenotazione[]) { this._prenotazioni = new Map(p.map((x) => [x.id, x])); this.emit(); }
  async segnaNonPresentato(id: string) {
    const p = this._prenotazioni.get(id);
    if (!p) throw new ErroreDominio('Prenotazione inesistente');
    this._prenotazioni.set(id, { ...p, stato: 'mancata' }); this.emit();
  }

  private comandaAperta(id: string) {
    const c = this._comande.get(id);
    if (!c) throw new ErroreDominio('Comanda inesistente');
    if (c.stato === 'chiusa' || c.stato === 'annullata') throw new ErroreDominio('La comanda è chiusa');
    return c;
  }

  async aggiungiRiga(comandaId: string, r: NuovaRiga): Promise<RigaComanda> {
    const c = this.comandaAperta(comandaId);
    const uguale = rigaUguale(this.righe(comandaId), r);
    if (uguale) { uguale.quantita += r.quantita ?? 1; c.version++; this.emit(); return uguale; }
    const riga = nuovaRiga(this.s, comandaId, r, uid(), this.stamp());
    this._righe.set(riga.id, riga);
    if (c.stato === 'preconto') c.stato = 'aperta';
    c.version++; this.emit(); return riga;
  }

  async cambiaQuantita(rigaId: string, quantita: number) {
    const r = this._righe.get(rigaId);
    if (!r) return;
    if (r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    if (quantita <= 0) this._righe.delete(rigaId); else r.quantita = quantita;
    const c = this._comande.get(r.comandaId); if (c) c.version++;
    this.emit();
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
      .filter((x) => x.stato === 'in_coda' || (x.stato === 'errore' && (x.tipo === 'comanda' || x.tipo === 'preconto') && x.tentativi < 3))
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
        if (d.tipo === 'annullo') { const o = d.origineId ? this._documenti.get(d.origineId) : undefined; if (o) o.stato = 'annullato'; }
        else this.chiudiSePagata(d.comandaId);
      } else if (!e.incerto) {
        this.chiavi.delete(d.idempotencyKey);
      }
    }
    this.emit();
  }

  async impostaEsaurito(articoloId: string, esaurito: boolean) {
    this.s = { ...this.s, articoli: this.s.articoli.map((a) => (a.id === articoloId ? { ...a, esaurito } : a)) };
    this.emit();
  }

  async spostaComanda(comandaId: string, tavoloId: string) {
    const c = this.comandaAperta(comandaId);
    if (!this.s.tavoli.some((t) => t.id === tavoloId)) throw new ErroreDominio('Tavolo inesistente');
    if (this.comandaDelTavolo(tavoloId)) throw new ErroreDominio('Il tavolo è già aperto');
    c.tavoloId = tavoloId; c.version++; this.emit();
  }

  private senzaPagamenti(...ids: string[]) {
    if (ids.some((id) => this.documenti(id).some((d) => ['emesso', 'in_emissione', 'da_verificare'].includes(d.stato))))
      throw new ErroreDominio('Uno dei due conti è già stato pagato in parte');
  }

  async unisciComande(destinazioneId: string, origineId: string) {
    if (destinazioneId === origineId) throw new ErroreDominio('È lo stesso tavolo');
    const d = this.comandaAperta(destinazioneId), o = this.comandaAperta(origineId);
    this.senzaPagamenti(destinazioneId, origineId);
    for (const r of this.righe(origineId)) r.comandaId = destinazioneId;
    d.coperti += o.coperti; d.allergeniTavolo = [...d.allergeniTavolo, ...o.allergeniTavolo]; d.stato = 'aperta'; d.version++;
    d.prenotazioneId ??= o.prenotazioneId;
    o.stato = 'annullata'; o.coperti = 0; o.chiusaAt = this.now().toISOString();
    this.emit();
  }

  async spostaRighe(rigaIds: string[], destinazioneId: string) {
    const d = this.comandaAperta(destinazioneId);
    const righe = rigaIds.map((id) => this._righe.get(id)).filter((r): r is RigaComanda => !!r && r.stato !== 'stornata');
    this.senzaPagamenti(...new Set(righe.map((r) => r.comandaId)));
    for (const r of righe) { const o = this._comande.get(r.comandaId); if (o) o.version++; r.comandaId = destinazioneId; }
    d.version++; this.emit();
  }

  async annullaDocumento(documentoId: string, key: string) {
    this.idem(key, () => {
      const o = this._documenti.get(documentoId);
      if (!o) throw new ErroreDominio('Scontrino inesistente');
      if ([...this._documenti.values()].some((x) => x.origineId === documentoId && x.stato !== 'errore')) throw new ErroreDominio('Annullo già richiesto');
      const prep = preparaAnnullo(this.s, o);
      const doc: Documento = { ...o, id: uid(), tipo: 'annullo', origineId: o.id, comandaId: '', stato: 'in_emissione', idempotencyKey: key, createdAt: this.now().toISOString(), rtZNumero: undefined, rtDocNumero: undefined };
      this._documenti.set(doc.id, doc);
      return this.nuovoLavoro({ tipo: 'annullo', stampanteId: prep.stampanteId, idempotencyKey: key, documentoId: doc.id, xml: prep.xml });
    });
  }

  // ---------------------------------------------------------------- messaggi
  private _messaggi: MessaggioReparto[] = [];
  messaggi() { return this._messaggi; }
  async inviaMessaggio(m: NuovoMessaggio, key: string, op?: Operatore) {
    this.idem(key, () => {
      const c = m.comandaId ? this.comandaAperta(m.comandaId) : undefined;
      const quando = this.now().toISOString();
      const prep = preparaMessaggio(this.s, { ...m, comanda: c, righe: c ? this.righe(c.id) : [], operatore: op?.nome ?? c?.operatore ?? '', quando });
      prep.reparti.forEach((rep, i) => {
        this._messaggi = [{ id: uid(), centroId: rep.centroId, comandaId: c?.id ?? null, tipo: m.tipo, testo: m.testo ?? '', portata: m.portata, operatore: op?.nome ?? '', createdAt: this.now().toISOString() }, ...this._messaggi];
        if (rep.stampanteId) this.nuovoLavoro({ tipo: 'comanda', stampanteId: rep.stampanteId, idempotencyKey: `${key}:${i + 1}`, comandaId: c?.id, ticket: rep.ticket });
      });
      return true;
    });
  }
  async segnaMessaggioVisto(id: string) {
    this._messaggi = this._messaggi.map((x) => (x.id === id ? { ...x, vistoAt: this.now().toISOString() } : x)); this.emit();
  }

  // ---------------------------------------------------------------- clienti
  private _clienti = new Map<string, Cliente>();
  async cercaClienti(testo: string) {
    const q = testo.trim().toLowerCase();
    return [...this._clienti.values()]
      .filter((c) => !q || [nomeCliente(c), c.telefono, c.email, c.piva, c.codiceFiscale].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b))).slice(0, 50);
  }
  async cliente(id: string) { return this._clienti.get(id) ?? null; }
  async salvaCliente(c: ClienteNuovo) {
    if (!c.nome.trim() && !c.ragioneSociale?.trim()) throw new ErroreDominio('Manca il nome');
    const v: Cliente = { ...c, id: c.id ?? uid(), createdAt: c.createdAt ?? this.now().toISOString() };
    this._clienti.set(v.id, v); this.emit(); return v;
  }
  async impostaCliente(comandaId: string, clienteId: string | null) {
    const c = this.comandaAperta(comandaId); c.clienteId = clienteId ?? undefined; c.version++; this.emit();
  }
  async storicoCliente(id: string): Promise<StoricoCliente> {
    const comande = [...this._comande.values()].filter((c) => c.clienteId === id && c.stato === 'chiusa');
    const ids = new Set(comande.map((c) => c.id));
    const spesa = [...this._documenti.values()].filter((d) => ids.has(d.comandaId) && d.stato === 'emesso').reduce((t, d) => t + d.totaleCents, 0);
    const piatti = new Map<string, number>();
    for (const r of this._righe.values()) if (ids.has(r.comandaId) && r.stato !== 'stornata') piatti.set(r.descrizione, (piatti.get(r.descrizione) ?? 0) + r.quantita);
    return {
      visite: comande.length, spesaCents: spesa, ultimaVisita: comande.map((c) => c.apertaAt).sort().pop(),
      piatti: [...piatti].map(([descrizione, quantita]) => ({ descrizione, quantita })).sort((a, b) => b.quantita - a.quantita).slice(0, 8),
      fatture: this._fatture.filter((f) => f.clienteId === id),
    };
  }

  // ---------------------------------------------------------------- fatture
  private _fatture: Fattura[] = [];
  async salvaDatiFiscali(d: DatiFiscali) { this.s = { ...this.s, locale: { ...this.s.locale, fiscali: d } }; this.emit(); }
  async emettiFattura(f: NuovaFattura, key: string) {
    return this.idem(key, () => {
      if (f.documentoId && this._fatture.some((x) => x.documentoId === f.documentoId && x.stato !== 'annullata')) throw new ErroreDominio('Questo scontrino ha già la sua fattura');
      const anno = Number(f.data.slice(0, 4));
      const numero = Math.max(0, ...this._fatture.filter((x) => x.anno === anno).map((x) => x.numero)) + 1;
      const v: Fattura = {
        id: uid(), anno, numero, data: f.data, clienteId: f.clienteId, documentoId: f.documentoId ?? null, comandaId: f.comandaId ?? null,
        imponibileCents: f.calcolo.imponibileCents, ivaCents: f.calcolo.ivaCents, totaleCents: f.calcolo.totaleCents,
        xml: f.xml.replace('__NUMERO__', String(numero)), stato: 'da_inviare', intestatario: f.intestatario, createdAt: this.now().toISOString(),
      };
      this._fatture = [v, ...this._fatture];
      return v;
    });
  }
  async fatture(giorni: number) {
    const da = this.now().getTime() - giorni * 24 * 3600_000;
    return this._fatture.filter((f) => new Date(f.createdAt).getTime() >= da);
  }
  async impostaStatoFattura(id: string, stato: StatoFattura) {
    this._fatture = this._fatture.map((f) => (f.id === id ? { ...f, stato } : f)); this.emit();
  }
  async stampaNonFiscale(ticket: import('./ticket').Ticket, key: string) {
    this.idem(key, () => {
      const st = this.s.stampanti.find((x) => x.perPreconto) ?? this.s.stampanti.find((x) => x.tipo === 'comande_escpos');
      if (!st) throw new ErroreDominio('Nessuna stampante per le stampe non fiscali');
      return this.nuovoLavoro({ tipo: 'non_fiscale', stampanteId: st.id, idempotencyKey: key, ticket });
    });
  }

  chiusure: { totali: object; quando: string }[] = [];
  async chiusuraFiscale(totali: object, key: string) {
    this.idem(key, () => {
      const prep = preparaChiusura(this.s);
      this.chiusure.push({ totali, quando: this.now().toISOString() });
      return this.nuovoLavoro({ tipo: 'chiusura_fiscale', stampanteId: prep.stampanteId, idempotencyKey: key, xml: prep.xml });
    });
  }

  async datiPeriodo(giorni: number): Promise<DatiPeriodo> {
    const da = this.now().getTime() - giorni * 24 * 3600_000;
    const comande = [...this._comande.values()].filter((c) => new Date(c.apertaAt).getTime() >= da);
    const ids = new Set(comande.map((c) => c.id));
    return {
      comande,
      righe: [...this._righe.values()].filter((r) => ids.has(r.comandaId)),
      documenti: [...this._documenti.values()].filter((d) => new Date(d.createdAt).getTime() >= da),
    };
  }

  private chiudiSePagata(comandaId: string) {
    const c = this._comande.get(comandaId)!;
    const conto = calcolaConto(this.righe(comandaId), c.coperti, this.s.locale.copertoCents);
    const emessi = this.documenti(comandaId).filter((d) => d.stato === 'emesso');
    const pagato = emessi.reduce((s, d) => s + d.totaleCents + d.scontoCents, 0);
    const quoteTotali = emessi.find((d) => d.quota)?.quota?.di;
    const tutteLeQuote = quoteTotali !== undefined && emessi.filter((d) => d.quota).length >= quoteTotali;
    if (pagato >= conto.totaleCents || tutteLeQuote) {
      c.stato = 'chiusa'; c.chiusaAt = this.now().toISOString();
      const p = c.prenotazioneId ? this._prenotazioni.get(c.prenotazioneId) : undefined;
      if (p) this._prenotazioni.set(p.id, { ...p, stato: 'terminata' });
    }
  }
}

/** Riga uguale ancora da inviare (stesso piatto, portata, nessuna variante/nota/posto): si aumenta la quantità. */
export function rigaUguale(righe: RigaComanda[], r: NuovaRiga): RigaComanda | undefined {
  if (!r.articoloId || r.varianti?.length || r.note || r.posto) return undefined;
  return righe.find((x) => x.stato === 'da_inviare' && x.articoloId === r.articoloId && !x.varianti.length && !x.note && !x.posto
    && (r.portata === undefined || x.portata === r.portata));
}

/** Costruisce una riga di comanda dall'articolo (prezzo, IVA, centro, allergeni copiati al momento dell'ordine). */
export function nuovaRiga(s: Setup, comandaId: string, r: NuovaRiga, id: string, createdAt: string): RigaComanda {
  if (!r.articoloId) {
    const l = r.libera;
    if (!l || !l.descrizione.trim()) throw new ErroreDominio('Scrivi cosa aggiungere');
    if (!Number.isFinite(l.prezzoCents) || l.prezzoCents < 0) throw new ErroreDominio('Prezzo non valido');
    if (!s.aliquote.some((a) => a.id === l.aliquotaIvaId)) throw new ErroreDominio('Scegli l\'IVA');
    return {
      id, comandaId, articoloId: null, descrizione: l.descrizione.trim().slice(0, 60),
      quantita: r.quantita ?? 1, prezzoUnitarioCents: Math.round(l.prezzoCents), varianti: [], note: r.note,
      portata: r.portata ?? 1, centroProduzioneId: l.centroId, aliquotaIvaId: l.aliquotaIvaId, allergeni: [], posto: r.posto,
      omaggio: false, stato: 'da_inviare', createdAt,
    };
  }
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
