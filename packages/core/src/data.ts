// Livello dati. Due implementazioni con la stessa interfaccia:
//  - FakeDataLayer: in memoria (modalità demo e test);
//  - SupabaseDataLayer (nell'app): database vero, con cache locale aggiornata in tempo reale.
// Le letture sono immediate (dalla cache); le scritture sono asincrone.

import type { Allergene, Caparra, Cliente, Comanda, DatiFiscali, Documento, Fattura, Impostazioni, MessaggioReparto, MovimentoCassa, Prenotazione, PrintJob, StatoLavoro, RigaComanda, RigaVariante, Sospeso, StatoFattura, StoricoCliente, TipoMessaggio, TipoMovimentoCassa, TipoPagamento, PonteStampa } from './types';
import { MINUTI_SOSPENSIONE } from './types';
import { comandaSulTavolo, controllaSceltaMenu, promoInVigore, TIPI_INCASSO_SOSPESO } from './servizio';
import { xmlApriCassetto, type StatoRt } from './epson';
import { nomeCliente } from './types';
import type { Setup } from './seed';
import { ErroreDominio, preparaAnnullaConto, preparaAnnullo, preparaProforma, preparaReso, preparaRistampa, preparaChiusura, preparaIncasso, preparaInvio, preparaMessaggio, preparaPreconto, preparaStorno, type Incasso } from './operazioni';
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

