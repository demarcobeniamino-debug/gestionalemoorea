// Livello dati sul database vero (Supabase).
// Letture: dalla cache locale, aggiornata all'avvio e a ogni cambiamento (Realtime).
// Scritture: funzioni del server (RPC) o tabelle protette da RLS; poi la cache si ricarica.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ErroreDominio, nuovaRiga, preparaAnnullo, preparaChiusura, preparaIncasso, preparaInvio, preparaPreconto, preparaStorno,
  type Allergene, type Comanda, type DataLayer, type Documento, type EsitoLavoro, type Incasso, type NuovaRiga,
  type Operatore, type PrintJob, type RigaComanda, type Setup, setupDaTabelle, type Prenotazione,
  type Cliente, type ClienteNuovo, type DatiFiscali, type Fattura, type MessaggioReparto, type NuovaFattura, type NuovoMessaggio,
  type StatoFattura, type StoricoCliente, type Ticket, preparaMessaggio, rigaUguale,
} from '@gr/core';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigurato = () => !!URL && !!KEY;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) client = createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

// Messaggi comprensibili per gli errori del server.
const MESSAGGI: Record<string, string> = {
  TAVOLO_GIA_APERTO: 'Il tavolo è già stato aperto da un altro dispositivo.',
  COMANDA_CAMBIATA: 'La comanda è stata aggiornata da un altro palmare. Controlla e invia di nuovo.',
  COMANDA_CHIUSA: 'Questa comanda è già chiusa.',
  SCONTRINO_IN_SOSPESO: 'C’è uno scontrino in stampa o da verificare: controlla la cassa prima di continuare.',
  RIGHE_NON_INVIATE: 'Ci sono righe non ancora inviate in cucina.',
  MOTIVO_MANCANTE: 'Serve il motivo dello storno.',
  NON_AUTORIZZATO: 'Questo dispositivo non è autorizzato per il locale.',
  CONTO_GIA_PAGATO_IN_PARTE: 'Il conto è già stato pagato in parte: non si può unire o spostare.',
  STESSO_TAVOLO: 'È lo stesso tavolo.',
  DOCUMENTO_NON_ANNULLABILE: 'Questo scontrino non si può annullare.',
  ANNULLO_GIA_RICHIESTO: 'L’annullo di questo scontrino è già stato richiesto.',
  PIN_GIA_USATO: 'Questo PIN è già usato da un altro operatore.',
  PIN_NON_VALIDO: 'Il PIN deve avere da 4 a 6 cifre.',
  NOME_MANCANTE: 'Manca il nome.',
  TESTO_MANCANTE: 'Scrivi il messaggio.',
  FATTURA_GIA_EMESSA: 'Questo scontrino ha già la sua fattura.',
  righe_comanda_libera_check: 'Scrivi cosa aggiungere.',
};
function errore(e: { message?: string } | null): never {
  const codice = Object.keys(MESSAGGI).find((k) => e?.message?.includes(k));
  throw new ErroreDominio(codice ? MESSAGGI[codice] : `Errore del server: ${e?.message ?? 'sconosciuto'}`);
}

type Riga = Record<string, any>;

export class SupabaseDataLayer implements DataLayer {
  private sb = supabase();
  private _setup!: Setup;
  private _comande: Comanda[] = [];
  private _righe: RigaComanda[] = [];
  private _documenti: Documento[] = [];
  private _lavori: PrintJob[] = [];
  private _prenotazioni: Prenotazione[] = [];
  private _messaggi: MessaggioReparto[] = [];
  private gruppoId = '';
  private listeners = new Set<() => void>();
  private ricarica?: ReturnType<typeof setTimeout>;

  private constructor(private localeId: string) {}

  static async avvia(): Promise<SupabaseDataLayer> {
    const { data, error } = await supabase().rpc('inizializza_locale');
    if (error) errore(error);
    const db = new SupabaseDataLayer(data as string);
    await db.caricaSetup();
    await db.caricaServizio();
    db.ascolta();
    return db;
  }

