// Modello di ticket non fiscale (comanda, preconto) + rendering in byte ESC/POS.
// La stessa struttura serve all'anteprima a schermo, quindi quello che vedi è quello che esce.

export type Allineamento = 'sx' | 'centro' | 'dx';

export type RigaTicket =
  | { k: 'testo'; testo: string; grande?: boolean; doppiaAltezza?: boolean; grassetto?: boolean; inverso?: boolean; allinea?: Allineamento; rientro?: number }
  | { k: 'coppia'; sx: string; dx: string; grassetto?: boolean; doppiaAltezza?: boolean }
  | { k: 'separatore' }
  | { k: 'vuota' };

export interface Ticket { titolo: string; righe: RigaTicket[]; taglio: boolean; }

// ---------------------------------------------------------------------------
// Testo: le Matchpower (come quasi tutte le termiche ESC/POS) usano code page tipo PC850/PC858.
// Mappiamo le accentate italiane; il resto viene ripulito.
const PC858: Record<string, number> = {
  'à': 0x85, 'è': 0x8a, 'é': 0x82, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97,
  'À': 0xb7, 'È': 0xd4, 'É': 0x90, 'Ì': 0xde, 'Ò': 0xe3, 'Ù': 0xeb,
  '€': 0xd5, '°': 0xf8, 'ª': 0xa6, 'º': 0xa7, '·': 0xfa,
};
const SOSTITUZIONI: Record<string, string> = { '×': 'x', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '−': '-' };

export function codificaTesto(s: string, euroSupportato = true): number[] {
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '€' && !euroSupportato) { out.push(...[0x45, 0x55, 0x52]); continue; }
    if (PC858[ch] !== undefined) { out.push(PC858[ch]); continue; }
    const sost = SOSTITUZIONI[ch] ?? ch;
    for (const c of sost.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
      const code = c.charCodeAt(0);
      out.push(code >= 0x20 && code < 0x7f ? code : 0x3f);
    }
  }
  return out;
}

/** Lunghezza a schermo/carta (un carattere = una colonna). */
const lung = (s: string) => [...s].length;

export function tronca(s: string, max: number): string {
  return lung(s) <= max ? s : [...s].slice(0, Math.max(0, max - 1)).join('') + '.';
}

/** Va a capo sulle parole, rispettando la larghezza. */
export function aCapo(s: string, larghezza: number): string[] {
  const parole = s.split(/\s+/).filter(Boolean);
  const righe: string[] = [];
  let cur = '';
  for (const p of parole) {
    if (!cur) cur = tronca(p, larghezza);
    else if (lung(cur) + 1 + lung(p) <= larghezza) cur += ' ' + p;
    else { righe.push(cur); cur = tronca(p, larghezza); }
  }
  if (cur) righe.push(cur);
  return righe.length ? righe : [''];
}

export function coppia(sx: string, dx: string, larghezza: number): string {
  const spazio = Math.max(1, larghezza - lung(dx));
  const s = tronca(sx, spazio - 1);
  return s + ' '.repeat(larghezza - lung(s) - lung(dx)) + dx;
}

/** Righe di testo semplice, per l'anteprima e per i test. */
export function anteprima(t: Ticket, colonne: number): { testo: string; stile: Omit<Extract<RigaTicket, { k: 'testo' }>, 'k' | 'testo'> }[] {
  const out: { testo: string; stile: any }[] = [];
  for (const r of t.righe) {
    if (r.k === 'vuota') out.push({ testo: '', stile: {} });
    else if (r.k === 'separatore') out.push({ testo: '-'.repeat(colonne), stile: {} });
    else if (r.k === 'coppia') {
      const larg = r.doppiaAltezza ? colonne : colonne;
      out.push({ testo: coppia(r.sx, r.dx, larg), stile: { grassetto: r.grassetto, doppiaAltezza: r.doppiaAltezza } });
    } else {
      const larg = r.grande ? Math.floor(colonne / 2) : colonne - (r.rientro ?? 0);
      for (const l of aCapo(r.testo, larg)) {
        out.push({ testo: ' '.repeat(r.rientro ?? 0) + l, stile: { grande: r.grande, doppiaAltezza: r.doppiaAltezza, grassetto: r.grassetto, inverso: r.inverso, allinea: r.allinea } });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ESC/POS
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

export interface OpzioniEscPos { colonne: number; codePage?: number; euro?: boolean; righeAvanzamento?: number; }

export function renderEscPos(t: Ticket, o: OpzioniEscPos): Uint8Array {
  const b: number[] = [];
  const cp = o.codePage ?? 19; // 19 = PC858 su Epson e compatibili; da confermare sul foglio di configurazione
  b.push(ESC, 0x40);            // init
  b.push(ESC, 0x74, cp);        // code page
  const stile = (grassetto = false, dimensione = 0x00, inverso = false, allinea: Allineamento = 'sx') => {
    b.push(ESC, 0x45, grassetto ? 1 : 0);
    b.push(GS, 0x21, dimensione);
    b.push(GS, 0x42, inverso ? 1 : 0);
    b.push(ESC, 0x61, allinea === 'sx' ? 0 : allinea === 'centro' ? 1 : 2);
  };
  const scrivi = (s: string) => { b.push(...codificaTesto(s, o.euro ?? true), LF); };

  for (const r of t.righe) {
    if (r.k === 'vuota') { stile(); b.push(LF); continue; }
    if (r.k === 'separatore') { stile(); scrivi('-'.repeat(o.colonne)); continue; }
    if (r.k === 'coppia') {
      stile(!!r.grassetto, r.doppiaAltezza ? 0x01 : 0x00);
      scrivi(coppia(r.sx, r.dx, o.colonne));
      continue;
    }
    const dim = r.grande ? 0x11 : r.doppiaAltezza ? 0x01 : 0x00;
    stile(!!r.grassetto, dim, !!r.inverso, r.allinea ?? 'sx');
    const larg = r.grande ? Math.floor(o.colonne / 2) : o.colonne - (r.rientro ?? 0);
    for (const l of aCapo(r.testo, larg)) scrivi(' '.repeat(r.rientro ?? 0) + l);
  }
  stile();
  for (let i = 0; i < (o.righeAvanzamento ?? 4); i++) b.push(LF);
  if (t.taglio) b.push(GS, 0x56, 0x42, 0x00); // avanza e taglio parziale
  return Uint8Array.from(b);
}
