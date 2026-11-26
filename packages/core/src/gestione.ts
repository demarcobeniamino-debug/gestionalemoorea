// Pannello Gestione: articoli e menu, sale e tavoli, magazzino.
// Le righe hanno la stessa forma delle tabelle del database (snake_case), così
// l'archivio in memoria (demo) e quello su Supabase si scambiano senza traduzioni.
import type { Allergene, FormaTavolo, TipoStampante } from './types';
import type { Setup } from './seed';

// ------------------------------------------------------------------ righe
export interface LocaleRiga { id: string; nome: string; indirizzo: string; coperto_cents: number }
export interface ListinoRiga { id: string; locale_id: string; nome: string; predefinito: boolean }
export interface AliquotaRiga { id: string; locale_id: string; descrizione: string; percentuale: number; reparto_rt: number }
export interface StampanteRiga {
  id: string; locale_id: string; nome: string; tipo: TipoStampante; host: string; porta: number;
  colonne: 32 | 42 | 48; per_preconto: boolean; matricola_rt: string | null; attiva: boolean;
  codepage: number; modello: string | null;
}
export interface CentroRiga { id: string; locale_id: string; nome: string; stampante_id: string | null }
export interface CategoriaRiga {
  id: string; locale_id: string; nome: string; colore: string | null; ordine: number;
  centro_produzione_id: string | null; portata_predefinita: number;
}
export interface ArticoloRiga {
  id: string; locale_id: string; categoria_id: string; nome: string; nome_breve: string | null;
  aliquota_iva_id: string; centro_produzione_id: string | null; allergeni: Allergene[];
  esaurito: boolean; ordine: number; attivo: boolean;
  descrizione?: { it?: string } | null;
}
export interface PrezzoRiga { listino_id: string; articolo_id: string; prezzo_cents: number }
export interface VarianteRiga { id: string; locale_id: string; gruppo: string | null; nome: string; delta_cents: number }
export interface ArticoloVarianteRiga { articolo_id: string; variante_id: string }
export interface SalaRiga { id: string; locale_id: string; nome: string; ordine: number }
export interface TavoloRiga {
  id: string; locale_id: string; sala_id: string; numero: string; forma: FormaTavolo;
  x: number; y: number; larghezza: number; altezza: number; posti: number; attivo: boolean;
}
export interface FornitoreRiga { id: string; gruppo_id: string; ragione_sociale: string; piva: string | null; email_ordini: string | null }
export interface MagArticoloRiga {
  id: string; gruppo_id: string; nome: string; um_acquisto: string; um_uso: string; fattore: number;
  fornitore_id: string | null; costo_ultimo_cents: number | null;
}
export interface ScortaRiga { locale_id: string; mag_articolo_id: string; giacenza: number; scorta_min: number | null; scorta_max: number | null }
export interface DistintaRiga { articolo_id: string; mag_articolo_id: string; quantita: number; resa_pct: number }
export type TipoMovimento = 'carico' | 'scarico' | 'vendita' | 'inventario' | 'scarto' | 'trasferimento_out' | 'trasferimento_in';
export interface MovimentoRiga {
  id: string; locale_id: string; tipo: TipoMovimento; data: string; fornitore_id: string | null;
  rif_documento: string | null; operatore_id: string | null; created_at: string;
  righe: { mag_articolo_id: string; quantita: number; costo_unitario_cents: number | null }[];
}

export type RuoloOperatore = 'cameriere' | 'cassiere' | 'cucina' | 'bar' | 'responsabile' | 'admin';
export interface OperatoreRiga {
  id: string; locale_id: string; nome: string; ruolo: RuoloOperatore; attivo: boolean;
  permessi: { sconto_max_pct?: number; storno?: boolean };
  /** Solo nella demo: in produzione il PIN è salvato cifrato e non si legge mai. */
  pin?: string;
}
export interface NuovoOperatore { id?: string; nome: string; ruolo: RuoloOperatore; pin?: string; attivo: boolean; permessi?: OperatoreRiga['permessi'] }

