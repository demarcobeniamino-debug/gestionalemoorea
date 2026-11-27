// Preparazione delle operazioni di servizio: funzioni pure, usate sia dai dati in memoria (demo)
// sia dal database (Supabase). Così il ticket e lo scontrino sono identici in entrambi i casi.

import type { Comanda, Documento, Pagamento, RigaComanda, RigaDocumento, TipoMessaggio } from './types';
import { PAGAMENTO_RT } from './types';
import type { Setup } from './seed';
import type { Ticket } from './ticket';
import { calcolaConto, righeDocumento, totaleRighe } from './conto';
import { ticketComanda, ticketMessaggio, ticketPreconto } from './comande';
import { dividiAllaRomana } from './money';
import { xmlAnnulloReso, xmlChiusuraGiornaliera, xmlDocumentoCommerciale } from './epson';

export class ErroreDominio extends Error {}

export interface Incasso {
  pagamenti: Pagamento[];
  scontoCents?: number;
  /** Alla romana: quale quota si sta pagando. */
  quota?: { indice: number; di: number };
  /** Codice lotteria degli scontrini del cliente. */
  lotteria?: string;
}

const tavoloLabel = (s: Setup, c: Comanda) => {
  const t = c.tavoloId ? s.tavoli.find((x) => x.id === c.tavoloId) : undefined;
  if (!t) return { numero: `${c.canale === 'asporto' ? 'Asporto' : 'Banco'}${c.etichetta ? ' ' + c.etichetta : ''}`, sala: undefined };
  const uniti = (c.tavoliUniti ?? []).map((id) => s.tavoli.find((x) => x.id === id)?.numero).filter(Boolean);
  return { numero: [t.numero, ...uniti].join('+'), sala: s.sale.find((x) => x.id === t.salaId)?.nome };
};

export interface InvioPreparato {
  righeIds: string[];
  lavori: { stampanteId: string; centroId: string | null; ticket: Ticket }[];
}

export function preparaInvio(s: Setup, c: Comanda, righe: RigaComanda[], quando: string, portata?: number): InvioPreparato {
  const daInviare = righe.filter((r) => (r.stato === 'da_inviare' || r.stato === 'in_attesa_marcia') && (portata === undefined || r.portata === portata));
  if (!daInviare.length) throw new ErroreDominio('Niente da inviare');
  const restano = righe.filter((r) => r.stato === 'da_inviare' && !daInviare.includes(r));
  const perCentro = new Map<string | null, RigaComanda[]>();
  for (const r of daInviare) perCentro.set(r.centroProduzioneId, [...(perCentro.get(r.centroProduzioneId) ?? []), r]);
  const { numero, sala } = tavoloLabel(s, c);
  const lavori: InvioPreparato['lavori'] = [];
  for (const [centroId, rr] of perCentro) {
    const centro = s.centri.find((x) => x.id === centroId);
    if (!centro?.stampanteId) continue;
    const marcia = rr.every((r) => r.stato === 'in_attesa_marcia');
    lavori.push({
      stampanteId: centro.stampanteId, centroId,
      ticket: ticketComanda({ centro: centro.nome, comanda: c, tavolo: numero, sala, righe: rr, tipo: marcia ? 'marcia' : 'invio', quando, inAttesa: [...new Set(restano.map((r) => r.portata))] }),
    });
  }
  return { righeIds: daInviare.map((r) => r.id), lavori };
}

export function preparaStorno(s: Setup, c: Comanda, r: RigaComanda, motivo: string, quando: string) {
  if (!motivo.trim()) throw new ErroreDominio('Serve il motivo dello storno');
  const eraInviata = !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato);
  const centro = s.centri.find((x) => x.id === r.centroProduzioneId);
  if (!eraInviata || !centro?.stampanteId) return null;
  const { numero, sala } = tavoloLabel(s, c);
  return {
    stampanteId: centro.stampanteId,
    ticket: ticketComanda({ centro: centro.nome, comanda: c, tavolo: numero, sala, righe: [{ ...r, stato: 'stornata', motivoStorno: motivo }], tipo: 'storno', quando }),
  };
}

export function preparaPreconto(s: Setup, c: Comanda, righe: RigaComanda[], quando: string, persone?: number) {
  const st = s.stampanti.find((x) => x.perPreconto);
  if (!st) throw new ErroreDominio('Nessuna stampante preconto configurata');
  const conto = calcolaConto(righe, c.coperti, s.locale.copertoCents);
  const { numero } = tavoloLabel(s, c);
  return {
    stampanteId: st.id,
    ticket: ticketPreconto({
      intestazione: [s.locale.nome.toUpperCase(), s.locale.citta], tavolo: numero, coperti: c.coperti,
      operatore: c.operatore, quando, righe, copertoUnitarioCents: s.locale.copertoCents,
      scontoCents: 0, totaleCents: conto.totaleCents, quote: persone && persone > 1 ? dividiAllaRomana(conto.totaleCents, persone) : undefined,
    }),
  };
}