export interface ChiusuraFiscale {
  giorno: string; zNumero?: number; totali: Record<string, unknown>; createdAt: string;
  /** Stato del lavoro di stampa dello Z sull'RT. */
  stato: StatoLavoro | 'sconosciuto';
  errore?: string;
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
  /** Offerto dalla casa: il piatto resta (cucina e bar non ricevono niente), sul conto vale 0. */
  offri(rigaId: string, omaggio: boolean, operatore?: Operatore): Promise<void>;
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
  /** Reso parziale di uno scontrino: righe e quantità scelte, rimborso in contanti o sulla carta. */
  resoDocumento(documentoId: string, scelte: { indice: number; quantita: number }[], rimborso: 'contanti' | 'carta', idempotencyKey: string, operatore?: Operatore): Promise<void>;
  /** Ristampa della comanda per un reparto (o tutti). */
  ristampa(comandaId: string, idempotencyKey: string, centroId?: string): Promise<void>;
  /** Annulla un conto aperto senza scontrini (prove, tavolo aperto per errore). Il tavolo torna libero. */
  annullaComanda(comandaId: string, motivo: string, idempotencyKey: string, operatore?: Operatore, avvisaReparti?: boolean): Promise<void>;
  /** Chiude il conto come proforma: niente scontrino né incasso, i prodotti escono dal magazzino. */
  chiudiProforma(comandaId: string, p: { motivo: string; nome?: string; stampa?: boolean }, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  /** Chiusure fiscali fatte (più recenti per prime). */
  chiusure(giorni: number): Promise<ChiusuraFiscale[]>;
  /** Chiusura fiscale (Z) con i totali della giornata. */
  chiusuraFiscale(totali: object, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  /** Conti, righe e scontrini degli ultimi n giorni di servizio (1 = oggi). */
  datiPeriodo(giorni: number): Promise<DatiPeriodo>;

  /** Conto senza tavolo: al banco o da asporto, con un nome facoltativo. */
  apriBanco(canale: 'banco' | 'asporto', nome: string, operatore: Operatore): Promise<Comanda>;
  /** Unisce tavoli liberi a un conto aperto (gruppo grande): un solo conto, tutti i tavoli occupati. */
  unisciTavoli(comandaId: string, tavoloIds: string[]): Promise<void>;
  /** Toglie un tavolo unito: torna libero. */
  separaTavolo(comandaId: string, tavoloId: string): Promise<void>;
  /** Menu fisso: riga del menu (con il prezzo) e i piatti scelti (a prezzo zero, vanno in cucina). */
  aggiungiMenu(comandaId: string, articoloId: string, scelte: { articoloId: string; gruppo: number }[]): Promise<void>;

  /** Conti sospesi e addebiti in camera (aperti e incassati negli ultimi 60 giorni). */
  sospesi(): Promise<Sospeso[]>;
  incassaSospeso(id: string, tipo: TipoPagamento, operatore?: Operatore): Promise<void>;
  caparre(): Promise<Caparra[]>;
  salvaCaparra(c: Omit<Caparra, 'id' | 'stato' | 'createdAt'>, operatore?: Operatore): Promise<Caparra>;
  restituisciCaparra(id: string): Promise<void>;
  /** Movimenti del cassetto della giornata di servizio. */
  movimentiCassa(): Promise<MovimentoCassa[]>;
  registraMovimento(tipo: TipoMovimentoCassa, importoCents: number, causale: string, idempotencyKey: string, operatore?: Operatore): Promise<void>;
  apriCassetto(idempotencyKey: string): Promise<void>;
  salvaImpostazioni(i: Impostazioni): Promise<void>;

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
  /** Casse che stampano (vive o no): servono per l'avviso "nessuna cassa accesa". */
  ponti(): PonteStampa[];
  /** Battito della cassa che stampa, con lo stato del registratore se appena letto. */
  battito(nome: string, versione: string, statoRt?: StatoRt): Promise<void>;
  /** Lavoro rimasto in coda a cassa spenta: stampalo adesso o scartalo. */
  decidiLavoro(jobId: string, stampa: boolean): Promise<void>;
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
  comandaDelTavolo(tavoloId: string) { return comandaSulTavolo(this.comandeAperte(), tavoloId); }
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
    if (quantita <= 0) { this._righe.delete(rigaId); for (const f of [...this._righe.values()]) if (f.parentId === rigaId) this._righe.delete(f.id); } else r.quantita = quantita;
    const c = this._comande.get(r.comandaId); if (c) c.version++;
    this.emit();
  }

  async togliRiga(rigaId: string) {
    const r = this._righe.get(rigaId);
    if (!r) return;
    if (r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    this._righe.delete(rigaId);
    for (const f of [...this._righe.values()]) if (f.parentId === rigaId) this._righe.delete(f.id);
    this.emit();
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

  async offri(rigaId: string, omaggio: boolean) {
    const r = this._righe.get(rigaId);
    if (!r) throw new ErroreDominio('Riga inesistente');
    if (r.stato === 'stornata') throw new ErroreDominio('La riga è stornata');
    if (this.documenti(r.comandaId).some((d) => ['emesso', 'in_emissione', 'da_verificare'].includes(d.stato))) throw new ErroreDominio('Il conto è già stato pagato in parte');
    r.omaggio = omaggio; const c = this._comande.get(r.comandaId); if (c) c.version++;
    this.emit();
  }

  async storna(rigaId: string, motivo: string, key: string) {
    this.idem(key, () => {
      const r = this._righe.get(rigaId);
      if (!r) throw new ErroreDominio('Riga inesistente');
      const c = this.comandaAperta(r.comandaId);
      const prep = preparaStorno(this.s, c, r, motivo, this.now().toISOString());
      r.stato = 'stornata'; r.motivoStorno = motivo;
      if (prep) this.nuovoLavoro({ tipo: 'comanda', stampanteId: prep.stampanteId, idempotencyKey: key, comandaId: c.id, ticket: prep.ticket });
      // Menu fisso: con il menu si stornano anche i piatti scelti.
      this.righe(c.id).filter((f) => f.parentId === r.id && f.stato !== 'stornata').forEach((f, i) => {
        const pf = preparaStorno(this.s, c, f, motivo, this.now().toISOString());
        f.stato = 'stornata'; f.motivoStorno = motivo;
        if (pf) this.nuovoLavoro({ tipo: 'comanda', stampanteId: pf.stampanteId, idempotencyKey: `${key}:${i + 1}`, comandaId: c.id, ticket: pf.ticket });
      });
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

  private _ponti: PonteStampa[] = [];
  ponti() { return this._ponti; }
  async battito(nome: string, versione: string, statoRt?: StatoRt) {
    const ora = this.now().toISOString();
    const p = this._ponti.find((x) => x.nome === nome);
    const nuovo: PonteStampa = { nome, versione, vistoAt: ora, statoRt: statoRt ?? p?.statoRt, statoRtAt: statoRt ? ora : p?.statoRtAt };
    this._ponti = [...this._ponti.filter((x) => x.nome !== nome), nuovo];
    this.emit();
  }
  async decidiLavoro(jobId: string, stampa: boolean) {
    const j = this._lavori.get(jobId);
    if (!j || j.stato !== 'sospeso') return;
    if (stampa) { j.stato = 'in_coda'; j.errore = undefined; (j as { confermatoAt?: string }).confermatoAt = this.now().toISOString(); }
    else {
      j.stato = 'annullato'; j.errore = 'Scartato dalla cassa (era rimasto in coda)';
      const d = j.documentoId ? this._documenti.get(j.documentoId) : undefined;
      if (d && d.stato === 'in_emissione') { d.stato = 'errore'; d.errore = 'Non emesso: scartato perché era rimasto in coda a cassa spenta'; }
    }
    this.emit();
  }

  async prendiLavori(max = 10) {
    // Come il database: dopo 10 minuti mai partiti, i lavori aspettano una decisione.
    const limite = this.now().getTime() - MINUTI_SOSPENSIONE * 60_000;
    for (const j of this.lavori()) {
      const da = new Date(((j as { confermatoAt?: string }).confermatoAt ?? j.createdAt).replace(/(Z)\d+$/, '$1')).getTime();
      if (da < limite && (j.stato === 'in_coda' || (j.stato === 'errore' && (j.tipo === 'comanda' || j.tipo === 'preconto') && j.tentativi < 3))) {
        j.stato = 'sospeso'; j.errore = 'Rimasto in coda mentre nessuna cassa stampava: scegli se stamparlo o scartarlo';
      }
    }
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
    if (e.ok && e.zNumero !== undefined) (j as { z?: number }).z = e.zNumero;
    if (j.documentoId) {
      const d = this._documenti.get(j.documentoId)!;
      d.stato = e.ok ? 'emesso' : e.incerto ? 'da_verificare' : 'errore';
      d.errore = e.errore;
      if (e.ok) {
        d.rtZNumero = e.zNumero; d.rtDocNumero = e.docNumero; d.rtData = e.data;
        if (d.tipo === 'annullo') {
          const o = d.origineId ? this._documenti.get(d.origineId) : undefined;
          if (o) {
            o.stato = 'annullato';
            this._sospesi = this._sospesi.map((x) => (x.documentoId === o.id && x.stato === 'aperto' ? { ...x, stato: 'annullato' } : x));
            this._caparre = this._caparre.map((x) => (x.documentoId === o.id ? { ...x, stato: 'aperta', documentoId: undefined } : x));
          }
        } else if (d.tipo === 'documento_commerciale') {
          this.registraDaDocumento(d);
          this.chiudiSePagata(d.comandaId);
        }
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

  async resoDocumento(documentoId: string, scelte: { indice: number; quantita: number }[], rimborso: 'contanti' | 'carta', key: string) {
    this.idem(key, () => {
      const o = this._documenti.get(documentoId);
      if (!o) throw new ErroreDominio('Scontrino inesistente');
      const giaResi = [...this._documenti.values()].filter((x) => x.tipo === 'reso' && x.origineId === documentoId && x.stato !== 'errore').reduce((t, x) => t + x.totaleCents, 0);
      const prep = preparaReso(this.s, o, scelte, rimborso, giaResi);
      const doc: Documento = { ...o, id: uid(), tipo: 'reso', origineId: o.id, comandaId: '', stato: 'in_emissione', idempotencyKey: key, createdAt: this.now().toISOString(),
        righe: prep.righe, scontoCents: prep.scontoCents, totaleCents: prep.totaleCents, pagamenti: [{ tipo: rimborso, importoCents: prep.totaleCents }], rtZNumero: undefined, rtDocNumero: undefined };
      this._documenti.set(doc.id, doc);
      return this.nuovoLavoro({ tipo: 'reso', stampanteId: prep.stampanteId, idempotencyKey: key, documentoId: doc.id, xml: prep.xml });
    });
  }

  async ristampa(comandaId: string, key: string, centroId?: string) {
    this.idem(key, () => {
      const c = this._comande.get(comandaId);
      if (!c) throw new ErroreDominio('Comanda inesistente');
      preparaRistampa(this.s, c, this.righe(comandaId), this.now().toISOString(), centroId)
        .forEach((l, i) => this.nuovoLavoro({ tipo: 'comanda', stampanteId: l.stampanteId, idempotencyKey: `${key}:${i + 1}`, comandaId, ticket: l.ticket }));
      return true;
    });
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

  // ---------------------------------------------------------------- banco, menu fissi
  async apriBanco(canale: 'banco' | 'asporto', nome: string, operatore: Operatore): Promise<Comanda> {
    const c: Comanda = {
      id: uid(), numero: ++this.numero, tavoloId: null, coperti: 0, operatore: operatore.nome, stato: 'aperta',
      apertaAt: this.now().toISOString(), allergeniTavolo: [], version: 1, canale, etichetta: nome.trim() || undefined,
    };
    this._comande.set(c.id, c); this.emit(); return c;
  }
  async unisciTavoli(comandaId: string, tavoloIds: string[]) {
    const c = this.comandaAperta(comandaId);
    const nuovi = tavoloIds.filter((t) => t !== c.tavoloId && !c.tavoliUniti?.includes(t));
    for (const t of nuovi) if (this.comandaDelTavolo(t)) throw new ErroreDominio('Uno dei tavoli è già occupato');
    if (!c.tavoloId) throw new ErroreDominio('Solo un conto al tavolo può avere tavoli uniti');
    c.tavoliUniti = [...(c.tavoliUniti ?? []), ...nuovi]; c.version++; this.emit();
  }
  async separaTavolo(comandaId: string, tavoloId: string) {
    const c = this.comandaAperta(comandaId);
    c.tavoliUniti = (c.tavoliUniti ?? []).filter((t) => t !== tavoloId); c.version++; this.emit();
  }
  async aggiungiMenu(comandaId: string, articoloId: string, scelte: { articoloId: string; gruppo: number }[]) {
    const c = this.comandaAperta(comandaId);
    for (const r of righeMenu(this.s, comandaId, articoloId, scelte, uid, this.stamp())) this._righe.set(r.id, r);
    if (c.stato === 'preconto') c.stato = 'aperta';
    c.version++; this.emit();
  }

  // ---------------------------------------------------------------- cassa
  private _sospesi: Sospeso[] = [];
  private _caparre: Caparra[] = [];
  private _movimenti: MovimentoCassa[] = [];
  async sospesi() { return [...this._sospesi].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async incassaSospeso(id: string, tipo: TipoPagamento) {
    if (!TIPI_INCASSO_SOSPESO.includes(tipo)) throw new ErroreDominio('Metodo non valido');
    this._sospesi = this._sospesi.map((x) => (x.id === id && x.stato === 'aperto' ? { ...x, stato: 'incassato', incassatoAt: this.now().toISOString(), incassatoTipo: tipo } : x));
    this.emit();
  }
  async caparre() { return [...this._caparre].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async salvaCaparra(c: Omit<Caparra, 'id' | 'stato' | 'createdAt'>) {
    if (!c.nome.trim()) throw new ErroreDominio('Manca il nome');
    if (!(c.importoCents > 0)) throw new ErroreDominio('Importo non valido');
    const v: Caparra = { ...c, id: uid(), stato: 'aperta', createdAt: this.now().toISOString() };
    this._caparre = [v, ...this._caparre]; this.emit(); return v;
  }
  async restituisciCaparra(id: string) {
    this._caparre = this._caparre.map((x) => (x.id === id && x.stato === 'aperta' ? { ...x, stato: 'restituita' } : x)); this.emit();
  }
  async movimentiCassa() { return [...this._movimenti]; }
  async registraMovimento(tipo: TipoMovimentoCassa, importoCents: number, causale: string, key: string, op?: Operatore) {
    this.idem(key, () => {
      if (!(importoCents >= 0)) throw new ErroreDominio('Importo non valido');
      this._movimenti = [...this._movimenti, { id: uid(), tipo, importoCents, causale: causale.trim() || undefined, operatore: op?.nome ?? '', createdAt: this.now().toISOString() }];
      return true;
    });
  }
  async apriCassetto(key: string) {
    this.idem(key, () => {
      const rt = this.s.stampanti.find((x) => x.tipo === 'rt_epson_xml');
      if (!rt) throw new ErroreDominio('Nessun registratore telematico configurato');
      return this.nuovoLavoro({ tipo: 'non_fiscale', stampanteId: rt.id, idempotencyKey: key, xml: xmlApriCassetto({ host: rt.host }) });
    });
  }
  async salvaImpostazioni(i: Impostazioni) { this.s = { ...this.s, impostazioni: i }; this.emit(); }

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

  private _chiusure: { totali: object; quando: string; jobId: string }[] = [];
  async chiusuraFiscale(totali: object, key: string) {
    this.idem(key, () => {
      const prep = preparaChiusura(this.s);
      const j = this.nuovoLavoro({ tipo: 'chiusura_fiscale', stampanteId: prep.stampanteId, idempotencyKey: key, xml: prep.xml });
      this._chiusure.push({ totali, quando: this.now().toISOString(), jobId: j.id });
      return j;
    });
  }
  async chiusure(giorni: number): Promise<ChiusuraFiscale[]> {
    const da = this.now().getTime() - giorni * 24 * 3600_000;
    return this._chiusure.filter((c) => new Date(c.quando).getTime() >= da).reverse().map((c) => {
      const j = this._lavori.get(c.jobId);
      return { giorno: c.quando.slice(0, 10), totali: c.totali as Record<string, unknown>, createdAt: c.quando, stato: j?.stato ?? 'sconosciuto', errore: j?.errore, zNumero: (j as { z?: number } | undefined)?.z };
    });
  }

  async annullaComanda(comandaId: string, motivo: string, key: string, _op?: Operatore, avvisa = true) {
    this.idem(key, () => {
      const c = this._comande.get(comandaId);
      if (!c) throw new ErroreDominio('Comanda inesistente');
      if (c.stato === 'annullata') return true;
      const prep = preparaAnnullaConto(this.s, c, this.righe(comandaId), this.documenti(comandaId), motivo, this.now().toISOString(), avvisa);
      for (const r of this.righe(comandaId)) if (r.stato !== 'stornata') { r.stato = 'stornata'; r.motivoStorno = motivo; }
      c.stato = 'annullata'; c.chiusaAt = this.now().toISOString(); c.version++;
      prep.lavori.forEach((l, i) => this.nuovoLavoro({ tipo: 'comanda', stampanteId: l.stampanteId, idempotencyKey: `${key}:${i + 1}`, comandaId, ticket: l.ticket }));
      return true;
    });
  }

  async chiudiProforma(comandaId: string, p: { motivo: string; nome?: string; stampa?: boolean }, key: string, op?: Operatore) {
    this.idem(key, () => {
      const c = this._comande.get(comandaId);
      if (!c) throw new ErroreDominio('Comanda inesistente');
      if (c.stato === 'chiusa' && c.proforma) return true;
      const prep = preparaProforma(this.s, c, this.righe(comandaId), this.documenti(comandaId), p.motivo, this.now().toISOString(), p.nome, p.stampa);
      c.stato = 'chiusa'; c.chiusaAt = this.now().toISOString(); c.version++;
      c.proforma = { ...prep.proforma, operatore: op?.nome };
      if (prep.lavoro) this.nuovoLavoro({ tipo: 'preconto', stampanteId: prep.lavoro.stampanteId, idempotencyKey: key, comandaId, ticket: prep.lavoro.ticket });
      return true;
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

  /** Scontrino emesso: nascono i sospesi/addebiti in camera e le caparre usate risultano chiuse. */
  private registraDaDocumento(d: Documento) {
    const c = this._comande.get(d.comandaId);
    for (const p of d.pagamenti) {
      if (p.tipo === 'sospeso' || p.tipo === 'camera') {
        this._sospesi.push({ id: uid(), documentoId: d.id, comandaId: d.comandaId, clienteId: c?.clienteId ?? null, tipo: p.tipo, descrizione: p.descrizione, importoCents: p.importoCents, stato: 'aperto', createdAt: this.now().toISOString() });
      } else if (p.descrizione?.startsWith('caparra:')) {
        const id = p.descrizione.slice(8);
        this._caparre = this._caparre.map((x) => (x.id === id ? { ...x, stato: 'usata', documentoId: d.id } : x));
      }
    }
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
  return righe.find((x) => x.stato === 'da_inviare' && x.articoloId === r.articoloId && !x.parentId && x.varianti.every((v) => v.promo) && !x.note && !x.posto
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
  // Happy hour e promozioni a orario: lo sconto è una variante "promo" (visibile sul conto, non in cucina).
  const pr = promoInVigore(s, art, new Date(createdAt.slice(0, 24)));
  const varianti = [...(r.varianti ?? []), ...(pr ? [{ nome: pr.promo.nome, deltaCents: -pr.scontoCents, promo: true }] : [])];
  return {
    id, comandaId, articoloId: art.id, descrizione: art.nomeBreve ?? art.nome,
    quantita: r.quantita ?? 1, prezzoUnitarioCents: art.prezzoCents, varianti, note: r.note,
    portata: r.portata ?? cat.portataPredefinita, centroProduzioneId: art.centroProduzioneId ?? cat.centroProduzioneId,
    aliquotaIvaId: art.aliquotaIvaId, allergeni: [...art.allergeni], posto: r.posto, omaggio: false,
    stato: 'da_inviare', createdAt,
  };
}

/** Righe di un menu fisso: la riga del menu (prezzo, IVA) e i piatti scelti a prezzo zero, legati alla prima. */
export function righeMenu(s: Setup, comandaId: string, articoloId: string, scelte: { articoloId: string; gruppo: number }[], nuovoId: () => string, quando: string): RigaComanda[] {
  const m = controllaSceltaMenu(s, articoloId, scelte);
  const padre = nuovaRiga(s, comandaId, { articoloId, portata: m.gruppi[0]?.portata ?? 1 }, nuovoId(), quando);
  padre.centroProduzioneId = null; // la riga del menu non va in cucina: ci vanno i piatti scelti
  const figli = scelte.map((x, i) => {
    const r = nuovaRiga(s, comandaId, { articoloId: x.articoloId, portata: m.gruppi[x.gruppo].portata }, nuovoId(), quando.slice(0, 24) + String(i + 1).padStart(3, '0'));
    return { ...r, prezzoUnitarioCents: 0, varianti: [], parentId: padre.id };
  });
  return [padre, ...figli];
}