export interface Tabelle {
  locale: LocaleRiga;
  operatori: OperatoreRiga[];
  gruppoId: string;
  listini: ListinoRiga[];
  aliquote_iva: AliquotaRiga[];
  stampanti: StampanteRiga[];
  centri_produzione: CentroRiga[];
  categorie: CategoriaRiga[];
  articoli: ArticoloRiga[];
  prezzi_listino: PrezzoRiga[];
  varianti: VarianteRiga[];
  articolo_varianti: ArticoloVarianteRiga[];
  sale: SalaRiga[];
  tavoli: TavoloRiga[];
  fornitori: FornitoreRiga[];
  mag_articoli: MagArticoloRiga[];
  scorte: ScortaRiga[];
  distinte: DistintaRiga[];
  movimenti: MovimentoRiga[];
}

/** Tabelle modificabili dalla Gestione e la loro chiave. */
export const CHIAVI = {
  categorie: ['id'], articoli: ['id'], varianti: ['id'], sale: ['id'], tavoli: ['id'],
  stampanti: ['id'], centri_produzione: ['id'],
  fornitori: ['id'], mag_articoli: ['id'],
  prezzi_listino: ['listino_id', 'articolo_id'],
  articolo_varianti: ['articolo_id', 'variante_id'],
  distinte: ['articolo_id', 'mag_articolo_id'],
  scorte: ['locale_id', 'mag_articolo_id'],
} as const;
export type NomeTabella = keyof typeof CHIAVI;
export type RigaDi<T extends NomeTabella> = Tabelle[T][number];

export interface NuovoMovimento {
  tipo: 'carico' | 'scarico' | 'scarto' | 'inventario';
  data?: string;
  fornitoreId?: string | null;
  rif?: string;
  operatoreId?: string | null;
  righe: { magArticoloId: string; quantita: number; costoCents?: number | null }[];
}

export interface Archivio {
  tabelle(): Tabelle;
  ricarica(): Promise<void>;
  subscribe(fn: () => void): () => void;
  /** Inserisce o aggiorna. Senza id ne crea uno nuovo. Restituisce la riga salvata. */
  salva<T extends NomeTabella>(tabella: T, riga: Partial<RigaDi<T>>): Promise<RigaDi<T>>;
  elimina<T extends NomeTabella>(tabella: T, chiave: Partial<RigaDi<T>>): Promise<void>;
  registraMovimento(m: NuovoMovimento): Promise<void>;
  /** Crea o modifica un operatore; il PIN (4-6 cifre) si passa solo se va cambiato. */
  salvaOperatore(o: NuovoOperatore): Promise<void>;
}

export class ErroreGestione extends Error {}

// ------------------------------------------------------------------ logica pura

/** Variazione di giacenza di un movimento (la quantità si scrive sempre positiva). */
export function deltaMovimento(tipo: NuovoMovimento['tipo'], quantita: number, giacenzaAttuale: number): number {
  if (!(quantita >= 0)) throw new ErroreGestione('Quantità non valida.');
  if (tipo === 'carico') return quantita;
  if (tipo === 'inventario') return quantita - giacenzaAttuale;
  return -quantita;
}

/** Costo di una porzione dalla ricetta, in centesimi (null se manca il costo di qualche ingrediente). */
export function foodCost(articoloId: string, t: Pick<Tabelle, 'distinte' | 'mag_articoli'>): number | null {
  const righe = t.distinte.filter((d) => d.articolo_id === articoloId);
  if (!righe.length) return null;
  let tot = 0;
  for (const d of righe) {
    const m = t.mag_articoli.find((x) => x.id === d.mag_articolo_id);
    if (m?.costo_ultimo_cents == null) return null;
    tot += (d.quantita / (d.resa_pct / 100)) * m.costo_ultimo_cents;
  }
  return Math.round(tot);
}

/** Stato della scorta per i colori della lista. */
export function statoScorta(s: Pick<ScortaRiga, 'giacenza' | 'scorta_min'> | undefined): 'ok' | 'bassa' | 'esaurita' {
  if (!s || s.giacenza <= 0) return 'esaurita';
  if (s.scorta_min != null && s.giacenza < s.scorta_min) return 'bassa';
  return 'ok';
}

/** Colore del testo leggibile su un colore di categoria. */
export function testoSu(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#0f1216' : '#f2f4f7';
}

export const listinoPredefinito = (t: Pick<Tabelle, 'listini'>) => t.listini.find((l) => l.predefinito) ?? t.listini[0];