export interface IncassoPreparato {
  stampanteId: string;
  righe: RigaDocumento[];
  scontoCents: number;
  totaleCents: number;
  pagamenti: (Pagamento & { tipoRt: string })[];
  xml: string;
}

export function preparaIncasso(s: Setup, c: Comanda, righe: RigaComanda[], inc: Incasso): IncassoPreparato {
  const rt = s.stampanti.find((x) => x.tipo === 'rt_epson_xml');
  if (!rt) throw new ErroreDominio('Nessun registratore telematico configurato');
  if (righe.some((r) => r.stato === 'da_inviare')) throw new ErroreDominio('Ci sono righe non ancora inviate');
  let righeDoc = righeDocumento(righe, c.coperti, s.locale.copertoCents, s.aliquote, s.locale.aliquotaCopertoId);
  let sconto = inc.scontoCents ?? 0;
  if (inc.quota) {
    // Quota alla romana: una riga per reparto IVA, in proporzione; i centesimi in più sull'ultima quota.
    const totale = totaleRighe(righeDoc) - sconto;
    const importo = dividiAllaRomana(totale, inc.quota.di)[inc.quota.indice - 1];
    const perReparto = new Map<number, number>();
    for (const r of righeDoc) perReparto.set(r.repartoRt, (perReparto.get(r.repartoRt) ?? 0) + Math.round(r.prezzoUnitarioCents * r.quantita));
    const lordo = [...perReparto.values()].reduce((a, b) => a + b, 0);
    const reparti = [...perReparto.entries()];
    let assegnato = 0;
    righeDoc = reparti.map(([rep, v], i) => {
      const q = i === reparti.length - 1 ? importo - assegnato : Math.round((importo * v) / lordo);
      assegnato += q;
      return { descrizione: `Quota ${inc.quota!.indice}/${inc.quota!.di} conto`, quantita: 1, prezzoUnitarioCents: q, repartoRt: rep };
    });
    sconto = 0;
  }
  const totale = totaleRighe(righeDoc) - sconto;
  const xml = xmlDocumentoCommerciale({ righe: righeDoc, scontoCents: sconto, pagamenti: inc.pagamenti, lotteria: inc.lotteria || undefined }, { host: rt.host });
  return {
    stampanteId: rt.id, righe: righeDoc, scontoCents: sconto, totaleCents: totale, xml,
    pagamenti: inc.pagamenti.map((p) => ({ ...p, tipoRt: PAGAMENTO_RT[p.tipo] })),
  };
}

const rtDi = (s: Setup) => {
  const rt = s.stampanti.find((x) => x.tipo === 'rt_epson_xml');
  if (!rt) throw new ErroreDominio('Nessun registratore telematico configurato');
  return rt;
};

/** Annullo di uno scontrino emesso: stesso contenuto, con il riferimento (Z, numero, data, matricola) dell'originale. */
export function preparaAnnullo(s: Setup, d: Documento) {
  if (d.tipo !== 'documento_commerciale' || d.stato !== 'emesso') throw new ErroreDominio('Si possono annullare solo scontrini emessi');
  if (d.rtZNumero == null || d.rtDocNumero == null) throw new ErroreDominio('Mancano i dati del registratore (Z e numero) per annullare questo scontrino');
  const rt = rtDi(s);
  const quando = d.rtData ? new Date(d.rtData.split('/').reverse().join('-')) : new Date(d.createdAt);
  const xml = xmlAnnulloReso('VOID', { zNumero: d.rtZNumero, docNumero: d.rtDocNumero, data: quando, matricola: rt.matricolaRt ?? '' },
    { righe: d.righe, scontoCents: d.scontoCents, pagamenti: d.pagamenti }, { host: rt.host });
  return { stampanteId: rt.id, xml };
}

/** Chiusura fiscale giornaliera (Z) sull'RT. */
export function preparaChiusura(s: Setup) {
  const rt = rtDi(s);
  return { stampanteId: rt.id, xml: xmlChiusuraGiornaliera({ host: rt.host }) };
}

export interface MessaggioPreparato { reparti: { centroId: string; stampanteId: string | null; ticket: Ticket }[] }

