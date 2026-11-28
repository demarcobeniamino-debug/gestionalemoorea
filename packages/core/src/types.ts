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
  /** Cliente dell'anagrafica collegato al conto (per storico, allergie e fattura). */
  clienteId?: string;
  /** Senza tavolo: banco o asporto, con un nome ("Banco", "Marco"). */
  canale?: 'tavolo' | 'banco' | 'asporto';
  etichetta?: string;
  /** Altri tavoli uniti a questo (gruppo grande): risultano occupati e portano a questo conto. */
  tavoliUniti?: string[];
  /** Chiuso come proforma: niente scontrino né incasso, i prodotti escono comunque dal magazzino. */
  proforma?: Proforma;
}

/** Conto chiuso senza incasso (famiglia, amici, staff): valore registrato, nessun documento fiscale. */
export interface Proforma { motivo: string; nome?: string; totaleCents: number; operatore?: string }

export type StatoRiga =
  | 'da_inviare' | 'in_attesa_marcia' | 'inviata' | 'in_preparazione' | 'pronta' | 'servita' | 'stornata';

export interface RigaVariante { nome: string; deltaCents: Cents; /** Sconto automatico di una promozione (happy hour): non va in cucina. */ promo?: boolean }

export interface RigaComanda {
  id: string; comandaId: string;
  /** null = voce libera (es. "pasta al pomodoro" fuori menu). */
  articoloId: string | null; descrizione: string;
  quantita: number; prezzoUnitarioCents: Cents; varianti: RigaVariante[]; note?: string;
  portata: number; centroProduzioneId: string | null; aliquotaIvaId: string;
  allergeni: Allergene[]; posto?: number; omaggio: boolean; stato: StatoRiga;
  motivoStorno?: string; inviataAt?: string; createdAt: string;
  /** Piatto scelto dentro un menu fisso: prezzo 0, il prezzo è sulla riga del menu. */
  parentId?: string;
}

export type TipoPagamento = 'contanti' | 'carta' | 'buono_pasto' | 'prepagata' | 'sospeso' | 'camera' | 'bonifico';
export type TipoPagamentoRt = 'contanti' | 'elettronico' | 'ticket' | 'non_riscosso';

export const PAGAMENTO_RT: Record<TipoPagamento, TipoPagamentoRt> = {
  contanti: 'contanti', carta: 'elettronico', buono_pasto: 'ticket',
  prepagata: 'elettronico', sospeso: 'non_riscosso', camera: 'non_riscosso', bonifico: 'elettronico',
};

export interface Pagamento {
  tipo: TipoPagamento; importoCents: Cents;
  /** Nome del metodo (Satispay, emittente del buono), camera o cliente del sospeso, oppure "caparra:<id>". */
  descrizione?: string;
}

export type StatoDocumento = 'bozza' | 'in_emissione' | 'emesso' | 'errore' | 'da_verificare' | 'annullato';

export interface RigaDocumento {
  descrizione: string; quantita: number; prezzoUnitarioCents: Cents; repartoRt: number;
}

export interface Documento {
  id: string; comandaId: string; tipo: 'documento_commerciale' | 'annullo' | 'reso';
  /** Per un annullo o un reso: lo scontrino di partenza. */
  origineId?: string;
  stato: StatoDocumento; righe: RigaDocumento[]; scontoCents: Cents; totaleCents: Cents;
  pagamenti: Pagamento[]; quota?: { indice: number; di: number };
  rtZNumero?: number; rtDocNumero?: number; rtData?: string; errore?: string;
  idempotencyKey: string; createdAt: string;
}

export type TipoLavoro = 'comanda' | 'preconto' | 'non_fiscale' | 'documento_commerciale' | 'annullo' | 'reso' | 'chiusura_fiscale';
export type StatoLavoro = 'in_coda' | 'preso' | 'stampato' | 'errore' | 'da_verificare' | 'annullato' | 'sospeso';

/** La cassa che stampa batte un colpo ogni 30 secondi (con lo stato del registratore). */
export interface PonteStampa { nome: string; versione?: string; vistoAt: string; statoRt?: import('./epson').StatoRt; statoRtAt?: string }
/** Un ponte è vivo se si è fatto sentire negli ultimi 90 secondi. */
export const ponteVivo = (p: PonteStampa, adesso = Date.now()) => adesso - new Date(p.vistoAt).getTime() < 90_000;
/** Dopo quanto un lavoro mai partito smette di uscire da solo. */
export const MINUTI_SOSPENSIONE = 10;

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

