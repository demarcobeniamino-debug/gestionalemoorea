// Archivio della Gestione sul database vero: legge tutte le tabelle del locale,
// scrive con le regole di accesso (RLS) e registra i movimenti con la funzione del server.
import {
  CHIAVI, ErroreGestione, type Archivio, type MovimentoRiga, type NomeTabella, type NuovoMovimento, type RigaDi, type Tabelle,
} from '@gr/core';
import { supabase } from './supabase';

type Riga = Record<string, any>;

// I campi numeric arrivano come testo: li riportiamo a numero.
const NUMERICI = ['x', 'y', 'larghezza', 'altezza', 'fattore', 'giacenza', 'scorta_min', 'scorta_max', 'quantita', 'resa_pct', 'percentuale'];
const numeri = (r: Riga) => {
  const o = { ...r };
  for (const k of NUMERICI) if (o[k] != null) o[k] = Number(o[k]);
  return o;
};

function errore(e: { message?: string; code?: string } | null): never {
  const m = e?.message ?? '';
  if (e?.code === '23505' && /tavoli/.test(m)) throw new ErroreGestione('Esiste già un tavolo con questo numero.');
  if (e?.code === '23505') throw new ErroreGestione('Esiste già un elemento con questi dati.');
  if (e?.code === '23503' && /categorie|categoria/.test(m)) throw new ErroreGestione('La categoria contiene ancora articoli: spostali o archiviali prima.');
  if (e?.code === '23503') throw new ErroreGestione('È ancora usato altrove (vendite, ricette o movimenti): archivialo invece di eliminarlo.');
  if (/QUANTITA_NON_VALIDA/.test(m)) throw new ErroreGestione('Quantità non valida.');
  if (/MOVIMENTO_VUOTO/.test(m)) throw new ErroreGestione('Aggiungi almeno un prodotto.');
  if (/NON_AUTORIZZATO|row-level security/.test(m)) throw new ErroreGestione('Questo account non può modificare il locale.');
  throw new ErroreGestione(`Errore del server: ${m || 'sconosciuto'}`);
}

export class SupabaseArchivio implements Archivio {
  private sb = supabase();
  private t!: Tabelle;
  private listeners = new Set<() => void>();

  constructor(private onCambio?: () => void) {}

  tabelle() { return this.t; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }

  async ricarica() {
    const q = async (t: string, cols = '*', ordina?: (x: any) => any) => {
      let query = this.sb.from(t).select(cols);
      if (ordina) query = ordina(query);
      const { data, error } = await query;
      if (error) errore(error);
      return ((data ?? []) as Riga[]).map(numeri);
    };
    const [locale] = await q('locali', 'id,nome,indirizzo,coperto_cents,gruppo_id');
    if (!locale) throw new ErroreGestione('Nessun locale collegato a questo account.');
    const [listini, aliquote_iva, stampanti, centri_produzione, categorie, articoli, prezzi_listino, varianti, articolo_varianti,
      sale, tavoli, fornitori, mag_articoli, scorte, distinte, movimenti] = await Promise.all([
      q('listini'), q('aliquote_iva'), q('stampanti'), q('centri_produzione'), q('categorie'), q('articoli'), q('prezzi_listino'),
      q('varianti'), q('articolo_varianti'), q('sale'), q('tavoli'), q('fornitori'), q('mag_articoli'), q('scorte'), q('distinte'),
      q('movimenti_magazzino', '*, righe_movimento(mag_articolo_id, quantita, costo_unitario_cents)', (x) => x.order('created_at', { ascending: false }).limit(300)),
    ]);
    this.t = {
      locale: { id: locale.id, nome: locale.nome, indirizzo: locale.indirizzo, coperto_cents: locale.coperto_cents },
      gruppoId: locale.gruppo_id,
      listini, aliquote_iva, stampanti, centri_produzione, categorie, articoli, prezzi_listino, varianti, articolo_varianti,
      sale, tavoli, fornitori, mag_articoli, scorte, distinte,
      movimenti: movimenti.map(({ righe_movimento, ...m }) => ({ ...m, righe: (righe_movimento ?? []).map(numeri) }) as MovimentoRiga),
    } as Tabelle;
    this.emit();
  }

  private esiste<T extends NomeTabella>(tabella: T, riga: Partial<RigaDi<T>>) {
    return (this.t[tabella] as Riga[]).some((x) => CHIAVI[tabella].every((k) => x[k] === (riga as Riga)[k]));
  }

  async salva<T extends NomeTabella>(tabella: T, riga: Partial<RigaDi<T>>): Promise<RigaDi<T>> {
    const r: Riga = { ...riga };
    const chiavi = CHIAVI[tabella] as readonly string[];
    if (['categorie', 'articoli', 'varianti', 'sale', 'tavoli'].includes(tabella) && !r.locale_id) r.locale_id = this.t.locale.id;
    if (['fornitori', 'mag_articoli'].includes(tabella) && !r.gruppo_id) r.gruppo_id = this.t.gruppoId;
    if (tabella === 'scorte' && !r.locale_id) r.locale_id = this.t.locale.id;

    const completa = chiavi.every((k) => r[k] != null);
    let res;
    if (completa && this.esiste(tabella, r as Partial<RigaDi<T>>)) {
      // Aggiornamento parziale: solo i campi passati.
      let q = this.sb.from(tabella).update(r);
      for (const k of chiavi) q = q.eq(k, r[k]);
      res = await q.select().single();
    } else {
      res = await this.sb.from(tabella).insert(r).select().single();
    }
    if (res.error) errore(res.error);
    await this.ricarica();
    this.onCambio?.();
    return numeri(res.data) as RigaDi<T>;
  }

  async elimina<T extends NomeTabella>(tabella: T, chiave: Partial<RigaDi<T>>) {
    let q = this.sb.from(tabella).delete();
    for (const k of CHIAVI[tabella]) q = q.eq(k, (chiave as Riga)[k]);
    const { error } = await q;
    if (error) errore(error);
    await this.ricarica();
    this.onCambio?.();
  }

  async registraMovimento(m: NuovoMovimento) {
    const { error } = await this.sb.rpc('registra_movimento', {
      p_locale: this.t.locale.id, p_tipo: m.tipo, p_data: m.data ?? null, p_fornitore: m.fornitoreId ?? null,
      p_rif: m.rif ?? null, p_operatore: m.operatoreId ?? null,
      p_righe: m.righe.map((r) => ({ mag_articolo_id: r.magArticoloId, quantita: r.quantita, costo_unitario_cents: r.costoCents ?? null })),
    });
    if (error) errore(error);
    await this.ricarica();
  }
}
