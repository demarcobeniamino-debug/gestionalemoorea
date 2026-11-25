import type { Cents, RigaComanda, AliquotaIva, RigaDocumento } from './types';

export const NOMI_PORTATA: Record<number, string> = {
  0: 'Bevande', 1: '1ª portata', 2: '2ª portata', 3: '3ª portata', 9: 'Dessert',
};
export const nomePortata = (p: number) => NOMI_PORTATA[p] ?? `${p}ª portata`;

export function importoRiga(r: RigaComanda): Cents {
  if (r.omaggio || r.stato === 'stornata') return 0;
  const unit = r.prezzoUnitarioCents + r.varianti.reduce((s, v) => s + v.deltaCents, 0);
  return Math.round(unit * r.quantita);
}

export interface Conto {
  righe: RigaComanda[];
  copertoCents: Cents;
  coperti: number;
  subtotaleCents: Cents;
  totaleCents: Cents;
  perPortata: { portata: number; righe: RigaComanda[] }[];
}

export function calcolaConto(righe: RigaComanda[], coperti: number, copertoUnitarioCents: Cents): Conto {
  const valide = righe.filter((r) => r.stato !== 'stornata');
  const subtotale = valide.reduce((s, r) => s + importoRiga(r), 0);
  const coperto = coperti * copertoUnitarioCents;
  const portate = [...new Set(righe.map((r) => r.portata))].sort((a, b) => a - b);
  return {
    righe,
    coperti,
    copertoCents: coperto,
    subtotaleCents: subtotale,
    totaleCents: subtotale + coperto,
    perPortata: portate.map((p) => ({ portata: p, righe: righe.filter((r) => r.portata === p) })),
  };
}

/** Righe del documento commerciale: una per articolo (con varianti a prezzo inglobate) più il coperto. */
export function righeDocumento(
  righe: RigaComanda[], coperti: number, copertoUnitarioCents: Cents,
  aliquote: AliquotaIva[], aliquotaCopertoId: string,
): RigaDocumento[] {
  const reparto = (id: string) => {
    const a = aliquote.find((x) => x.id === id);
    if (!a) throw new Error(`Aliquota IVA mancante: ${id}`);
    return a.repartoRt;
  };
  const out: RigaDocumento[] = righe
    .filter((r) => r.stato !== 'stornata' && !r.omaggio)
    .map((r) => ({
      descrizione: r.descrizione,
      quantita: r.quantita,
      prezzoUnitarioCents: r.prezzoUnitarioCents + r.varianti.reduce((s, v) => s + v.deltaCents, 0),
      repartoRt: reparto(r.aliquotaIvaId),
    }));
  if (coperti > 0 && copertoUnitarioCents > 0) {
    out.push({ descrizione: 'Coperto', quantita: coperti, prezzoUnitarioCents: copertoUnitarioCents, repartoRt: reparto(aliquotaCopertoId) });
  }
  return out;
}

export const totaleRighe = (r: RigaDocumento[]) =>
  r.reduce((s, x) => s + Math.round(x.prezzoUnitarioCents * x.quantita), 0);