  // ------------------------------------------------------------------ caricamento
  private async caricaSetup() {
    const q = (t: string, cols = '*') => this.sb.from(t).select(cols).then(({ data, error }) => { if (error) errore(error); return (data ?? []) as Riga[]; });
    const [locale] = await q('locali');
    this.gruppoId = locale?.gruppo_id ?? '';
    const [stampanti, centri, aliquote, sale, tavoli, categorie, articoli, prezzi, listini, varianti, av, operatori] = await Promise.all([
      q('stampanti'), q('centri_produzione'), q('aliquote_iva'), q('sale'), q('tavoli'), q('categorie'), q('articoli'),
      q('prezzi_listino'), q('listini'), q('varianti'), q('articolo_varianti'), q('operatori', 'id,nome,ruolo,attivo'),
    ]);
    this._setup = setupDaTabelle({
      locale: locale as any, listini: listini as any, aliquote_iva: aliquote as any, stampanti: stampanti as any,
      centri_produzione: centri as any, categorie: categorie as any, articoli: articoli as any, prezzi_listino: prezzi as any,
      varianti: varianti as any, articolo_varianti: av as any, sale: sale as any, tavoli: tavoli as any,
    }, operatori.filter((o) => o.attivo).map((o) => ({ id: o.id, nome: o.nome, ruolo: o.ruolo })));
  }

  /** La Gestione ha salvato: rilegge listino, sale e stampanti senza aspettare il tempo reale. */
  async ricaricaSetup() { await this.caricaSetup(); this.emit(); }

  private mappaComanda = (c: Riga): Comanda => ({
    id: c.id, numero: c.numero, tavoloId: c.tavolo_id, coperti: c.coperti, operatore: this.nomeOperatore(c.operatore_id),
    stato: c.stato, apertaAt: c.aperta_at, chiusaAt: c.chiusa_at ?? undefined, allergeniTavolo: c.allergeni_tavolo ?? [], version: c.version,
    prenotazioneId: c.prenotazione_id ?? undefined, clienteId: c.cliente_id ?? undefined,
  });

  private mappaMessaggio = (m: Riga): MessaggioReparto => ({
    id: m.id, centroId: m.centro_id, comandaId: m.comanda_id, tipo: m.tipo, testo: m.testo, portata: m.portata ?? undefined,
    operatore: this.nomeOperatore(m.operatore_id), createdAt: m.created_at, vistoAt: m.visto_at ?? undefined,
  });

  private mappaCliente = (c: Riga): Cliente => ({
    id: c.id, nome: c.nome, cognome: c.cognome ?? undefined, telefono: c.telefono ?? undefined, email: c.email ?? undefined,
    compleanno: c.compleanno ?? undefined, preferenze: c.preferenze ?? undefined, allergeni: c.allergeni ?? [], noteAllergie: c.note_allergie ?? undefined,
    scontoPct: Number(c.sconto_pct ?? 0), ragioneSociale: c.ragione_sociale ?? undefined, piva: c.piva ?? undefined,
    codiceFiscale: c.codice_fiscale ?? undefined, codiceSdi: c.codice_sdi ?? undefined, pec: c.pec ?? undefined,
    indirizzoFiscale: c.indirizzo_fiscale ?? undefined, consensoMarketing: !!c.consenso_marketing, createdAt: c.created_at,
  });

  private mappaFattura = (f: Riga): Fattura => ({
    id: f.id, anno: f.anno, numero: f.numero, data: f.data, clienteId: f.cliente_id, documentoId: f.documento_id, comandaId: f.comanda_id,
    imponibileCents: f.imponibile_cents, ivaCents: f.iva_cents, totaleCents: f.totale_cents, xml: f.xml, stato: f.stato,
    intestatario: f.dati?.intestatario ?? '', createdAt: f.created_at,
  });

  private mappaRiga = (r: Riga): RigaComanda => ({
    id: r.id, comandaId: r.comanda_id, articoloId: r.articolo_id, descrizione: r.descrizione, quantita: Number(r.quantita),
    prezzoUnitarioCents: r.prezzo_unitario_cents, varianti: r.varianti ?? [], note: r.note ?? undefined, portata: r.portata,
    centroProduzioneId: r.centro_produzione_id, aliquotaIvaId: r.aliquota_iva_id, allergeni: r.allergeni ?? [], posto: r.posto ?? undefined,
    omaggio: r.omaggio, stato: r.stato, motivoStorno: r.motivo_storno ?? undefined, inviataAt: r.inviata_at ?? undefined, createdAt: r.created_at,
  });