/**
 * Messaggio ai reparti. Marcia e sollecito riguardano un tavolo e una portata: vanno solo ai reparti
 * che hanno piatti di quella portata (se nessuno, a tutti quelli scelti).
 */
export function preparaMessaggio(s: Setup, m: {
  centriIds: string[]; tipo: TipoMessaggio; testo?: string; portata?: number; comanda?: Comanda; righe?: RigaComanda[]; operatore: string; quando: string;
}): MessaggioPreparato {
  if (m.tipo === 'messaggio' && !m.testo?.trim()) throw new ErroreDominio('Scrivi il messaggio');
  if (m.tipo !== 'messaggio' && !m.comanda) throw new ErroreDominio('Marcia e sollecito vanno fatti da un tavolo');
  const tav = m.comanda ? tavoloLabel(s, m.comanda).numero : undefined;
  const righePortata = (m.righe ?? []).filter((r) => r.stato !== 'stornata' && r.stato !== 'da_inviare' && (m.portata === undefined || r.portata === m.portata));
  let centri = m.centriIds;
  if (m.tipo !== 'messaggio') {
    const coinvolti = [...new Set(righePortata.map((r) => r.centroProduzioneId).filter((x): x is string => !!x))];
    if (coinvolti.length) centri = coinvolti;
  }
  if (!centri.length) throw new ErroreDominio('Scegli almeno un reparto');
  return {
    reparti: centri.map((id) => {
      const c = s.centri.find((x) => x.id === id);
      if (!c) throw new ErroreDominio('Reparto inesistente');
      return {
        centroId: id, stampanteId: c.stampanteId,
        ticket: ticketMessaggio({ centro: c.nome, tipo: m.tipo, tavolo: tav, comanda: m.comanda, portata: m.portata, testo: m.testo, operatore: m.operatore, quando: m.quando,
          righe: righePortata.filter((r) => r.centroProduzioneId === id) }),
      };
    }),
  };
}

/** Annulla conto: niente scontrini emessi; ai reparti va lo storno dei piatti già inviati (uno per reparto). */
export function preparaAnnullaConto(s: Setup, c: Comanda, righe: RigaComanda[], documenti: Documento[], motivo: string, quando: string, avvisaReparti = true) {
  if (!motivo.trim()) throw new ErroreDominio('Serve il motivo');
  if (c.stato === 'chiusa') throw new ErroreDominio('Il conto è già chiuso');
  if (documenti.some((d) => d.tipo === 'documento_commerciale' && ['emesso', 'in_emissione', 'da_verificare'].includes(d.stato)))
    throw new ErroreDominio('Su questo conto c’è già uno scontrino: annullalo prima dalla Cassa, poi annulla il conto');
  const inviate = righe.filter((r) => !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato));
  const perCentro = new Map<string, RigaComanda[]>();
  for (const r of inviate) if (r.centroProduzioneId) perCentro.set(r.centroProduzioneId, [...(perCentro.get(r.centroProduzioneId) ?? []), r]);
  const { numero, sala } = tavoloLabel(s, c);
  const lavori: { stampanteId: string; ticket: Ticket }[] = [];
  if (avvisaReparti) {
    for (const [centroId, rr] of perCentro) {
      const centro = s.centri.find((x) => x.id === centroId);
      if (!centro?.stampanteId) continue;
      lavori.push({ stampanteId: centro.stampanteId, ticket: ticketComanda({
        centro: centro.nome, comanda: c, tavolo: numero, sala, tipo: 'storno', quando,
        righe: rr.map((r) => ({ ...r, stato: 'stornata' as const, motivoStorno: `CONTO ANNULLATO: ${motivo}` })),
      }) });
    }
  }
  return { lavori, inviate: inviate.length };
}

/** Proforma: il conto si chiude senza scontrino e senza incasso (famiglia, amici, staff). I piatti restano
 *  come consumati (scarico di magazzino), il valore resta registrato. Si può stampare un foglio non fiscale. */
