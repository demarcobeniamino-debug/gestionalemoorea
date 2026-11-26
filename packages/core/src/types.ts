// Tipi di dominio. Rispecchiano replica/schema.sql (sottoinsieme della fase 1).

export type Cents = number;

export type Allergene =
  | 'glutine' | 'crostacei' | 'uova' | 'pesce' | 'arachidi' | 'soia' | 'latte'
  | 'frutta_a_guscio' | 'sedano' | 'senape' | 'sesamo' | 'solfiti' | 'lupini' | 'molluschi';

export const ALLERGENI_ETICHETTA: Record<Allergene, string> = {
  glutine: 'Glutine', crostacei: 'Crostacei', uova: 'Uova', pesce: 'Pesce', arachidi: 'Arachidi',
  soia: 'Soia', latte: 'Latte', frutta_a_guscio: 'Frutta a guscio', sedano: 'Sedano',
  senape: 'Senape', sesamo: 'Sesamo', solfiti: 'Solfiti', lupini: 'Lupini', molluschi: 'Molluschi',
};

export type TipoStampante = 'comande_escpos' | 'rt_epson_xml' | 'rt_rch' | 'rt_custom';

export interface Stampante {
  id: string;
  nome: string;
  tipo: TipoStampante;
  host: string;
  porta: number;
  colonne: 32 | 42 | 48;
  perPreconto?: boolean;
  matricolaRt?: string;
  /** Set di caratteri ESC/POS (ESC t n). 19 = PC858. */
  codePage?: number;
  /** Marca e modello riconosciuti dalla ricerca in rete. */
  modello?: string;
}

export interface CentroProduzione { id: string; nome: string; stampanteId: string | null; }

export interface AliquotaIva { id: string; descrizione: string; percentuale: number; repartoRt: number; }

export interface Sala { id: string; nome: string; ordine: number; }

export type FormaTavolo = 'tondo' | 'quadrato' | 'rettangolo' | 'sgabello';

export interface Tavolo {
  id: string; salaId: string; numero: string; forma: FormaTavolo;
  x: number; y: number; larghezza: number; altezza: number; posti: number;
}

export interface Categoria {
  id: string; nome: string; colore: string; testoColore: string; ordine: number;
  centroProduzioneId: string | null; portataPredefinita: number;
}

export interface Variante { id: string; gruppo: string; nome: string; deltaCents: Cents; }

export interface Articolo {
  id: string; categoriaId: string; nome: string; nomeBreve?: string; prezzoCents: Cents;
  aliquotaIvaId: string; centroProduzioneId?: string | null; allergeni: Allergene[];
  esaurito: boolean; variantiIds: string[];
  /** Ingredienti o uvaggio, per rispondere al cliente. */
  descrizione?: string;
}

export type StatoComanda = 'aperta' | 'preconto' | 'chiusa' | 'annullata';

export interface Comanda {
  id: string; numero: number; tavoloId: string | null; coperti: number;
  operatore: string; stato: StatoComanda; apertaAt: string; chiusaAt?: string;
  allergeniTavolo: { allergene: Allergene; posto?: number }[];
  version: number;
  /** Prenotazione di Table Flow da cui è stato aperto il tavolo. */
  prenotazioneId?: string;
}

export type StatoRiga =
  | 'da_inviare' | 'in_attesa_marcia' | 'inviata' | 'in_preparazione' | 'pronta' | 'servita' | 'stornata';

export interface RigaVariante { nome: string; deltaCents: Cents; }

export interface RigaComanda {
  id: string; comandaId: string; articoloId: string; descrizione: string;
  quantita: number; prezzoUnitarioCents: Cents; varianti: RigaVariante[]; note?: string;
  portata: number; centroProduzioneId: string | null; aliquotaIvaId: string;
  allergeni: Allergene[]; posto?: number; omaggio: boolean; stato: StatoRiga;
  motivoStorno?: string; inviataAt?: string; createdAt: string;
}

export type TipoPagamento = 'contanti' | 'carta' | 'buono_pasto' | 'prepagata' | 'sospeso' | 'camera';
export type TipoPagamentoRt = 'contanti' | 'elettronico' | 'ticket' | 'non_riscosso';

export const PAGAMENTO_RT: Record<TipoPagamento, TipoPagamentoRt> = {
  contanti: 'contanti', carta: 'elettronico', buono_pasto: 'ticket',
  prepagata: 'elettronico', sospeso: 'non_riscosso', camera: 'non_riscosso',
};

export interface Pagamento { tipo: TipoPagamento; importoCents: Cents; }

export type StatoDocumento = 'bozza' | 'in_emissione' | 'emesso' | 'errore' | 'da_verificare' | 'annullato';

export interface RigaDocumento {
  descrizione: string; quantita: number; prezzoUnitarioCents: Cents; repartoRt: number;
}

export interface Documento {
  id: string; comandaId: string; tipo: 'documento_commerciale' | 'annullo';
  /** Per un annullo: lo scontrino annullato. */
  origineId?: string;
  stato: StatoDocumento; righe: RigaDocumento[]; scontoCents: Cents; totaleCents: Cents;
  pagamenti: Pagamento[]; quota?: { indice: number; di: number };
  rtZNumero?: number; rtDocNumero?: number; rtData?: string; errore?: string;
  idempotencyKey: string; createdAt: string;
}

export type TipoLavoro = 'comanda' | 'preconto' | 'documento_commerciale' | 'annullo' | 'chiusura_fiscale';
export type StatoLavoro = 'in_coda' | 'preso' | 'stampato' | 'errore' | 'da_verificare';

export interface PrintJob {
  id: string; tipo: TipoLavoro; stampanteId: string; stato: StatoLavoro;
  idempotencyKey: string; documentoId?: string; comandaId?: string;
  ticket?: import('./ticket').Ticket; xml?: string; errore?: string; tentativi: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Prenotazioni (arrivano da Moorea Table Flow)
export type StatoPrenotazione = 'richiesta' | 'confermata' | 'arrivata' | 'mancata' | 'cancellata' | 'terminata';

export interface Prenotazione {
  id: string; nome: string; telefono?: string; coperti: number;
  inizio: string; fine: string; stato: StatoPrenotazione; fonte: string;
  note?: string; allergeni: Allergene[]; tag: string[];
  /** Tavolo della cassa collegato (stesso numero di Table Flow), se c'è. */
  tavoloId: string | null;
  /** Codici dei tavoli su Table Flow, anche più tavoli uniti (es. ["10","11"]). */
  tavoliExt: string[];
}

/** Prenotazione ancora da far sedere? */
export const daAccogliere = (p: Prenotazione) => p.stato === 'confermata' || p.stato === 'richiesta';
