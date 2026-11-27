// Regole di servizio legate alle impostazioni del locale: promozioni a orario (happy hour),
// menu fissi con scelte, nome del conto (tavolo, banco, asporto), metodi di pagamento.
import type { Articolo, Comanda, MetodoPagamento, Promozione, RigaComanda, TipoPagamento } from './types';
import type { Setup } from './seed';
import { ErroreDominio } from './operazioni';

const minuti = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** La promozione vale adesso per questo articolo? (giorni e fascia oraria; fasce a cavallo della mezzanotte ok) */
export function promoValida(p: Promozione, a: Articolo, quando: Date): boolean {
  if (!p.attiva) return false;
  if (!p.articoliIds.includes(a.id) && !p.categorieIds.includes(a.categoriaId)) return false;
  if (p.giorni.length && !p.giorni.includes(quando.getDay())) return false;
  const ora = quando.getHours() * 60 + quando.getMinutes();
  const da = minuti(p.dalle || '00:00'), a2 = minuti(p.alle || '24:00');
  return da <= a2 ? ora >= da && ora < a2 : ora >= da || ora < a2;
}

/** Promozione migliore per il cliente fra quelle valide, con lo sconto in centesimi. */
export function promoInVigore(s: Setup, a: Articolo, quando: Date): { promo: Promozione; scontoCents: number } | undefined {
  let migliore: { promo: Promozione; scontoCents: number } | undefined;
  for (const p of s.impostazioni?.promozioni ?? []) {
    if (!promoValida(p, a, quando)) continue;
    const sconto = p.prezzoCents != null ? Math.max(0, a.prezzoCents - p.prezzoCents) : Math.round((a.prezzoCents * (p.percentuale ?? 0)) / 100);
    if (sconto > 0 && (!migliore || sconto > migliore.scontoCents)) migliore = { promo: p, scontoCents: sconto };
  }
  return migliore;
}

export const menuFisso = (s: Setup, articoloId: string) => s.impostazioni?.menuFissi?.[articoloId];

/** Controlla le scelte di un menu fisso: per ogni gruppo il numero giusto di piatti, tutti ammessi. */
export function controllaSceltaMenu(s: Setup, articoloId: string, scelte: { articoloId: string; gruppo: number }[]) {
  const m = menuFisso(s, articoloId);
  if (!m) throw new ErroreDominio('Questo articolo non è un menu fisso');
  m.gruppi.forEach((g, i) => {
    const qui = scelte.filter((x) => x.gruppo === i);
    if (qui.length !== g.scelte) throw new ErroreDominio(`${g.nome}: scegli ${g.scelte === 1 ? '1 piatto' : `${g.scelte} piatti`}`);
    for (const x of qui) if (!g.articoliIds.includes(x.articoloId)) throw new ErroreDominio(`${g.nome}: piatto non previsto`);
  });
  return m;
}

/** Nome del conto per schermi e ticket: "Tavolo 7", "Banco · Marco", "Asporto · Giulia". */
export function nomeConto(s: Setup, c: Pick<Comanda, 'tavoloId' | 'canale' | 'etichetta' | 'tavoliUniti'>): string {
  const t = c.tavoloId ? s.tavoli.find((x) => x.id === c.tavoloId) : undefined;
  if (t) return `${c.tavoliUniti?.length ? 'Tavoli' : 'Tavolo'} ${numeriTavolo(s, c)}`;
  const base = c.canale === 'asporto' ? 'Asporto' : 'Banco';
  return c.etichetta ? `${base} · ${c.etichetta}` : base;
}

/** "3" oppure "3+4+5" se ci sono tavoli uniti. */
export function numeriTavolo(s: Setup, c: Pick<Comanda, 'tavoloId' | 'tavoliUniti'>): string {
  return [c.tavoloId, ...(c.tavoliUniti ?? [])].map((id) => s.tavoli.find((x) => x.id === id)?.numero).filter(Boolean).join('+');
}

/** La comanda aperta che occupa il tavolo: la sua, o quella a cui è unito. */
export function comandaSulTavolo<C extends Pick<Comanda, 'tavoloId' | 'tavoliUniti'>>(aperte: C[], tavoloId: string): C | undefined {
  return aperte.find((c) => c.tavoloId === tavoloId) ?? aperte.find((c) => c.tavoliUniti?.includes(tavoloId));
}

/** Metodi di pagamento attivi: quelli di base più quelli aggiunti in Gestione (Satispay, bonifico…). */
export function metodiPagamento(s: Setup): MetodoPagamento[] {
  const base: MetodoPagamento[] = [
    { id: 'contanti', nome: 'Contanti', tipo: 'contanti', attivo: true },
    { id: 'carta', nome: 'Carta', tipo: 'carta', attivo: true },
    { id: 'buono_pasto', nome: 'Buono pasto', tipo: 'buono_pasto', attivo: true },
  ];
  return [...base, ...(s.impostazioni?.metodi ?? []).filter((m) => m.attivo)];
}

/** Righe che contano per scontrino e preconto: i piatti scelti in un menu fisso stanno dentro il prezzo del menu. */
export const righeDaConto = (r: RigaComanda[]) => r.filter((x) => !x.parentId);

export const TIPI_INCASSO_SOSPESO: TipoPagamento[] = ['contanti', 'carta', 'bonifico', 'buono_pasto', 'prepagata'];