export function prezzoDi(articoloId: string, t: Pick<Tabelle, 'listini' | 'prezzi_listino'>) {
  const l = listinoPredefinito(t);
  return t.prezzi_listino.find((p) => p.articolo_id === articoloId && p.listino_id === l?.id)?.prezzo_cents ?? 0;
}

/** Dalle tabelle alla configurazione che usano sala, comanda e cassa. */
export function setupDaTabelle(t: Omit<Tabelle, 'fornitori' | 'mag_articoli' | 'scorte' | 'distinte' | 'movimenti' | 'gruppoId' | 'operatori'>, operatori: Setup['operatori']): Setup {
  const iva10 = t.aliquote_iva.find((a) => Number(a.percentuale) === 10) ?? t.aliquote_iva[0];
  return {
    locale: { id: t.locale.id, nome: t.locale.nome, citta: t.locale.indirizzo.split(',').pop()!.trim(), copertoCents: t.locale.coperto_cents, aliquotaCopertoId: iva10?.id },
    stampanti: t.stampanti.filter((s) => s.attiva).map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo, host: s.host, porta: s.porta, colonne: s.colonne, perPreconto: s.per_preconto, matricolaRt: s.matricola_rt ?? undefined, codePage: s.codepage ?? 19, modello: s.modello ?? undefined })),
    centri: t.centri_produzione.map((c) => ({ id: c.id, nome: c.nome, stampanteId: c.stampante_id })),
    aliquote: t.aliquote_iva.map((a) => ({ id: a.id, descrizione: a.descrizione, percentuale: Number(a.percentuale), repartoRt: a.reparto_rt })),
    sale: [...t.sale].sort((a, b) => a.ordine - b.ordine).map((s) => ({ id: s.id, nome: s.nome, ordine: s.ordine })),
    tavoli: t.tavoli.filter((x) => x.attivo).map((x) => ({ id: x.id, salaId: x.sala_id, numero: x.numero, forma: x.forma, x: Number(x.x), y: Number(x.y), larghezza: Number(x.larghezza), altezza: Number(x.altezza), posti: x.posti })),
    // In cassa solo le categorie con almeno un articolo nel menu.
    categorie: [...t.categorie].filter((c) => t.articoli.some((a) => a.attivo && a.categoria_id === c.id)).sort((a, b) => a.ordine - b.ordine).map((c) => ({ id: c.id, nome: c.nome, colore: c.colore ?? '#a3acba', testoColore: testoSu(c.colore ?? '#a3acba'), ordine: c.ordine, centroProduzioneId: c.centro_produzione_id, portataPredefinita: c.portata_predefinita })),
    articoli: t.articoli.filter((a) => a.attivo).sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome)).map((a) => ({
      id: a.id, categoriaId: a.categoria_id, nome: a.nome, nomeBreve: a.nome_breve ?? undefined, prezzoCents: prezzoDi(a.id, t), aliquotaIvaId: a.aliquota_iva_id,
      centroProduzioneId: a.centro_produzione_id, allergeni: a.allergeni, esaurito: a.esaurito, descrizione: a.descrizione?.it || undefined,
      variantiIds: t.articolo_varianti.filter((x) => x.articolo_id === a.id).map((x) => x.variante_id),
    })),
    varianti: t.varianti.map((v) => ({ id: v.id, gruppo: v.gruppo ?? '', nome: v.nome, deltaCents: v.delta_cents })),
    operatori,
  };
}

