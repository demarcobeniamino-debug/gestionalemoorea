// Numeri della giornata (o di un periodo): incassi, coperti, conti, cosa si vende, chi vende.
// Servono alla schermata "Cassa e statistiche" e ai totali salvati con la chiusura fiscale.
import type { Comanda, Documento, RigaComanda, TipoPagamento } from './types';
import type { Setup } from './seed';
import { importoRiga } from './conto';

export interface DatiPeriodo { comande: Comanda[]; righe: RigaComanda[]; documenti: Documento[] }

export interface Riepilogo {
  incassoCents: number;
  scontiCents: number;
  perPagamento: Partial<Record<TipoPagamento, number>>;
  scontrini: number;
  annullati: number;
  annullatiCents: number;
  /** Resi parziali emessi (rimborsati): già tolti dall'incasso. */
  resi: number;
  resiCents: number;
  conti: number;
  coperti: number;
  contoMedioCents: number;
  aCopertoCents: number;
  perSala: { nome: string; incassoCents: number; coperti: number; conti: number }[];
  perOperatore: { nome: string; incassoCents: number; coperti: number; conti: number }[];
  piatti: { articoloId: string; descrizione: string; categoria: string; quantita: number; importoCents: number }[];
  perCategoria: { nome: string; colore: string; importoCents: number; quantita: number }[];
  perOra: { ora: number; incassoCents: number }[];
  perGiorno: { giorno: string; incassoCents: number; coperti: number }[];
  aperti: { tavoli: number; coperti: number; valoreCents: number };
  storni: { quantita: number; importoCents: number };
  /** Conti chiusi come proforma (famiglia, amici, staff): consumati ma non incassati. */
  proforma: { conti: number; coperti: number; valoreCents: number; elenco: { comandaId: string; motivo: string; nome?: string; totaleCents: number; quando: string }[] };
  /** Conti eliminati (aperti per errore, prove…). */
  eliminati: number;
}

