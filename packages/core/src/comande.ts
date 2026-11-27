// Costruzione dei ticket: comanda per centro di produzione e preconto.
import type { Ticket, RigaTicket } from './ticket';
import type { RigaComanda, Comanda, Allergene, Cents } from './types';
import { ALLERGENI_ETICHETTA } from './types';
import { nomePortata, importoRiga } from './conto';
import { euro } from './money';

/** Intestazione della portata sul ticket: parole semplici, senza simboli che le stampanti non hanno. */
const titoloPortata = (p: number) => (p === 0 ? 'BEVANDE' : p === 9 ? 'DESSERT' : `PORTATA ${p}`);

const ora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export interface DatiTicketComanda {
  centro: string;                    // "CUCINA", "BAR"
  comanda: Comanda;
  tavolo: string;                    // "7" oppure "ASPORTO 23"
  sala?: string;
  righe: RigaComanda[];              // solo le righe di questo invio e di questo centro
  tipo: 'invio' | 'marcia' | 'storno' | 'ristampa';
  quando: string;                    // ISO
  inAttesa?: number[];               // portate ancora in attesa di marcia
}

export function ticketComanda(d: DatiTicketComanda): Ticket {
  const r: RigaTicket[] = [];
  const intestazione = { invio: '', marcia: '*** MARCIA ***', storno: '*** STORNO ***', ristampa: '*** RISTAMPA ***' }[d.tipo];
  r.push({ k: 'coppia', sx: d.centro.toUpperCase(), dx: `#${String(d.comanda.numero).padStart(4, '0')}`, grassetto: true });
  if (intestazione) r.push({ k: 'testo', testo: intestazione, inverso: true, grassetto: true, allinea: 'centro', doppiaAltezza: true });
  r.push({ k: 'testo', testo: /^\d/.test(d.tavolo) ? `TAVOLO ${d.tavolo}` : d.tavolo.toUpperCase(), grande: true, grassetto: true });
  r.push({ k: 'coppia', sx: `${d.comanda.coperti} coperti${d.sala ? ' · ' + d.sala : ''}`, dx: ora(d.quando) });
  r.push({ k: 'testo', testo: `Cameriere: ${d.comanda.operatore}` });

  // Allergeni: del tavolo e delle righe, sempre in cima e in negativo.
  const allergeni = new Map<string, string>();
  for (const a of d.comanda.allergeniTavolo) allergeni.set(a.allergene + (a.posto ?? ''), `${ALLERGENI_ETICHETTA[a.allergene]}${a.posto ? ' · posto ' + a.posto : ''}`);
  if (allergeni.size) {
    r.push({ k: 'separatore' });
    for (const t of allergeni.values()) r.push({ k: 'testo', testo: `!! ALLERGIA ${t.toUpperCase()} !!`, inverso: true, grassetto: true, allinea: 'centro' });
  }
  r.push({ k: 'separatore' });

  // Leggibilità in servizio: piatti in carattere doppio (largo e alto) e grassetto, una riga vuota fra un piatto
  // e l'altro, varianti e note in grassetto rientrate, portata come fascia nera.
  const portate = [...new Set(d.righe.map((x) => x.portata))].sort((a, b) => a - b);
  for (const p of portate) {
    r.push({ k: 'vuota' });
    r.push({ k: 'testo', testo: ` ${titoloPortata(p)} `, inverso: true, grassetto: true, doppiaAltezza: true, allinea: 'centro' });
    for (const riga of d.righe.filter((x) => x.portata === p)) {
      r.push({ k: 'vuota' });
      const q = Number.isInteger(riga.quantita) ? String(riga.quantita) : riga.quantita.toFixed(3).replace('.', ',');
      r.push({ k: 'testo', testo: `${q} x ${riga.descrizione}`, grande: true, grassetto: true });
      for (const v of riga.varianti.filter((x) => !x.promo)) r.push({ k: 'testo', testo: `> ${v.nome.replace(/^[-+]\s*/, (m) => m.trim() === '+' ? '+ ' : '')}`, rientro: 2, grassetto: true, doppiaAltezza: true });
      if (riga.posto) r.push({ k: 'testo', testo: `> posto ${riga.posto}`, rientro: 2, grassetto: true, doppiaAltezza: true });
      if (riga.note) r.push({ k: 'testo', testo: `> ${riga.note.toUpperCase()}`, rientro: 2, grassetto: true, doppiaAltezza: true });
      // Solo se il piatto contiene un allergene dichiarato al tavolo: allora in negativo, impossibile da non vedere.
      const critici = riga.allergeni.filter((a) => d.comanda.allergeniTavolo.some((x) => x.allergene === a));
      if (critici.length) r.push({ k: 'testo', testo: `!! CONTIENE ${critici.map((a) => ALLERGENI_ETICHETTA[a as Allergene].toUpperCase()).join(', ')} !!`, inverso: true, grassetto: true, rientro: 2 });
      if (d.tipo === 'storno' && riga.motivoStorno) r.push({ k: 'testo', testo: `motivo: ${riga.motivoStorno}`, rientro: 2, grassetto: true });
    }
  }
  r.push({ k: 'vuota' });
  if (d.inAttesa?.length) {
    r.push({ k: 'separatore' });
    r.push({ k: 'testo', testo: `In attesa di marcia: ${d.inAttesa.map(nomePortata).join(', ')}` });
  }
  return { titolo: `${d.centro} · ${d.tavolo}`, righe: r, taglio: true };
}