/** Il contrario, per la demo: dalla configurazione di esempio alle tabelle. */
export function tabelleDaSetup(s: Setup): Tabelle {
  const L = s.locale.id, G = 'gruppo-demo', LIST = 'listino-sala';
  const centroCategoria = (id: string) => s.categorie.find((c) => c.id === id)?.centroProduzioneId ?? null;
  const t: Tabelle = {
    locale: { id: L, nome: s.locale.nome, indirizzo: `Lungomare, ${s.locale.citta}`, coperto_cents: s.locale.copertoCents },
    gruppoId: G,
    operatori: s.operatori.map((o) => ({ id: o.id, locale_id: L, nome: o.nome, ruolo: o.ruolo as RuoloOperatore, attivo: true, permessi: {}, pin: o.pin })),
    listini: [{ id: LIST, locale_id: L, nome: 'Sala', predefinito: true }],
    aliquote_iva: s.aliquote.map((a) => ({ id: a.id, locale_id: L, descrizione: a.descrizione, percentuale: a.percentuale, reparto_rt: a.repartoRt })),
    stampanti: s.stampanti.map((x) => ({ id: x.id, locale_id: L, nome: x.nome, tipo: x.tipo, host: x.host, porta: x.porta, colonne: x.colonne, per_preconto: !!x.perPreconto, matricola_rt: x.tipo === 'comande_escpos' ? null : x.matricolaRt ?? '', attiva: true, codepage: x.codePage ?? 19, modello: x.modello ?? null })),
    centri_produzione: s.centri.map((c) => ({ id: c.id, locale_id: L, nome: c.nome, stampante_id: c.stampanteId })),
    categorie: s.categorie.map((c) => ({ id: c.id, locale_id: L, nome: c.nome, colore: c.colore, ordine: c.ordine, centro_produzione_id: c.centroProduzioneId, portata_predefinita: c.portataPredefinita })),
    articoli: s.articoli.map((a, i) => ({
      id: a.id, locale_id: L, categoria_id: a.categoriaId, nome: a.nome, nome_breve: a.nomeBreve ?? null, aliquota_iva_id: a.aliquotaIvaId,
      centro_produzione_id: a.centroProduzioneId && a.centroProduzioneId !== centroCategoria(a.categoriaId) ? a.centroProduzioneId : null,
      allergeni: a.allergeni, esaurito: a.esaurito, ordine: i, attivo: true, descrizione: a.descrizione ? { it: a.descrizione } : null,
    })),
    prezzi_listino: s.articoli.map((a) => ({ listino_id: LIST, articolo_id: a.id, prezzo_cents: a.prezzoCents })),
    varianti: s.varianti.map((v) => ({ id: v.id, locale_id: L, gruppo: v.gruppo || null, nome: v.nome, delta_cents: v.deltaCents })),
    articolo_varianti: s.articoli.flatMap((a) => a.variantiIds.map((v) => ({ articolo_id: a.id, variante_id: v }))),
    sale: s.sale.map((x) => ({ id: x.id, locale_id: L, nome: x.nome, ordine: x.ordine })),
    tavoli: s.tavoli.map((x) => ({ id: x.id, locale_id: L, sala_id: x.salaId, numero: x.numero, forma: x.forma, x: x.x, y: x.y, larghezza: x.larghezza, altezza: x.altezza, posti: x.posti, attivo: true })),
    fornitori: [], mag_articoli: [], scorte: [], distinte: [], movimenti: [],
  };
  return t;
}

/** Magazzino di esempio per la demo. */
export function magazzinoDemo(t: Tabelle): Tabelle {
  const G = t.gruppoId, L = t.locale.id;
  const fornitori: FornitoreRiga[] = [
    { id: 'f-marr', gruppo_id: G, ragione_sociale: 'MARR', piva: null, email_ordini: null },
    { id: 'f-caseificio', gruppo_id: G, ragione_sociale: 'Caseificio dei Monti Lattari', piva: null, email_ordini: null },
  ];
  const m = (id: string, nome: string, um_uso: string, um_acquisto: string, fattore: number, fornitore_id: string, costo: number): MagArticoloRiga =>
    ({ id, gruppo_id: G, nome, um_acquisto, um_uso, fattore, fornitore_id, costo_ultimo_cents: costo });
  const mag_articoli = [
    m('m-spaghettone', 'Spaghettone di Gragnano', 'kg', 'cartone 6 kg', 6, 'f-marr', 420),
    m('m-pecorino', 'Pecorino romano DOP', 'kg', 'forma 1 kg', 1, 'f-caseificio', 1800),
    m('m-pepe', 'Pepe nero in grani', 'kg', 'busta 0,5 kg', 0.5, 'f-marr', 2400),
    m('m-provola', 'Provola affumicata', 'kg', 'pezzo 1 kg', 1, 'f-caseificio', 1100),
    m('m-acqua-nat', 'Acqua naturale 0,75', 'pz', 'cassa 12 pz', 12, 'f-marr', 45),
  ];
  const sc = (id: string, g: number, min: number): ScortaRiga => ({ locale_id: L, mag_articolo_id: id, giacenza: g, scorta_min: min, scorta_max: null });
  const scorte = [sc('m-spaghettone', 7.5, 3), sc('m-pecorino', 1.2, 2), sc('m-pepe', 0.4, 0.2), sc('m-provola', 2, 1), sc('m-acqua-nat', 40, 24)];
  const cacio = t.articoli.find((a) => /cacio e pepe|scialatielli/i.test(a.nome))?.id;
  const acqua = t.articoli.find((a) => /acqua naturale|naturale electa/i.test(a.nome))?.id;
  const distinte: DistintaRiga[] = [
    ...(cacio ? [
      { articolo_id: cacio, mag_articolo_id: 'm-spaghettone', quantita: 0.12, resa_pct: 100 },
      { articolo_id: cacio, mag_articolo_id: 'm-pecorino', quantita: 0.06, resa_pct: 90 },
      { articolo_id: cacio, mag_articolo_id: 'm-pepe', quantita: 0.003, resa_pct: 100 },
    ] : []),
    ...(acqua ? [{ articolo_id: acqua, mag_articolo_id: 'm-acqua-nat', quantita: 1, resa_pct: 100 }] : []),
  ];
  return { ...t, fornitori, mag_articoli, scorte, distinte };
}

