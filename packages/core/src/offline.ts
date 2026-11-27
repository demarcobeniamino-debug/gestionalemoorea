// Cassa senza internet (livello 2): la cassa continua da sola con una copia locale del servizio.
// Comande, stampe, conti, scontrini, annulli, resi, cassetto e chiusura passano dalla stessa logica della demo
// (FakeDataLayer) partendo dall'ultima istantanea del database; quando la linea torna si manda al database solo
// quello che è cambiato, già stampato e già emesso (nessuna stampa e nessuno scontrino si ripetono).
import { FakeDataLayer, type Operatore } from './data';
import { ErroreDominio } from './operazioni';
import type { Setup } from './seed';
import type { Comanda, Documento, MovimentoCassa, RigaComanda } from './types';
import { PAGAMENTO_RT } from './types';

/** Fotografia del servizio presa dalla cassa mentre è online (salvata sul disco a ogni cambiamento). */
export interface Istantanea {
  quando: string;
  localeId: string;
  setup: Setup;
  comande: Comanda[];
  righe: RigaComanda[];
  documenti: Documento[];
}

/** Gli orari interni della demo hanno un contatore in coda (per l'ordinamento): il database vuole ISO puliti. */
export const isoPulito = (s?: string) => (s ? s.replace(/(Z)\d+$/, '$1') : s);

const NON_OFFLINE = 'Senza internet questa funzione non c’è: si fa quando torna la linea.';

export class CassaOffline extends FakeDataLayer {
  constructor(readonly base: Istantanea, private verificaPin: (pin: string) => Promise<Operatore | null>, now?: () => Date) {
    super(base.setup, now);
    for (const c of base.comande) this._comande.set(c.id, structuredClone(c));
    for (const r of base.righe) this._righe.set(r.id, structuredClone(r));
    for (const d of base.documenti) this._documenti.set(d.id, structuredClone(d));
    this.numero = Math.max(0, ...base.comande.map((c) => c.numero));
  }

  /** Ripresa dopo un riavvio senza linea: lo stato salvato sul disco torna in memoria. */
  ripristina(s: StatoOffline) {
    this._comande = new Map(s.comande.map((c) => [c.id, c]));
    this._righe = new Map(s.righe.map((r) => [r.id, r]));
    this._documenti = new Map(s.documenti.map((d) => [d.id, d]));
    this._movimenti = s.movimenti;
    this._chiusure = s.chiusure;
    this.numero = Math.max(this.numero, ...s.comande.map((c) => c.numero));
  }

  stato(): StatoOffline {
    return {
      comande: [...this._comande.values()], righe: [...this._righe.values()], documenti: [...this._documenti.values()],
      movimenti: this._movimenti,
      chiusure: this._chiusure.map((c) => ({ ...c, z: (this._lavori.get(c.jobId) as { z?: number } | undefined)?.z, ok: this._lavori.get(c.jobId)?.stato === 'stampato' })),
    };
  }

  override async login(pin: string) { return this.verificaPin(pin); }

