// Epson RT (FP-81 II RT / FP-90 III RT): Fiscal ePOS-Print XML via fpmate.cgi.
// Sintassi dalla "ePOS Fiscal Print Solution Development Guide" (Epson, pubblica).
// Punti da confermare al collaudo sul registratore del Moorea sono marcati COLLAUDO.

import type { Cents, Pagamento, RigaDocumento } from './types';
import { PAGAMENTO_RT } from './types';

export interface OpzioniEpson {
  host: string;
  /** COLLAUDO: separatore decimale accettato dal firmware ("," o "."). */
  decimale?: ',' | '.';
  operatore?: string;
  timeoutMs?: number;
}

export const urlFpMate = (o: OpzioniEpson) =>
  `http://${o.host}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=${o.timeoutMs ?? 10000}`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** La descrizione sul documento commerciale è al massimo 38 caratteri. */
export const descrizioneRt = (s: string) => {
  const pulita = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  return pulita.length <= 38 ? pulita : pulita.slice(0, 37) + '.';
};

const imp = (c: Cents, dec: string) => (c / 100).toFixed(2).replace('.', dec);
const qta = (q: number, dec: string) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace('.', dec));

const busta = (corpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">\n<s:Body>\n${corpo}\n</s:Body>\n</s:Envelope>`;

/** paymentType / index secondo la tabella del manuale. COLLAUDO: index carta (1–10) secondo la programmazione dell'RT. */
export function mezzoPagamento(p: Pagamento): { paymentType: number; index: number; descrizione: string } {
  switch (PAGAMENTO_RT[p.tipo]) {
    case 'contanti': return { paymentType: 0, index: 0, descrizione: 'CONTANTI' };
    case 'elettronico': return { paymentType: 2, index: 1, descrizione: 'PAGAMENTO ELETTRONICO' };
    case 'ticket': return { paymentType: 3, index: 1, descrizione: 'BUONO PASTO' };
    case 'non_riscosso': return { paymentType: 5, index: p.tipo === 'camera' ? 2 : 0, descrizione: 'NON RISCOSSO' };
  }
}

export interface DocumentoRt {
  righe: RigaDocumento[];
  scontoCents?: Cents;          // sconto sul subtotale
  pagamenti: Pagamento[];
  lotteria?: string;            // codice lotteria degli scontrini (non usato in fase 1)
}

export function xmlDocumentoCommerciale(d: DocumentoRt, o: OpzioniEpson): string {
  const dec = o.decimale ?? ',';
  const op = esc(o.operatore ?? '1');
  if (!d.righe.length) throw new Error('Il documento deve avere almeno una riga');
  const totale = d.righe.reduce((s, r) => s + Math.round(r.prezzoUnitarioCents * r.quantita), 0) - (d.scontoCents ?? 0);
  const pagato = d.pagamenti.reduce((s, p) => s + p.importoCents, 0);
  if (totale < 0) throw new Error('Totale negativo');
  if (pagato < totale) throw new Error(`Pagamento incompleto: ${pagato} su ${totale}`);
  const contanti = d.pagamenti.filter((p) => p.tipo === 'contanti').reduce((s, p) => s + p.importoCents, 0);
  if (pagato > totale && contanti < pagato - totale) throw new Error('Il resto si può dare solo sui contanti');

  const l: string[] = ['<printerFiscalReceipt>', `<beginFiscalReceipt operator="${op}" />`];
  for (const r of d.righe) {
    l.push(`<printRecItem operator="${op}" description="${esc(descrizioneRt(r.descrizione))}" quantity="${qta(r.quantita, dec)}" unitPrice="${imp(r.prezzoUnitarioCents, dec)}" department="${r.repartoRt}" justification="1" />`);
  }
  if (d.scontoCents && d.scontoCents > 0) {
    l.push(`<printRecSubtotalAdjustment operator="${op}" adjustmentType="1" description="SCONTO" amount="${imp(d.scontoCents, dec)}" justification="1" />`);
  }
  // I pagamenti non in contanti per primi, i contanti per ultimi (così l'RT calcola il resto).
  const ordinati = [...d.pagamenti].sort((a, b) => (a.tipo === 'contanti' ? 1 : 0) - (b.tipo === 'contanti' ? 1 : 0));
  for (const p of ordinati) {
    const m = mezzoPagamento(p);
    l.push(`<printRecTotal operator="${op}" description="${m.descrizione}" payment="${imp(p.importoCents, dec)}" paymentType="${m.paymentType}" index="${m.index}" justification="1" />`);
  }
  l.push(`<endFiscalReceipt operator="${op}" />`, '</printerFiscalReceipt>');
  return busta(l.join('\n'));
}

/** Annullo (VOID) o reso (REFUND) di un documento: primo elemento un printRecMessage di tipo 4. */
export function xmlAnnulloReso(
  tipo: 'VOID' | 'REFUND',
  originale: { zNumero: number; docNumero: number; data: Date; matricola: string },
  d: DocumentoRt, o: OpzioniEpson,
): string {
  const dd = String(originale.data.getDate()).padStart(2, '0');
  const mm = String(originale.data.getMonth() + 1).padStart(2, '0');
  const msg = `${tipo} ${String(originale.zNumero).padStart(4, '0')} ${String(originale.docNumero).padStart(4, '0')} ${dd}${mm}${originale.data.getFullYear()} ${originale.matricola}`;
  const base = xmlDocumentoCommerciale(d, o);
  const op = esc(o.operatore ?? '1');
  return base.replace('<printerFiscalReceipt>', `<printerFiscalReceipt>\n<printRecMessage operator="${op}" messageType="4" message="${esc(msg)}" />`);
}

export const xmlChiusuraGiornaliera = (o: OpzioniEpson) =>
  busta(`<printerFiscalReport>\n<printZReport operator="${esc(o.operatore ?? '1')}" />\n</printerFiscalReport>`);

export interface RispostaEpson {
  ok: boolean;
  codice: string;
  stato: string;
  numeroDocumento?: number;
  zNumero?: number;
  importo?: string;
  data?: string;
  ora?: string;
}

const campo = (xml: string, nome: string) => {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? m[1].trim() : undefined;
};

export function leggiRispostaEpson(xml: string): RispostaEpson {
  const resp = xml.match(/<response\b([^>]*)>/);
  if (!resp) throw new Error('Risposta Epson non riconosciuta');
  const attr = (n: string) => resp[1].match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? '';
  const num = (s?: string) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : undefined);
  return {
    ok: attr('success') === 'true',
    codice: attr('code'),
    stato: attr('status'),
    numeroDocumento: num(campo(xml, 'fiscalReceiptNumber')),
    zNumero: num(campo(xml, 'zRepNumber')),
    importo: campo(xml, 'fiscalReceiptAmount'),
    data: campo(xml, 'fiscalReceiptDate'),
    ora: campo(xml, 'fiscalReceiptTime'),
  };
}

/** Stampa di prova NON fiscale sull'RT (non crea documenti). COLLAUDO: confermare sul firmware del Moorea. */
export function xmlStampaNonFiscale(righe: string[]): string {
  const r = righe.map((t) => `<printNormal operator="1" font="1" data="${esc(descrizioneRt(t))}" />`).join('\n');
  return busta(`<printerNonFiscal>\n<beginNonFiscal operator="1" />\n${r}\n<endNonFiscal operator="1" />\n</printerNonFiscal>`);
}