// ---------------------------------------------------------------------------
// Messaggi ai reparti
export type TipoMessaggio = 'messaggio' | 'marcia' | 'sollecito';

export interface MessaggioReparto {
  id: string; centroId: string | null; comandaId: string | null; tipo: TipoMessaggio;
  testo: string; portata?: number; operatore: string; createdAt: string; vistoAt?: string;
}

// ---------------------------------------------------------------------------
// Clienti (anagrafica del gruppo, condivisa tra i locali)
export interface IndirizzoFiscale {
  via: string; civico?: string; cap: string; comune: string; provincia?: string; nazione: string;
}

export interface Cliente {
  id: string; nome: string; cognome?: string; telefono?: string; email?: string;
  compleanno?: string; preferenze?: string; allergeni: Allergene[]; noteAllergie?: string;
  scontoPct: number;
  ragioneSociale?: string; piva?: string; codiceFiscale?: string; codiceSdi?: string; pec?: string;
  indirizzoFiscale?: IndirizzoFiscale; consensoMarketing: boolean; createdAt?: string;
}

export const nomeCliente = (c: Pick<Cliente, 'nome' | 'cognome' | 'ragioneSociale'>) =>
  c.ragioneSociale?.trim() || [c.nome, c.cognome].filter(Boolean).join(' ');

export interface StoricoCliente {
  visite: number; spesaCents: number; ultimaVisita?: string;
  piatti: { descrizione: string; quantita: number }[];
  fatture: Fattura[];
}

// ---------------------------------------------------------------------------
// Fatture elettroniche
export type StatoFattura = 'da_inviare' | 'inviata' | 'scartata' | 'annullata';

export interface Fattura {
  id: string; anno: number; numero: number; data: string; clienteId: string | null;
  documentoId: string | null; comandaId: string | null;
  imponibileCents: Cents; ivaCents: Cents; totaleCents: Cents; xml: string; stato: StatoFattura;
  intestatario: string; createdAt: string;
}

/** Dati del locale per fatturare (cedente/prestatore). */
export interface DatiFiscali {
  ragioneSociale: string; piva: string; codiceFiscale?: string;
  regime: string; via: string; civico?: string; cap: string; comune: string; provincia: string;
  rea?: { ufficio: string; numero: string };
  telefono?: string; email?: string;
}

// ---------------------------------------------------------------------------
// Cassa: sospesi, caparre, movimenti
export interface Sospeso {
  id: string; documentoId: string; comandaId: string | null; clienteId: string | null;
  tipo: 'sospeso' | 'camera'; descrizione?: string; importoCents: Cents;
  stato: 'aperto' | 'incassato' | 'annullato'; createdAt: string; incassatoAt?: string; incassatoTipo?: TipoPagamento;
}

export interface Caparra {
  id: string; nome: string; clienteId: string | null; importoCents: Cents;
  metodo: 'contanti' | 'carta' | 'bonifico' | 'prepagata'; nota?: string;
  stato: 'aperta' | 'usata' | 'restituita'; documentoId?: string; createdAt: string;
}

export type TipoMovimentoCassa = 'fondo' | 'versamento' | 'prelievo' | 'conteggio';
export interface MovimentoCassa { id: string; tipo: TipoMovimentoCassa; importoCents: Cents; causale?: string; operatore: string; createdAt: string }

// ---------------------------------------------------------------------------
// Impostazioni del locale (metodi di pagamento, promozioni, menu fissi, abbinamenti)
export interface MetodoPagamento { id: string; nome: string; tipo: Exclude<TipoPagamento, 'sospeso' | 'camera'>; attivo: boolean }
export interface BuonoPasto { id: string; nome: string; valoreCents?: Cents }
export interface Promozione {
  id: string; nome: string; attiva: boolean;
  /** Sconto in percentuale, oppure prezzo fisso. */
  percentuale?: number; prezzoCents?: Cents;
  categorieIds: string[]; articoliIds: string[];
  /** 0 = domenica … 6 = sabato; vuoto = tutti i giorni. */
  giorni: number[]; dalle: string; alle: string;
}
export interface GruppoMenu { nome: string; articoliIds: string[]; scelte: number; portata: number }
export interface MenuFisso { gruppi: GruppoMenu[] }
export interface Impostazioni {
  metodi?: MetodoPagamento[];
  buoniPasto?: BuonoPasto[];
  promozioni?: Promozione[];
  menuFissi?: Record<string, MenuFisso>;
  abbinamenti?: Record<string, string[]>;
  /** POS bancari del locale: collegati alla cassa (Protocollo 17) o usati a mano. */
  pos?: import('./pos17').PosConfig[];
}