export interface DatiPreconto {
  intestazione: string[];            // nome locale, città
  tavolo: string; coperti: number; operatore: string; quando: string;
  righe: RigaComanda[]; copertoUnitarioCents: Cents; scontoCents: Cents; totaleCents: Cents;
  quote?: Cents[];
  /** Proforma: titolo e motivo al posto di "PRECONTO". */
  proforma?: { motivo: string; nome?: string };
}

export function ticketPreconto(d: DatiPreconto): Ticket {
  const r: RigaTicket[] = [];
  for (const l of d.intestazione) r.push({ k: 'testo', testo: l, allinea: 'centro', grassetto: true });
  r.push({ k: 'separatore' });
  r.push({ k: 'coppia', sx: `${d.proforma ? 'PROFORMA' : 'PRECONTO'}  ${/^\d/.test(d.tavolo) ? 'Tavolo ' : ''}${d.tavolo}`, dx: ora(d.quando), grassetto: true });
  if (d.proforma) r.push({ k: 'testo', testo: [d.proforma.motivo, d.proforma.nome].filter(Boolean).join(' · ') });
  r.push({ k: 'coppia', sx: `${d.coperti} coperti`, dx: `Op. ${d.operatore}` });
  r.push({ k: 'separatore' });
  // Raggruppa righe uguali (stesso articolo, varianti, prezzo).
  const gruppi = new Map<string, { descr: string; q: number; imp: number }>();
  for (const x of d.righe.filter((x) => x.stato !== 'stornata' && !x.parentId)) {
    const chiave = x.descrizione + JSON.stringify(x.varianti) + x.prezzoUnitarioCents + x.omaggio;
    const g = gruppi.get(chiave) ?? { descr: x.descrizione + (x.omaggio ? ' (omaggio)' : ''), q: 0, imp: 0 };
    g.q += x.quantita; g.imp += importoRiga(x);
    gruppi.set(chiave, g);
  }
  for (const g of gruppi.values()) r.push({ k: 'coppia', sx: `${g.q} ${g.descr}`, dx: euro(g.imp, false) });
  if (d.coperti && d.copertoUnitarioCents) r.push({ k: 'coppia', sx: `${d.coperti} Coperto`, dx: euro(d.coperti * d.copertoUnitarioCents, false) });
  if (d.scontoCents) r.push({ k: 'coppia', sx: 'Sconto', dx: '-' + euro(d.scontoCents, false) });
  r.push({ k: 'separatore' });
  r.push({ k: 'coppia', sx: 'TOTALE EUR', dx: euro(d.totaleCents, false), grassetto: true, doppiaAltezza: true });
  if (d.quote && d.quote.length > 1) r.push({ k: 'coppia', sx: `Alla romana (${d.quote.length})`, dx: euro(d.quote[0], false) });
  r.push({ k: 'separatore' });
  if (d.proforma) r.push({ k: 'testo', testo: 'NON INCASSATO', allinea: 'centro', grassetto: true });
  r.push({ k: 'testo', testo: 'NON VALIDO COME DOCUMENTO FISCALE', allinea: 'centro', grassetto: true });
  return { titolo: `${d.proforma ? 'Proforma' : 'Preconto'} · ${d.tavolo}`, righe: r, taglio: true };
}

export interface DatiTicketMessaggio {
  centro: string;
  tipo: 'messaggio' | 'marcia' | 'sollecito';
  tavolo?: string;
  comanda?: Comanda;
  portata?: number;
  testo?: string;
  operatore: string;
  quando: string;
  /** Per marcia e sollecito: i piatti di quella portata per questo reparto. */
  righe?: RigaComanda[];
}

/** Ticket breve per il reparto: MARCIA / SOLLECITO / MESSAGGIO, grande e in negativo. */
export function ticketMessaggio(d: DatiTicketMessaggio): Ticket {
  const r: RigaTicket[] = [];
  const titolo = { messaggio: 'MESSAGGIO', marcia: 'MARCIA', sollecito: 'SOLLECITO' }[d.tipo];
  r.push({ k: 'coppia', sx: d.centro.toUpperCase(), dx: ora(d.quando), grassetto: true });
  r.push({ k: 'testo', testo: `*** ${titolo} ***`, inverso: true, grassetto: true, allinea: 'centro', doppiaAltezza: true });
  if (d.tavolo) r.push({ k: 'testo', testo: /^\d/.test(d.tavolo) ? `TAVOLO ${d.tavolo}` : d.tavolo.toUpperCase(), grande: true, grassetto: true });
  if (d.portata !== undefined) r.push({ k: 'testo', testo: titoloPortata(d.portata), doppiaAltezza: true, grassetto: true });
  if (d.testo?.trim()) { r.push({ k: 'separatore' }); r.push({ k: 'testo', testo: d.testo.trim(), doppiaAltezza: true, grassetto: true }); }
  const rr = (d.righe ?? []).filter((x) => x.stato !== 'stornata');
  if (rr.length) {
    r.push({ k: 'separatore' });
    for (const x of rr) {
      r.push({ k: 'testo', testo: `${x.quantita} x ${x.descrizione}`, grande: true, grassetto: true });
      for (const v of x.varianti.filter((y) => !y.promo)) r.push({ k: 'testo', testo: `- ${v.nome}`, rientro: 4 });
    }
  }
  r.push({ k: 'separatore' });
  r.push({ k: 'testo', testo: `da ${d.operatore}` });
  return { titolo: `${titolo} · ${d.tavolo ?? d.centro}`, righe: r, taglio: true };
}
