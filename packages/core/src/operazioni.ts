// Preparazione delle operazioni di servizio: funzioni pure, usate sia dai dati in memoria (demo)
// sia dal database (Supabase). Così il ticket e lo scontrino sono identici in entrambi i casi.

import type { Comanda, Documento, Pagamento, RigaComanda, RigaDocumento } from './types';
import { PAGAMENTO_RT } from './types';
import type { Setup } from './seed';
import type { Ticket } from './ticket';
import { calcolaConto, righeDocumento, totaleRighe } from './conto';
import { ticketComanda, ticketPreconto } from './comande';
import { dividiAllaRomana } from './money';
import { xmlAnnulloReso, xmlChiusuraGiornaliera, xmlDocumentoCommerciale } from './epson';

export class ErroreDominio extends Error {}

export interface Incasso {
  pagamenti: Pagamento[];
  scontoCents?: number;
  /** Alla romana: quale quota si sta pagando. */
  quota?: { indice: number; di: number };
}

const tavoloLabel = (s: Setup, c: Comanda) => {
  const t = s.tavoli.find((x) => x.id === c.tavoloId);
  return { numero: t?.numero ?? '?', sala: s.sale.find((x) => x.id === t?.salaId)?.nome };
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
  const xml = xmlDocumentoCommerciale({ righe: righeDoc, scontoCents: sconto, pagamenti: inc.pagamenti }, { host: rt.host });
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