  // Fuori dal servizio di sala: senza internet non si fanno (i dati vivono nel database).
  override async salvaCaparra(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async restituisciCaparra(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async incassaSospeso(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async emettiFattura(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async salvaCliente(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async salvaImpostazioni(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
  override async salvaDatiFiscali(): Promise<never> { throw new ErroreDominio(NON_OFFLINE); }
}

export interface StatoOffline {
  comande: Comanda[]; righe: RigaComanda[]; documenti: Documento[];
  movimenti: MovimentoCassa[];
  chiusure: { totali: object; quando: string; jobId: string; z?: number; ok?: boolean }[];
}

const uguale = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Cosa mandare al database: solo quello che è nuovo o cambiato rispetto all'istantanea, già nel formato delle tabelle. */
export function datiDaSincronizzare(base: Istantanea, s: StatoOffline) {
  const L = base.localeId;
  const op = (nome: string) => base.setup.operatori.find((o) => o.nome === nome)?.id ?? null;
  const prima = {
    c: new Map(base.comande.map((x) => [x.id, x])),
    r: new Map(base.righe.map((x) => [x.id, x])),
    d: new Map(base.documenti.map((x) => [x.id, x])),
  };
  const comande = s.comande.filter((c) => !uguale(c, prima.c.get(c.id))).map((c) => ({
    id: c.id, locale_id: L, numero: c.numero, canale: c.canale ?? 'tavolo', tavolo_id: c.tavoloId, coperti: c.coperti,
    cliente_id: c.clienteId ?? null, prenotazione_id: c.prenotazioneId ?? null, operatore_id: op(c.operatore), stato: c.stato,
    note: c.tavoloId ? null : c.etichetta ?? null, allergeni_tavolo: c.allergeniTavolo, aperta_at: isoPulito(c.apertaAt), chiusa_at: isoPulito(c.chiusaAt) ?? null,
    proforma: c.proforma ? { motivo: c.proforma.motivo, nome: c.proforma.nome, totale_cents: c.proforma.totaleCents, operatore: c.proforma.operatore } : null,
    tavoli_uniti: c.tavoliUniti ?? [], nuova: !prima.c.has(c.id),
  }));
  const righe = s.righe.filter((r) => !uguale(r, prima.r.get(r.id))).map((r) => ({
    id: r.id, locale_id: L, comanda_id: r.comandaId, articolo_id: r.articoloId, parent_riga_id: r.parentId ?? null, descrizione: r.descrizione,
    quantita: r.quantita, prezzo_unitario_cents: r.prezzoUnitarioCents, varianti: r.varianti, note: r.note ?? null, portata: r.portata,
    centro_produzione_id: r.centroProduzioneId, aliquota_iva_id: r.aliquotaIvaId, allergeni: r.allergeni, posto: r.posto ?? null,
    omaggio: r.omaggio, stato: r.stato, inviata_at: isoPulito(r.inviataAt) ?? null, motivo_storno: r.motivoStorno ?? null, created_at: isoPulito(r.createdAt),
  }));
  // Solo documenti con un esito definitivo: in stampa o da verificare restano sulla cassa finché non si chiariscono.
  const documenti = s.documenti.filter((d) => !uguale(d, prima.d.get(d.id)) && ['emesso', 'annullato', 'errore'].includes(d.stato)).map((d) => ({
    id: d.id, locale_id: L, comanda_id: d.comandaId || null, tipo: d.tipo, stato: d.stato, totale_cents: d.totaleCents, sconto_cents: d.scontoCents,
    quota_indice: d.quota?.indice ?? null, quota_di: d.quota?.di ?? null, rt_z_numero: d.rtZNumero ?? null, rt_doc_numero: d.rtDocNumero ?? null,
    rt_matricola: base.setup.stampanti.find((x) => x.tipo === 'rt_epson_xml')?.matricolaRt ?? null,
    documento_origine_id: d.origineId ?? null, errore: d.errore ?? null, idempotency_key: d.idempotencyKey, created_at: isoPulito(d.createdAt),
    nuovo: !prima.d.has(d.id),
    righe: d.righe.map((x) => ({ descrizione: x.descrizione, quantita: x.quantita, prezzo_unitario_cents: x.prezzoUnitarioCents, importo_cents: Math.round(x.prezzoUnitarioCents * x.quantita), reparto_rt: x.repartoRt })),
    pagamenti: d.pagamenti.map((p) => ({ tipo: p.tipo, tipo_rt: PAGAMENTO_RT[p.tipo], importo_cents: p.importoCents, descrizione: p.descrizione ?? null })),
  }));
  const movimenti = s.movimenti.map((m) => ({ id: m.id, tipo: m.tipo, importo_cents: m.importoCents, causale: m.causale ?? null, operatore_id: op(m.operatore), created_at: isoPulito(m.createdAt) }));
  const chiusure = s.chiusure.filter((c) => c.ok).map((c) => ({ totali: c.totali, z: c.z ?? null, quando: isoPulito(c.quando) }));
  const presenti = new Set(s.righe.map((r) => r.id));
  const righe_tolte = base.righe.filter((r) => !presenti.has(r.id)).map((r) => r.id);
  return { comande, righe, righe_tolte, documenti, movimenti, chiusure, vuoto: !righe_tolte.length && !comande.length && !righe.length && !documenti.length && !movimenti.length && !chiusure.length };
}
