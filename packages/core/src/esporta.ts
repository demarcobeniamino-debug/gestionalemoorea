// Export per il commercialista: corrispettivi giorno per giorno (pagamenti, IVA scorporata, annulli e resi)
// ed elenco dei documenti commerciali. CSV con il punto e virgola e la virgola decimale: si apre così in Excel italiano.
import type { DatiPeriodo } from './report';
import { giornoDiServizio } from './report';
import type { Setup } from './seed';
import type { Documento } from './types';
import { PAGAMENTO_RT } from './types';
import { calcolaFattura } from './fattura';

const n = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const csv = (righe: (string | number)[][]) =>
  '﻿' + righe.map((r) => r.map((x) => { const s = String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n') + '\r\n';
const dataIt = (g: string) => g.split('-').reverse().join('/');

/** Il segno: i resi tolgono, tutto il resto aggiunge. */
const segno = (d: Documento) => (d.tipo === 'reso' ? -1 : 1);

export function esportaCorrispettivi(d: DatiPeriodo, s: Setup, dal: string, al: string) {
  const dentro = (doc: Documento) => { const g = giornoDiServizio(doc.createdAt); return g >= dal && g <= al; };
  const validi = d.documenti.filter((x) => dentro(x) && x.stato === 'emesso' && (x.tipo === 'documento_commerciale' || x.tipo === 'reso'));
  const annullati = d.documenti.filter((x) => dentro(x) && x.tipo === 'documento_commerciale' && x.stato === 'annullato');
  const aliquote = [...new Set(s.aliquote.map((a) => a.percentuale))].sort((a, b) => a - b);

  type Giorno = { scontrini: number; totale: number; resi: number; annulli: number; annulliCents: number; rt: Record<string, number>; iva: Record<number, { imp: number; iva: number }> };
  const giorni = new Map<string, Giorno>();
  const g = (k: string) => {
    if (!giorni.has(k)) giorni.set(k, { scontrini: 0, totale: 0, resi: 0, annulli: 0, annulliCents: 0, rt: {}, iva: {} });
    return giorni.get(k)!;
  };
  for (const doc of validi) {
    const x = g(giornoDiServizio(doc.createdAt)); const k = segno(doc);
    if (doc.tipo === 'reso') x.resi += doc.totaleCents; else x.scontrini++;
    x.totale += k * doc.totaleCents;
    // Pagamenti per tipo fiscale; per i contanti conta l'incassato, non il ricevuto (resto).
    const altri = doc.pagamenti.filter((p) => p.tipo !== 'contanti');
    for (const p of altri) x.rt[PAGAMENTO_RT[p.tipo]] = (x.rt[PAGAMENTO_RT[p.tipo]] ?? 0) + k * p.importoCents;
    if (doc.pagamenti.some((p) => p.tipo === 'contanti')) x.rt.contanti = (x.rt.contanti ?? 0) + k * Math.max(0, doc.totaleCents - altri.reduce((t, p) => t + p.importoCents, 0));
    try {
      for (const r of calcolaFattura(doc.righe, doc.scontoCents, s.aliquote).riepilogo) {
        const v = x.iva[r.aliquota] ?? { imp: 0, iva: 0 };
        v.imp += k * r.imponibileCents; v.iva += k * r.impostaCents; x.iva[r.aliquota] = v;
      }
    } catch { /* righe di un reparto senza aliquota: restano solo nei totali */ }
  }
  for (const doc of annullati) { const x = g(giornoDiServizio(doc.createdAt)); x.annulli++; x.annulliCents += doc.totaleCents; }

  const testa = ['Data', 'Scontrini', 'Corrispettivi', 'Contanti', 'Elettronico', 'Buoni pasto', 'Non riscosso', ...aliquote.flatMap((a) => [`Imponibile ${a}%`, `IVA ${a}%`]), 'Resi', 'Annulli (n.)', 'Annulli (euro)'];
  const corpo = [...giorni.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [
    dataIt(k), x.scontrini, n(x.totale), n(x.rt.contanti ?? 0), n(x.rt.elettronico ?? 0), n(x.rt.ticket ?? 0), n(x.rt.non_riscosso ?? 0),
    ...aliquote.flatMap((a) => [n(x.iva[a]?.imp ?? 0), n(x.iva[a]?.iva ?? 0)]), n(x.resi), x.annulli, n(x.annulliCents),
  ]);
  const tot = (f: (x: Giorno) => number) => [...giorni.values()].reduce((t, x) => t + f(x), 0);
  const totali = ['TOTALE', tot((x) => x.scontrini), n(tot((x) => x.totale)), n(tot((x) => x.rt.contanti ?? 0)), n(tot((x) => x.rt.elettronico ?? 0)), n(tot((x) => x.rt.ticket ?? 0)), n(tot((x) => x.rt.non_riscosso ?? 0)),
    ...aliquote.flatMap((a) => [n(tot((x) => x.iva[a]?.imp ?? 0)), n(tot((x) => x.iva[a]?.iva ?? 0))]), n(tot((x) => x.resi)), tot((x) => x.annulli), n(tot((x) => x.annulliCents))];

  const docs = d.documenti.filter((x) => dentro(x) && (x.stato === 'emesso' || x.stato === 'annullato')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tipoDoc = (x: Documento) => (x.tipo === 'reso' ? 'Reso' : x.tipo === 'annullo' ? 'Annullo' : x.stato === 'annullato' ? 'Scontrino (annullato)' : 'Scontrino');
  const elenco = [
    ['Data', 'Ora', 'Tipo', 'Numero RT', 'Totale', 'Sconto', 'Pagamenti'],
    ...docs.map((x) => {
      const dt = new Date(x.createdAt.replace(/(Z)\d+$/, '$1'));
      return [dt.toLocaleDateString('it-IT'), dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), tipoDoc(x),
        x.rtDocNumero ? `${x.rtZNumero}-${String(x.rtDocNumero).padStart(4, '0')}` : '', n(segno(x) * x.totaleCents), n(x.scontoCents),
        x.pagamenti.map((p) => `${p.descrizione && !p.descrizione.startsWith('caparra:') ? p.descrizione : p.tipo} ${n(p.importoCents)}`).join(' + ')];
    }),
  ];
  return { corrispettivi: csv([testa, ...corpo, totali]), documenti: csv(elenco), giorni: giorni.size };
}