// ------------------------------------------------------------------ archivio in memoria (demo e test)

const nuovoId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
const oggi = () => new Date().toISOString().slice(0, 10);

export class MemoriaArchivio implements Archivio {
  private t: Tabelle;
  private listeners = new Set<() => void>();

  /** onCambio riceve le tabelle dopo ogni modifica (la demo ci ricostruisce la sala e il listino). */
  constructor(t: Tabelle, private onCambio?: (t: Tabelle) => void) { this.t = structuredClone(t); }

  tabelle() { return this.t; }
  async ricarica() {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private cambiato() { this.t = { ...this.t }; this.onCambio?.(this.t); for (const l of this.listeners) l(); }

  private uguale<T extends NomeTabella>(tabella: T, a: Partial<RigaDi<T>>, b: Partial<RigaDi<T>>) {
    return CHIAVI[tabella].every((k) => (a as any)[k] === (b as any)[k]);
  }

  async salva<T extends NomeTabella>(tabella: T, riga: Partial<RigaDi<T>>): Promise<RigaDi<T>> {
    const lista = this.t[tabella] as RigaDi<T>[];
    const base: any = { ...riga };
    if (CHIAVI[tabella].length === 1 && !base.id) base.id = nuovoId();
    if ('locale_id' in base === false && ['categorie', 'articoli', 'varianti', 'sale', 'tavoli', 'scorte', 'stampanti', 'centri_produzione'].includes(tabella)) base.locale_id = this.t.locale.id;
    if ('gruppo_id' in base === false && ['fornitori', 'mag_articoli'].includes(tabella)) base.gruppo_id = this.t.gruppoId;
    if (tabella === 'tavoli' && base.numero != null) {
      const doppio = this.t.tavoli.find((x) => x.numero === base.numero && x.id !== base.id && x.attivo);
      if (doppio) throw new ErroreGestione(`Esiste già un tavolo numero ${base.numero}.`);
    }
    const i = lista.findIndex((x) => this.uguale(tabella, x, base));
    const salvata = (i >= 0 ? { ...lista[i], ...base } : base) as RigaDi<T>;
    (this.t as any)[tabella] = i >= 0 ? lista.map((x, j) => (j === i ? salvata : x)) : [...lista, salvata];
    this.cambiato();
    return salvata;
  }

  async elimina<T extends NomeTabella>(tabella: T, chiave: Partial<RigaDi<T>>) {
    const id = (chiave as any).id as string | undefined;
    if (tabella === 'categorie' && this.t.articoli.some((a) => a.categoria_id === id && a.attivo))
      throw new ErroreGestione('La categoria contiene ancora articoli: spostali o archiviali prima.');
    if (tabella === 'sale' && this.t.tavoli.some((x) => x.sala_id === id && x.attivo))
      throw new ErroreGestione('La sala contiene ancora tavoli: eliminali prima.');
    if (tabella === 'mag_articoli' && (this.t.distinte.some((d) => d.mag_articolo_id === id) || this.t.movimenti.some((m) => m.righe.some((r) => r.mag_articolo_id === id))))
      throw new ErroreGestione('Il prodotto è usato in una ricetta o in un movimento: non si può eliminare.');
    (this.t as any)[tabella] = (this.t[tabella] as RigaDi<T>[]).filter((x) => !this.uguale(tabella, x, chiave));
    // Come il database: cascate e "set null".
    if (tabella === 'mag_articoli') this.t.scorte = this.t.scorte.filter((s) => s.mag_articolo_id !== id);
    if (tabella === 'varianti') this.t.articolo_varianti = this.t.articolo_varianti.filter((x) => x.variante_id !== id);
    if (tabella === 'fornitori') this.t.mag_articoli = this.t.mag_articoli.map((m) => (m.fornitore_id === id ? { ...m, fornitore_id: null } : m));
    if (tabella === 'stampanti') this.t.centri_produzione = this.t.centri_produzione.map((c) => (c.stampante_id === id ? { ...c, stampante_id: null } : c));
    if (tabella === 'categorie') this.t.articoli = this.t.articoli.filter((a) => a.categoria_id !== id);
    this.cambiato();
  }

  async salvaOperatore(o: NuovoOperatore) {
    if (!o.nome.trim()) throw new ErroreGestione('Manca il nome.');
    if (o.pin != null) {
      if (!/^\d{4,6}$/.test(o.pin)) throw new ErroreGestione('Il PIN deve avere da 4 a 6 cifre.');
      if (this.t.operatori.some((x) => x.attivo && x.id !== o.id && x.pin === o.pin)) throw new ErroreGestione('Questo PIN è già usato da un altro operatore.');
    } else if (!o.id) throw new ErroreGestione('Il PIN deve avere da 4 a 6 cifre.');
    const riga: OperatoreRiga = {
      ...(this.t.operatori.find((x) => x.id === o.id) ?? { id: nuovoId(), locale_id: this.t.locale.id, permessi: {} }),
      nome: o.nome.trim(), ruolo: o.ruolo, attivo: o.attivo, ...(o.permessi ? { permessi: o.permessi } : {}), ...(o.pin ? { pin: o.pin } : {}),
    } as OperatoreRiga;
    this.t.operatori = o.id ? this.t.operatori.map((x) => (x.id === o.id ? riga : x)) : [...this.t.operatori, riga];
    this.cambiato();
  }

  async registraMovimento(m: NuovoMovimento) {
    if (!m.righe.length) throw new ErroreGestione('Aggiungi almeno un prodotto.');
    const L = this.t.locale.id;
    const mov: MovimentoRiga = {
      id: nuovoId(), locale_id: L, tipo: m.tipo, data: m.data ?? oggi(), fornitore_id: m.fornitoreId ?? null,
      rif_documento: m.rif || null, operatore_id: m.operatoreId ?? null, created_at: new Date().toISOString(), righe: [],
    };
    let scorte = [...this.t.scorte];
    let mag = [...this.t.mag_articoli];
    for (const r of m.righe) {
      const i = scorte.findIndex((s) => s.mag_articolo_id === r.magArticoloId);
      const attuale = i >= 0 ? Number(scorte[i].giacenza) : 0;
      const delta = deltaMovimento(m.tipo, r.quantita, attuale);
      const nuova: ScortaRiga = i >= 0 ? { ...scorte[i], giacenza: attuale + delta } : { locale_id: L, mag_articolo_id: r.magArticoloId, giacenza: delta, scorta_min: null, scorta_max: null };
      scorte = i >= 0 ? scorte.map((s, j) => (j === i ? nuova : s)) : [...scorte, nuova];
      mov.righe.push({ mag_articolo_id: r.magArticoloId, quantita: delta, costo_unitario_cents: r.costoCents ?? null });
      if (m.tipo === 'carico' && r.costoCents != null) mag = mag.map((x) => (x.id === r.magArticoloId ? { ...x, costo_ultimo_cents: r.costoCents! } : x));
    }
    this.t.scorte = scorte;
    this.t.mag_articoli = mag;
    this.t.movimenti = [mov, ...this.t.movimenti];
    this.cambiato();
  }
}