export function preparaProforma(s: Setup, c: Comanda, righe: RigaComanda[], documenti: Documento[], motivo: string, quando: string, nome?: string, stampa = false) {
  if (!motivo.trim()) throw new ErroreDominio('Serve il motivo');
  if (c.stato === 'chiusa' || c.stato === 'annullata') throw new ErroreDominio('Il conto è già chiuso');
  if (documenti.some((d) => d.tipo === 'documento_commerciale' && ['emesso', 'in_emissione', 'da_verificare'].includes(d.stato)))
    throw new ErroreDominio('Su questo conto c’è già uno scontrino: non si può chiudere come proforma');
  const attive = righe.filter((r) => r.stato !== 'stornata');
  if (!attive.length) throw new ErroreDominio('Il conto è vuoto: usa “Elimina conto”');
  const conto = calcolaConto(righe, c.coperti, s.locale.copertoCents);
  const st = stampa ? s.stampanti.find((x) => x.perPreconto) : undefined;
  if (stampa && !st) throw new ErroreDominio('Nessuna stampante preconto configurata');
  const { numero } = tavoloLabel(s, c);
  const n = nome?.trim() || undefined;
  return {
    totaleCents: conto.totaleCents,
    lavoro: st ? { stampanteId: st.id, ticket: ticketPreconto({
      intestazione: [s.locale.nome.toUpperCase(), s.locale.citta], tavolo: numero, coperti: c.coperti,
      operatore: c.operatore, quando, righe, copertoUnitarioCents: s.locale.copertoCents,
      scontoCents: 0, totaleCents: conto.totaleCents, proforma: { motivo, nome: n },
    }) } : undefined,
    proforma: { motivo: motivo.trim(), nome: n, totaleCents: conto.totaleCents },
  };
}

/** Reso parziale: alcune righe di uno scontrino emesso (quantità a scelta), restituite in contanti o sulla carta.
 *  Se lo scontrino aveva uno sconto, il reso lo applica in proporzione. */
export function preparaReso(s: Setup, d: Documento, scelte: { indice: number; quantita: number }[], rimborso: 'contanti' | 'carta', giaResi = 0) {
  if (d.tipo !== 'documento_commerciale' || d.stato !== 'emesso') throw new ErroreDominio('Si fa il reso solo di scontrini emessi');
  if (d.rtZNumero == null || d.rtDocNumero == null) throw new ErroreDominio('Mancano i dati del registratore (Z e numero) per il reso');
  const righe = scelte.filter((x) => x.quantita > 0).map((x) => {
    const r = d.righe[x.indice];
    if (!r) throw new ErroreDominio('Riga inesistente');
    if (x.quantita > r.quantita) throw new ErroreDominio(`${r.descrizione}: al massimo ${r.quantita}`);
    return { ...r, quantita: x.quantita };
  });
  if (!righe.length) throw new ErroreDominio('Scegli cosa rendere');
  const lordoOrig = d.righe.reduce((t, r) => t + Math.round(r.prezzoUnitarioCents * r.quantita), 0);
  const lordo = righe.reduce((t, r) => t + Math.round(r.prezzoUnitarioCents * r.quantita), 0);
  const sconto = d.scontoCents && lordoOrig ? Math.round((d.scontoCents * lordo) / lordoOrig) : 0;
  const totale = lordo - sconto;
  if (giaResi + totale > d.totaleCents) throw new ErroreDominio(`Si può rendere al massimo ${(d.totaleCents - giaResi) / 100} €`.replace('.', ','));
  const rt = rtDi(s);
  const quando = d.rtData ? new Date(d.rtData.split('/').reverse().join('-')) : new Date(d.createdAt);
  const xml = xmlAnnulloReso('REFUND', { zNumero: d.rtZNumero, docNumero: d.rtDocNumero, data: quando, matricola: rt.matricolaRt ?? '' },
    { righe, scontoCents: sconto, pagamenti: [{ tipo: rimborso, importoCents: totale }] }, { host: rt.host });
  return { stampanteId: rt.id, xml, righe, scontoCents: sconto, totaleCents: totale };
}

/** Ristampa della comanda per un reparto (o per tutti): i piatti già mandati e non stornati, con la scritta RISTAMPA. */
export function preparaRistampa(s: Setup, c: Comanda, righe: RigaComanda[], quando: string, centroId?: string) {
  const inviate = righe.filter((r) => !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato) && r.centroProduzioneId && (!centroId || r.centroProduzioneId === centroId));
  const { numero, sala } = tavoloLabel(s, c);
  const perCentro = new Map<string, RigaComanda[]>();
  for (const r of inviate) perCentro.set(r.centroProduzioneId!, [...(perCentro.get(r.centroProduzioneId!) ?? []), r]);
  const lavori: { stampanteId: string; ticket: Ticket }[] = [];
  for (const [id, rr] of perCentro) {
    const centro = s.centri.find((x) => x.id === id);
    if (!centro?.stampanteId) continue;
    lavori.push({ stampanteId: centro.stampanteId, ticket: ticketComanda({ centro: centro.nome, comanda: c, tavolo: numero, sala, righe: rr, tipo: 'ristampa', quando }) });
  }
  if (!lavori.length) throw new ErroreDominio('Niente da ristampare: nessun piatto è ancora stato mandato a questo reparto');
  return lavori;
}