export const giornoDiServizio = (iso: string) => {
  // Giornata di servizio: le 01:30 appartengono alla sera prima (cambio alle 05:00, ora locale).
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function riepilogo(d: DatiPeriodo, s: Setup): Riepilogo {
  const validi = d.documenti.filter((x) => x.tipo === 'documento_commerciale' && x.stato === 'emesso');
  const annullati = d.documenti.filter((x) => x.tipo === 'documento_commerciale' && x.stato === 'annullato');
  const comanda = new Map(d.comande.map((c) => [c.id, c]));
  const resi = d.documenti.filter((x) => x.tipo === 'reso' && x.stato === 'emesso');
  const resiCents = resi.reduce((t, x) => t + x.totaleCents, 0);
  const incasso = validi.reduce((t, x) => t + x.totaleCents, 0) - resiCents;

  // Il contante ricevuto può superare il dovuto (c'è il resto): conta solo l'incassato.
  const perPagamento: Riepilogo['perPagamento'] = {};
  for (const doc of validi) {
    const altri = doc.pagamenti.filter((p) => p.tipo !== 'contanti');
    for (const p of altri) perPagamento[p.tipo] = (perPagamento[p.tipo] ?? 0) + p.importoCents;
    if (doc.pagamenti.some((p) => p.tipo === 'contanti'))
      perPagamento.contanti = (perPagamento.contanti ?? 0) + Math.max(0, doc.totaleCents - altri.reduce((t, p) => t + p.importoCents, 0));
  }

  const proforma = d.comande.filter((c) => c.stato === 'chiusa' && c.proforma);
  for (const x of resi) for (const p of x.pagamenti) perPagamento[p.tipo] = (perPagamento[p.tipo] ?? 0) - p.importoCents;

  const chiuse = d.comande.filter((c) => c.stato === 'chiusa' && !c.proforma);
  const coperti = chiuse.reduce((t, c) => t + c.coperti, 0);

  const sala = (c?: Comanda) => s.sale.find((x) => x.id === s.tavoli.find((t) => t.id === c?.tavoloId)?.salaId)?.nome ?? 'Senza tavolo';
  const gruppo = <K extends string>(chiave: (doc: Documento) => K) => {
    const m = new Map<K, { incassoCents: number; comande: Set<string> }>();
    for (const doc of validi) {
      const k = chiave(doc);
      const g = m.get(k) ?? { incassoCents: 0, comande: new Set() };
      g.incassoCents += doc.totaleCents; g.comande.add(doc.comandaId);
      m.set(k, g);
    }
    return [...m.entries()].map(([nome, g]) => ({
      nome, incassoCents: g.incassoCents, conti: g.comande.size,
      coperti: [...g.comande].reduce((t, id) => t + (comanda.get(id)?.coperti ?? 0), 0),
    })).sort((a, b) => b.incassoCents - a.incassoCents);
  };

  const venduti = d.righe.filter((r) => r.stato !== 'stornata' && comanda.get(r.comandaId)?.stato !== 'annullata');
  const piatti = new Map<string, Riepilogo['piatti'][number]>();
  const categorie = new Map<string, Riepilogo['perCategoria'][number]>();
  for (const r of venduti) {
    const art = s.articoli.find((a) => a.id === r.articoloId);
    const cat = s.categorie.find((c) => c.id === art?.categoriaId);
    // Voci libere: raggruppate per descrizione.
    const chiave = r.articoloId ?? `libera:${r.descrizione.toLowerCase()}`;
    const p = piatti.get(chiave) ?? { articoloId: chiave, descrizione: art?.nome ?? r.descrizione, categoria: cat?.nome ?? 'Fuori menu', quantita: 0, importoCents: 0 };
    p.quantita += r.quantita; p.importoCents += importoRiga(r);
    piatti.set(chiave, p);
    const nome = cat?.nome ?? (r.articoloId ? 'Altro' : 'Fuori menu');
    const c = categorie.get(nome) ?? { nome, colore: cat?.colore ?? '#a3acba', importoCents: 0, quantita: 0 };
    c.importoCents += importoRiga(r); c.quantita += r.quantita;
    categorie.set(nome, c);
  }
  const stornate = d.righe.filter((r) => r.stato === 'stornata');

  const perOra = new Map<number, number>();
  const perGiorno = new Map<string, { incassoCents: number; coperti: number }>();
  for (const doc of validi) {
    const h = new Date(doc.createdAt).getHours();
    perOra.set(h, (perOra.get(h) ?? 0) + doc.totaleCents);
    const g = perGiorno.get(giornoDiServizio(doc.createdAt)) ?? { incassoCents: 0, coperti: 0 };
    g.incassoCents += doc.totaleCents;
    perGiorno.set(giornoDiServizio(doc.createdAt), g);
  }
  for (const c of chiuse) {
    const g = perGiorno.get(giornoDiServizio(c.chiusaAt ?? c.apertaAt)) ?? { incassoCents: 0, coperti: 0 };
    g.coperti += c.coperti;
    perGiorno.set(giornoDiServizio(c.chiusaAt ?? c.apertaAt), g);
  }

  const aperte = d.comande.filter((c) => c.stato === 'aperta' || c.stato === 'preconto');
  return {
    incassoCents: incasso,
    scontiCents: validi.reduce((t, x) => t + x.scontoCents, 0),
    perPagamento,
    scontrini: validi.length,
    annullati: annullati.length,
    annullatiCents: annullati.reduce((t, x) => t + x.totaleCents, 0),
    resi: resi.length, resiCents,
    conti: chiuse.length,
    coperti,
    contoMedioCents: chiuse.length ? Math.round(incasso / chiuse.length) : 0,
    aCopertoCents: coperti ? Math.round(incasso / coperti) : 0,
    perSala: gruppo((doc) => sala(comanda.get(doc.comandaId))),
    perOperatore: gruppo((doc) => comanda.get(doc.comandaId)?.operatore || 'n.d.'),
    piatti: [...piatti.values()].sort((a, b) => b.quantita - a.quantita || b.importoCents - a.importoCents),
    perCategoria: [...categorie.values()].sort((a, b) => b.importoCents - a.importoCents),
    perOra: [...perOra.entries()].map(([ora, incassoCents]) => ({ ora, incassoCents })).sort((a, b) => ((a.ora + 19) % 24) - ((b.ora + 19) % 24)),
    perGiorno: [...perGiorno.entries()].map(([g, v]) => ({ giorno: g, ...v })).sort((a, b) => a.giorno.localeCompare(b.giorno)),
    aperti: {
      tavoli: aperte.length,
      coperti: aperte.reduce((t, c) => t + c.coperti, 0),
      valoreCents: aperte.reduce((t, c) => t + d.righe.filter((r) => r.comandaId === c.id && r.stato !== 'stornata').reduce((a, r) => a + importoRiga(r), 0) + c.coperti * s.locale.copertoCents, 0),
    },
    proforma: {
      conti: proforma.length, coperti: proforma.reduce((t, c) => t + c.coperti, 0),
      valoreCents: proforma.reduce((t, c) => t + (c.proforma?.totaleCents ?? 0), 0),
      elenco: proforma.map((c) => ({ comandaId: c.id, motivo: c.proforma!.motivo, nome: c.proforma!.nome, totaleCents: c.proforma!.totaleCents, quando: c.chiusaAt ?? c.apertaAt }))
        .sort((a, b) => b.quando.localeCompare(a.quando)),
    },
    // Gli unisci tavoli lasciano un conto "annullato" senza righe: non è un conto eliminato.
    eliminati: d.comande.filter((c) => c.stato === 'annullata' && d.righe.some((r) => r.comandaId === c.id)).length,
    storni: { quantita: stornate.reduce((t, r) => t + r.quantita, 0), importoCents: stornate.reduce((t, r) => t + r.prezzoUnitarioCents * r.quantita, 0) },
  };
}

/** Totali salvati con la chiusura fiscale (tabella chiusure). */
export const totaliChiusura = (r: Riepilogo) => ({
  incasso_cents: r.incassoCents, sconti_cents: r.scontiCents, per_pagamento: r.perPagamento, scontrini: r.scontrini,
  annullati: r.annullati, resi_cents: r.resiCents, conti: r.conti, coperti: r.coperti,
  proforma_conti: r.proforma.conti, proforma_cents: r.proforma.valoreCents, conti_eliminati: r.eliminati,
  per_sala: r.perSala, per_operatore: r.perOperatore,
});

/** Menu engineering semplice: quanto vende e quanto rende ogni piatto rispetto alla media della categoria. */
export function classificaPiatto(p: { quantita: number; margineCents: number | null }, mediaQuantita: number, mediaMargine: number) {
  const popolare = p.quantita >= mediaQuantita * 0.7;
  if (p.margineCents == null) return popolare ? 'popolare' : 'poco venduto';
  const redditizio = p.margineCents >= mediaMargine;
  return popolare && redditizio ? 'stella' : popolare ? 'cavallo da tiro' : redditizio ? 'enigma' : 'da rivedere';
}