  private mappaDocumento = (d: Riga): Documento => ({
    id: d.id, comandaId: d.comanda_id ?? '', tipo: d.tipo === 'annullo' ? 'annullo' : 'documento_commerciale', stato: d.stato,
    origineId: d.documento_origine_id ?? undefined,
    righe: (d.righe_documento ?? []).map((x: Riga) => ({ descrizione: x.descrizione, quantita: Number(x.quantita), prezzoUnitarioCents: x.prezzo_unitario_cents, repartoRt: x.reparto_rt })),
    scontoCents: d.sconto_cents, totaleCents: d.totale_cents,
    pagamenti: (d.pagamenti ?? []).map((p: Riga) => ({ tipo: p.tipo, importoCents: p.importo_cents })),
    quota: d.quota_di ? { indice: d.quota_indice, di: d.quota_di } : undefined,
    rtZNumero: d.rt_z_numero ?? undefined, rtDocNumero: d.rt_doc_numero ?? undefined, errore: d.errore ?? undefined,
    rtData: d.rt_emesso_at ? new Date(d.rt_emesso_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined,
    idempotencyKey: d.idempotency_key, createdAt: d.created_at,
  });

  /** Legge tutte le righe di una query a blocchi (il server ne dà al massimo 1000 per volta). */
  private async tutte(q: () => any): Promise<Riga[]> {
    const out: Riga[] = [];
    for (let da = 0; ; da += 1000) {
      const { data, error } = await q().range(da, da + 999);
      if (error) errore(error);
      out.push(...((data ?? []) as Riga[]));
      if (!data || data.length < 1000) return out;
    }
  }

  private nomeOperatore = (id?: string | null) => this._setup.operatori.find((o) => o.id === id)?.nome ?? '';

  /** Stato del servizio: comande aperte (+ chiuse da poco), righe, scontrini e lavori di stampa recenti. */
  private async caricaServizio() {
    const da = new Date(Date.now() - 12 * 3600_000).toISOString();
    const { data: comande, error } = await this.sb.from('comande').select('*').or(`stato.in.(aperta,preconto),chiusa_at.gte.${da}`);
    if (error) errore(error);
    const ids = (comande ?? []).map((c) => c.id);
    const [righe, documenti, lavori] = ids.length
      ? await Promise.all([
          this.sb.from('righe_comanda').select('*').in('comanda_id', ids),
          this.sb.from('documenti').select('*, righe_documento(*), pagamenti(*)').in('comanda_id', ids),
          this.sb.from('print_jobs').select('*').gte('created_at', da).order('created_at'),
        ])
      : [{ data: [] }, { data: [] }, await this.sb.from('print_jobs').select('*').gte('created_at', da).order('created_at')];
    this._comande = (comande ?? []).map(this.mappaComanda);
    this._righe = ((righe.data ?? []) as Riga[]).map(this.mappaRiga).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this._documenti = ((documenti.data ?? []) as Riga[]).map(this.mappaDocumento);
    this._lavori = ((lavori.data ?? []) as Riga[]).map(this.mappaLavoro);
    const { data: msg } = await this.sb.from('messaggi_reparto').select('*').gte('created_at', da).order('created_at', { ascending: false }).limit(200);
    this._messaggi = ((msg ?? []) as Riga[]).map(this.mappaMessaggio);
    // Prenotazioni della serata: da 8 ore fa a 18 ore avanti (copre pranzo, cena e il dopo mezzanotte).
    const { data: pren } = await this.sb.from('prenotazioni').select('*')
      .gte('inizio_at', new Date(Date.now() - 8 * 3600_000).toISOString())
      .lt('inizio_at', new Date(Date.now() + 18 * 3600_000).toISOString())
      .neq('stato', 'cancellata').order('inizio_at');
    this._prenotazioni = ((pren ?? []) as Riga[]).map((p): Prenotazione => ({
      id: p.id, nome: p.nome_ospite, telefono: p.telefono ?? undefined, coperti: p.coperti, inizio: p.inizio_at, fine: p.fine_at,
      stato: p.stato, fonte: p.fonte, note: p.note ?? undefined, allergeni: p.allergeni ?? [], tag: p.tag ?? [],
      tavoloId: p.tavolo_id, tavoliExt: p.tavoli_ext ?? [],
    }));
    this.emit();
  }

  private mappaLavoro = (j: Riga): PrintJob => ({
    id: j.id, tipo: j.tipo, stampanteId: j.stampante_id, stato: j.stato, idempotencyKey: j.idempotency_key,
    documentoId: j.documento_id ?? undefined, ticket: j.payload?.ticket, xml: j.payload?.xml, errore: j.errore ?? undefined,
    tentativi: j.tentativi, createdAt: j.created_at,
  });

  private ascolta() {
    const filtro = `locale_id=eq.${this.localeId}`;
    const canale = this.sb.channel(`servizio-${this.localeId}`);
    for (const t of ['comande', 'righe_comanda', 'documenti', 'print_jobs', 'prenotazioni', 'messaggi_reparto']) {
      canale.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: filtro }, () => this.programmaRicarica());
    }
    // Listino, sale e stampanti cambiati dalla Gestione (anche da un altro dispositivo).
    for (const t of ['articoli', 'categorie', 'sale', 'tavoli', 'varianti', 'stampanti', 'centri_produzione', 'aliquote_iva']) {
      canale.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: filtro }, () => this.programmaSetup());
    }
    // Queste due non hanno locale_id: le regole di accesso filtrano già quelle del locale.
    for (const t of ['prezzi_listino', 'articolo_varianti']) {
      canale.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => this.programmaSetup());
    }
    canale.subscribe();
  }

  private ricaricaSetupTimer?: ReturnType<typeof setTimeout>;
  private programmaSetup() {
    clearTimeout(this.ricaricaSetupTimer);
    this.ricaricaSetupTimer = setTimeout(() => void this.ricaricaSetup(), 250);
  }

  private programmaRicarica() {
    clearTimeout(this.ricarica);
    this.ricarica = setTimeout(() => void this.caricaServizio(), 120);
  }

  private emit() { for (const l of this.listeners) l(); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  // ------------------------------------------------------------------ letture
  setup() { return this._setup; }
  comandeAperte() { return this._comande.filter((c) => c.stato === 'aperta' || c.stato === 'preconto'); }
  comanda(id: string) { return this._comande.find((c) => c.id === id); }
  comandaDelTavolo(tavoloId: string) { return this.comandeAperte().find((c) => c.tavoloId === tavoloId); }
  righe(comandaId: string) { return this._righe.filter((r) => r.comandaId === comandaId); }
  documenti(comandaId: string) { return this._documenti.filter((d) => d.comandaId === comandaId); }
  lavori() { return this._lavori; }
  righeDaPreparare(centroId: string) {
    const out: { comanda: Comanda; righe: RigaComanda[] }[] = [];
    for (const c of this.comandeAperte()) {
      const r = this.righe(c.id).filter((x) => x.centroProduzioneId === centroId && ['inviata', 'in_preparazione', 'pronta'].includes(x.stato));
      if (r.some((x) => x.stato !== 'pronta')) out.push({ comanda: c, righe: r });
    }
    return out.sort((a, b) => (a.righe[0].inviataAt ?? '').localeCompare(b.righe[0].inviataAt ?? ''));
  }

  // ------------------------------------------------------------------ scritture
  private comandaAperta(id: string) {
    const c = this.comanda(id);
    if (!c || c.stato === 'chiusa' || c.stato === 'annullata') throw new ErroreDominio('Questa comanda è già chiusa.');
    return c;
  }

  async login(pin: string): Promise<Operatore | null> {
    const { data, error } = await this.sb.rpc('operatore_accedi', { p_locale: this.localeId, p_pin: pin });
    if (error) errore(error);
    return (data as Operatore[])[0] ?? null;
  }

  prenotazioni() { return this._prenotazioni; }

  async impostaEsaurito(articoloId: string, esaurito: boolean) {
    const { error } = await this.sb.from('articoli').update({ esaurito, updated_at: new Date().toISOString() }).eq('id', articoloId);
    if (error) errore(error);
    await this.ricaricaSetup();
  }

  async spostaComanda(comandaId: string, tavoloId: string) {
    const { error } = await this.sb.rpc('sposta_comanda', { p_comanda: comandaId, p_tavolo: tavoloId });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async unisciComande(destinazioneId: string, origineId: string) {
    const { error } = await this.sb.rpc('unisci_comande', { p_destinazione: destinazioneId, p_origine: origineId });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async spostaRighe(rigaIds: string[], destinazioneId: string) {
    const { error } = await this.sb.rpc('sposta_righe', { p_righe: rigaIds, p_destinazione: destinazioneId });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async annullaDocumento(documentoId: string, key: string, operatore?: Operatore) {
    const { data, error } = await this.sb.from('documenti').select('*, righe_documento(*), pagamenti(*)').eq('id', documentoId).single();
    if (error) errore(error);
    const prep = preparaAnnullo(this._setup, this.mappaDocumento(data as Riga));
    const r = await this.sb.rpc('annulla_documento', { p_documento: documentoId, p_stampante: prep.stampanteId, p_key: key, p_operatore: operatore?.id ?? null, p_xml: prep.xml });
    if (r.error) errore(r.error);
    await this.caricaServizio();
  }

  async chiusuraFiscale(totali: object, key: string, operatore?: Operatore) {
    const prep = preparaChiusura(this._setup);
    const { error } = await this.sb.rpc('chiusura_giornaliera', { p_locale: this.localeId, p_stampante: prep.stampanteId, p_key: key, p_operatore: operatore?.id ?? null, p_xml: prep.xml, p_totali: totali });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async datiPeriodo(giorni: number) {
    const { data: oggi, error } = await this.sb.rpc('giorno_servizio', { p_locale: this.localeId });
    if (error) errore(error);
    const d = new Date(`${oggi}T12:00:00`); d.setDate(d.getDate() - (giorni - 1));
    const dal = d.toISOString().slice(0, 10);
    const comande = await this.tutte(() => this.sb.from('comande').select('*').gte('giorno_servizio', dal).order('aperta_at'));
    const ids = comande.map((c) => c.id);
    const righe: Riga[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      righe.push(...await this.tutte(() => this.sb.from('righe_comanda').select('*').in('comanda_id', ids.slice(i, i + 150)).order('created_at')));
    }
    const inizio = new Date(`${dal}T05:00:00`).toISOString();
    const documenti = await this.tutte(() => this.sb.from('documenti').select('*, righe_documento(*), pagamenti(*)').gte('created_at', inizio).order('created_at'));
    return { comande: comande.map(this.mappaComanda), righe: righe.map(this.mappaRiga), documenti: documenti.map(this.mappaDocumento) };
  }

  async segnaNonPresentato(id: string) {
    const { error } = await this.sb.from('prenotazioni').update({ stato: 'mancata', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) errore(error);
    await this.caricaServizio();
  }

  async sincronizzaPrenotazioni() {
    const { data, error } = await this.sb.functions.invoke('prenotazioni', { body: {} });
    if (error && !data) throw new ErroreDominio(`Collegamento con Table Flow: ${error.message}`);
    return data as { importate: number; inviate: number; errori: string[] };
  }

  async apriTavolo(tavoloId: string, coperti: number, operatore: Operatore, prenotazioneId?: string) {
    const { data, error } = await this.sb.rpc('apri_tavolo', { p_tavolo: tavoloId, p_coperti: coperti, p_operatore: operatore.id, p_prenotazione: prenotazioneId ?? null });
    if (error) errore(error);
    await this.caricaServizio();
    return this.comanda((data as Riga).id)!;
  }

  async aggiungiRiga(comandaId: string, r: NuovaRiga) {
    const c = this.comandaAperta(comandaId);
    const uguale = rigaUguale(this.righe(comandaId), r);
    if (uguale) { await this.cambiaQuantita(uguale.id, uguale.quantita + (r.quantita ?? 1)); return { ...uguale, quantita: uguale.quantita + (r.quantita ?? 1) }; }
    const riga = nuovaRiga(this._setup, comandaId, r, crypto.randomUUID(), new Date().toISOString());
    // Aggiornamento ottimista: la riga compare subito, il database conferma subito dopo.
    this._righe = [...this._righe, riga]; this.emit();
    const { error } = await this.sb.from('righe_comanda').insert({
      id: riga.id, locale_id: this.localeId, comanda_id: comandaId, articolo_id: riga.articoloId, descrizione: riga.descrizione,
      quantita: riga.quantita, prezzo_unitario_cents: riga.prezzoUnitarioCents, varianti: riga.varianti, note: riga.note ?? null,
      portata: riga.portata, centro_produzione_id: riga.centroProduzioneId, aliquota_iva_id: riga.aliquotaIvaId,
      allergeni: riga.allergeni, posto: riga.posto ?? null,
    });
    if (error) { this._righe = this._righe.filter((x) => x.id !== riga.id); this.emit(); errore(error); }
    if (c.stato === 'preconto') await this.sb.from('comande').update({ stato: 'aperta' }).eq('id', comandaId);
    return riga;
  }

  async cambiaQuantita(rigaId: string, quantita: number) {
    const r = this._righe.find((x) => x.id === rigaId);
    if (r && r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    if (quantita <= 0) return this.togliRiga(rigaId);
    this._righe = this._righe.map((x) => (x.id === rigaId ? { ...x, quantita } : x)); this.emit();
    const { error } = await this.sb.from('righe_comanda').update({ quantita, updated_at: new Date().toISOString() }).eq('id', rigaId).in('stato', ['da_inviare', 'in_attesa_marcia']);
    if (error) { await this.caricaServizio(); errore(error); }
  }

  async togliRiga(rigaId: string) {
    const r = this._righe.find((x) => x.id === rigaId);
    if (r && r.stato !== 'da_inviare' && r.stato !== 'in_attesa_marcia') throw new ErroreDominio('Riga già inviata: va stornata');
    this._righe = this._righe.filter((x) => x.id !== rigaId); this.emit();
    const { error } = await this.sb.from('righe_comanda').delete().eq('id', rigaId).in('stato', ['da_inviare', 'in_attesa_marcia']);
    if (error) { await this.caricaServizio(); errore(error); }
  }

  async impostaAllergeni(comandaId: string, a: { allergene: Allergene; posto?: number }[]) {
    const { error } = await this.sb.from('comande').update({ allergeni_tavolo: a }).eq('id', comandaId);
    if (error) errore(error);
    await this.caricaServizio();
  }

  async invia(comandaId: string, key: string, operatore?: Operatore, portata?: number) {
    const c = this.comandaAperta(comandaId);
    const prep = preparaInvio(this._setup, c, this.righe(comandaId), new Date().toISOString(), portata);
    const { data, error } = await this.sb.rpc('invia_produzione', {
      p_comanda: comandaId, p_righe: prep.righeIds, p_tipo: 'invio', p_portata: portata ?? null, p_operatore: operatore?.id ?? null, p_key: key,
      p_lavori: prep.lavori.map((l) => ({ stampante_id: l.stampanteId, payload: { ticket: l.ticket } })),
    });
    if (error) { await this.caricaServizio(); errore(error); }
    await this.caricaServizio();
    return ((data ?? []) as Riga[]).map(this.mappaLavoro);
  }

  async storna(rigaId: string, motivo: string, key: string, operatore?: Operatore) {
    const r = this._righe.find((x) => x.id === rigaId);
    if (!r) throw new ErroreDominio('Riga inesistente');
    const prep = preparaStorno(this._setup, this.comandaAperta(r.comandaId), r, motivo, new Date().toISOString());
    const { error } = await this.sb.rpc('storna_riga', {
      p_riga: rigaId, p_motivo: motivo, p_operatore: operatore?.id ?? null, p_key: key,
      p_stampante: prep?.stampanteId ?? null, p_payload: prep ? { ticket: prep.ticket } : null,
    });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async segnaPronte(rigaIds: string[]) {
    this._righe = this._righe.map((r) => (rigaIds.includes(r.id) && r.stato !== 'stornata' ? { ...r, stato: 'pronta' } : r)); this.emit();
    const { error } = await this.sb.from('righe_comanda').update({ stato: 'pronta' }).in('id', rigaIds).neq('stato', 'stornata');
    if (error) { await this.caricaServizio(); errore(error); }
  }

  async preconto(comandaId: string, key: string, persone?: number) {
    const c = this.comandaAperta(comandaId);
    const prep = preparaPreconto(this._setup, c, this.righe(comandaId), new Date().toISOString(), persone);
    const { error } = await this.sb.rpc('accoda_lavoro', { p_locale: this.localeId, p_stampante: prep.stampanteId, p_tipo: 'preconto', p_payload: { ticket: prep.ticket }, p_key: key });
    if (error) errore(error);
    await this.sb.from('comande').update({ stato: 'preconto' }).eq('id', comandaId);
    await this.caricaServizio();
  }

  async incassa(comandaId: string, inc: Incasso, key: string, operatore?: Operatore) {
    const c = this.comandaAperta(comandaId);
    const prep = preparaIncasso(this._setup, c, this.righe(comandaId), inc);
    const { data, error } = await this.sb.rpc('incassa', {
      p_comanda: comandaId, p_stampante: prep.stampanteId, p_key: key, p_operatore: operatore?.id ?? null,
      p_totale: prep.totaleCents, p_sconto: prep.scontoCents, p_quota_indice: inc.quota?.indice ?? null, p_quota_di: inc.quota?.di ?? null,
      p_righe: prep.righe, p_pagamenti: prep.pagamenti, p_xml: prep.xml,
    });
    if (error) errore(error);
    await this.caricaServizio();
    return this._documenti.find((d) => d.id === (data as Riga).id)!;
  }

  // ------------------------------------------------------------------ messaggi ai reparti
  messaggi() { return this._messaggi; }

  async inviaMessaggio(m: NuovoMessaggio, key: string, operatore?: Operatore) {
    const c = m.comandaId ? this.comandaAperta(m.comandaId) : undefined;
    const prep = preparaMessaggio(this._setup, { ...m, comanda: c, righe: c ? this.righe(c.id) : [], operatore: operatore?.nome ?? c?.operatore ?? '', quando: new Date().toISOString() });
    const { error } = await this.sb.rpc('invia_messaggio', {
      p_locale: this.localeId, p_comanda: c?.id ?? null, p_tipo: m.tipo, p_testo: m.testo ?? '', p_portata: m.portata ?? null,
      p_operatore: operatore?.id ?? null, p_key: key,
      p_reparti: prep.reparti.map((r) => ({ centro_id: r.centroId, stampante_id: r.stampanteId, payload: { ticket: r.ticket } })),
    });
    if (error) errore(error);
    await this.caricaServizio();
  }

  async segnaMessaggioVisto(id: string) {
    this._messaggi = this._messaggi.map((x) => (x.id === id ? { ...x, vistoAt: new Date().toISOString() } : x)); this.emit();
    const { error } = await this.sb.from('messaggi_reparto').update({ visto_at: new Date().toISOString() }).eq('id', id);
    if (error) errore(error);
  }

  // ------------------------------------------------------------------ clienti
  async cercaClienti(testo: string) {
    let q = this.sb.from('clienti').select('*').order('cognome', { nullsFirst: false }).order('nome').limit(50);
    const t = testo.trim().replace(/[%,()]/g, ' ');
    if (t) q = q.or(['nome', 'cognome', 'ragione_sociale', 'telefono', 'email', 'piva', 'codice_fiscale'].map((c) => `${c}.ilike.%${t}%`).join(','));
    const { data, error } = await q;
    if (error) errore(error);
    return ((data ?? []) as Riga[]).map(this.mappaCliente);
  }

  async cliente(id: string) {
    const { data, error } = await this.sb.from('clienti').select('*').eq('id', id).maybeSingle();
    if (error) errore(error);
    return data ? this.mappaCliente(data as Riga) : null;
  }

  async salvaCliente(c: ClienteNuovo) {
    if (!c.nome.trim() && !c.ragioneSociale?.trim()) throw new ErroreDominio('Manca il nome');
    const riga = {
      gruppo_id: this.gruppoId, nome: c.nome.trim() || (c.ragioneSociale ?? '').trim(), cognome: c.cognome?.trim() || null,
      telefono: c.telefono?.trim() || null, email: c.email?.trim() || null, compleanno: c.compleanno || null, preferenze: c.preferenze?.trim() || null,
      allergeni: c.allergeni, note_allergie: c.noteAllergie?.trim() || null, sconto_pct: c.scontoPct || 0,
      ragione_sociale: c.ragioneSociale?.trim() || null, piva: c.piva?.replace(/\s/g, '') || null, codice_fiscale: c.codiceFiscale?.replace(/\s/g, '').toUpperCase() || null,
      codice_sdi: c.codiceSdi?.trim().toUpperCase() || null, pec: c.pec?.trim() || null, indirizzo_fiscale: c.indirizzoFiscale ?? null,
      consenso_marketing: c.consensoMarketing, consenso_at: c.consensoMarketing ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    };
    const { data, error } = c.id
      ? await this.sb.from('clienti').update(riga).eq('id', c.id).select().single()
      : await this.sb.from('clienti').insert(riga).select().single();
    if (error) errore(error);
    return this.mappaCliente(data as Riga);
  }

  async impostaCliente(comandaId: string, clienteId: string | null) {
    this.comandaAperta(comandaId);
    const { error } = await this.sb.from('comande').update({ cliente_id: clienteId }).eq('id', comandaId);
    if (error) errore(error);
    await this.caricaServizio();
  }

  async storicoCliente(id: string): Promise<StoricoCliente> {
    const { data: comande, error } = await this.sb.from('comande').select('id, aperta_at').eq('cliente_id', id).eq('stato', 'chiusa').order('aperta_at', { ascending: false }).limit(200);
    if (error) errore(error);
    const ids = ((comande ?? []) as Riga[]).map((c) => c.id);
    const [doc, righe, fatt] = await Promise.all([
      ids.length ? this.sb.from('documenti').select('totale_cents').in('comanda_id', ids).eq('stato', 'emesso') : Promise.resolve({ data: [] }),
      ids.length ? this.sb.from('righe_comanda').select('descrizione, quantita').in('comanda_id', ids).neq('stato', 'stornata') : Promise.resolve({ data: [] }),
      this.sb.from('fatture').select('*').eq('cliente_id', id).order('created_at', { ascending: false }),
    ]);
    const piatti = new Map<string, number>();
    for (const r of (righe.data ?? []) as Riga[]) piatti.set(r.descrizione, (piatti.get(r.descrizione) ?? 0) + Number(r.quantita));
    return {
      visite: ids.length, spesaCents: ((doc.data ?? []) as Riga[]).reduce((t, d) => t + d.totale_cents, 0),
      ultimaVisita: (comande as Riga[] | null)?.[0]?.aperta_at,
      piatti: [...piatti].map(([descrizione, quantita]) => ({ descrizione, quantita })).sort((a, b) => b.quantita - a.quantita).slice(0, 8),
      fatture: ((fatt.data ?? []) as Riga[]).map(this.mappaFattura),
    };
  }

  // ------------------------------------------------------------------ fatture
  async salvaDatiFiscali(d: DatiFiscali) {
    const { ragioneSociale, piva, codiceFiscale, ...resto } = d;
    const { error } = await this.sb.from('locali').update({
      ragione_sociale: ragioneSociale.trim(), piva: piva.replace(/\s/g, ''), codice_fiscale: codiceFiscale?.trim().toUpperCase() || null,
      dati_fiscali: resto, updated_at: new Date().toISOString(),
    }).eq('id', this.localeId);
    if (error) errore(error);
    await this.ricaricaSetup();
  }

  async emettiFattura(f: NuovaFattura, key: string, operatore?: Operatore) {
    const { data, error } = await this.sb.rpc('emetti_fattura', {
      p_locale: this.localeId, p_cliente: f.clienteId, p_documento: f.documentoId ?? null, p_comanda: f.comandaId ?? null, p_data: f.data,
      p_imponibile: f.calcolo.imponibileCents, p_iva: f.calcolo.ivaCents, p_totale: f.calcolo.totaleCents,
      p_dati: { intestatario: f.intestatario, progressivo: f.progressivo, linee: f.calcolo.linee, riepilogo: f.calcolo.riepilogo },
      p_xml: f.xml, p_key: key, p_operatore: operatore?.id ?? null,
    });
    if (error) errore(error);
    return this.mappaFattura(data as Riga);
  }

  async fatture(giorni: number) {
    const da = new Date(Date.now() - giorni * 24 * 3600_000).toISOString();
    const { data, error } = await this.sb.from('fatture').select('*').gte('created_at', da).order('created_at', { ascending: false });
    if (error) errore(error);
    return ((data ?? []) as Riga[]).map(this.mappaFattura);
  }

  async impostaStatoFattura(id: string, stato: StatoFattura) {
    const { error } = await this.sb.from('fatture').update({ stato, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) errore(error);
  }

  async stampaNonFiscale(ticket: Ticket, key: string) {
    const st = this._setup.stampanti.find((x) => x.perPreconto) ?? this._setup.stampanti.find((x) => x.tipo === 'comande_escpos');
    if (!st) throw new ErroreDominio('Nessuna stampante per le stampe non fiscali');
    const { error } = await this.sb.rpc('accoda_lavoro', { p_locale: this.localeId, p_stampante: st.id, p_tipo: 'non_fiscale', p_payload: { ticket }, p_key: key });
    if (error) errore(error);
  }

  async prendiLavori(max = 10) {
    const { data, error } = await this.sb.rpc('prendi_lavori', { p_locale: this.localeId, p_max: max });
    if (error) errore(error);
    return ((data ?? []) as Riga[]).map(this.mappaLavoro);
  }

  async esitoLavoro(jobId: string, e: EsitoLavoro) {
    const { error } = await this.sb.rpc('esito_lavoro', {
      p_job: jobId, p_ok: e.ok, p_incerto: !!e.incerto, p_errore: e.errore ?? null,
      p_z_numero: e.zNumero ?? null, p_doc_numero: e.docNumero ?? null, p_matricola: e.matricola ?? null,
    });
    if (error) errore(error);
    this.programmaRicarica();
  }
}
