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
// Testo e set di caratteri ("code page"). È l'unico vero "driver" di una termica di rete:
// se gli accenti escono sbagliati, si sceglie un altro set con la stampa "Prova caratteri".
export const CODE_PAGE: { n: number; nome: string; euro: boolean }[] = [
  { n: 19, nome: 'PC858 (Europa occidentale, con €)', euro: true },
  { n: 2, nome: 'PC850 (Europa occidentale)', euro: false },
  { n: 16, nome: 'Windows-1252', euro: true },
  { n: 0, nome: 'PC437 (USA)', euro: false },
];
const PC850: Record<string, number> = {
  'à': 0x85, 'è': 0x8a, 'é': 0x82, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97,
  'À': 0xb7, 'È': 0xd4, 'É': 0x90, 'Ì': 0xde, 'Ò': 0xe3, 'Ù': 0xeb,
  '°': 0xf8, 'ª': 0xa6, 'º': 0xa7, '·': 0xfa,
};
const PC858: Record<string, number> = { ...PC850, '€': 0xd5 };
const PC437: Record<string, number> = { 'à': 0x85, 'è': 0x8a, 'é': 0x82, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97, 'É': 0x90, '°': 0xf8, 'ª': 0xa6, 'º': 0xa7, '·': 0xfa };
const TABELLE: Record<number, Record<string, number>> = { 19: PC858, 2: PC850, 0: PC437 };
const SOSTITUZIONI: Record<string, string> = { '×': 'x', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '−': '-' };

/** Testo → byte per la stampante. codePage: numero ESC t (19 = PC858); "false" = come PC858 ma senza €. */
export function codificaTesto(s: string, codePage: number | boolean = 19): number[] {
  const cp = typeof codePage === 'boolean' ? 19 : codePage;
  const euro = codePage !== false && (CODE_PAGE.find((c) => c.n === cp)?.euro ?? false);
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '€' && !euro) { out.push(0x45, 0x55, 0x52); continue; }
    if (cp === 16) {
      // Windows-1252: Latin-1 + € a 0x80.
      if (ch === '€') { out.push(0x80); continue; }
      const c = ch.charCodeAt(0);
      if (c >= 0xa0 && c <= 0xff) { out.push(c); continue; }
    } else {
      const t = TABELLE[cp] ?? PC858;
      if (t[ch] !== undefined) { out.push(t[ch]); continue; }
    }
    const sost = SOSTITUZIONI[ch] ?? ch;
    for (const c of sost.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) {
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

export interface OpzioniEscPos { colonne: number; codePage?: number; righeAvanzamento?: number; }

export function renderEscPos(t: Ticket, o: OpzioniEscPos): Uint8Array {
  const b: number[] = [];
  const cp = o.codePage ?? 19; // 19 = PC858 su Epson e compatibili; si cambia dalle impostazioni stampanti
  b.push(ESC, 0x40);            // init
  b.push(ESC, 0x74, cp);        // code page
  b.push(ESC, 0x33, 32);        // interlinea appena più ariosa del normale (30): compatta ma leggibile
  const stile = (grassetto = false, dimensione = 0x00, inverso = false, allinea: Allineamento = 'sx') => {
    b.push(ESC, 0x45, grassetto ? 1 : 0);
    b.push(GS, 0x21, dimensione);
    b.push(GS, 0x42, inverso ? 1 : 0);
    b.push(ESC, 0x61, allinea === 'sx' ? 0 : allinea === 'centro' ? 1 : 2);
  };
  const scrivi = (s: string) => { b.push(...codificaTesto(s, cp), LF); };

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

// ---------------------------------------------------------------------------
// Stampe di prova (dalle impostazioni stampanti)

const RIGA_ACCENTI = 'àèéìòù ÀÈÉ € 12,50';

/** Prova di una stampante comande: nome, indirizzo, larghezza carta e accenti. */
export function ticketProva(p: { nome: string; host: string; porta: number; colonne: number; reparti?: string[]; quando?: Date }): Ticket {
  const righello = '1234567890'.repeat(Math.ceil(p.colonne / 10)).slice(0, p.colonne);
  const ora = (p.quando ?? new Date()).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return {
    titolo: `Prova ${p.nome}`,
    taglio: true,
    righe: [
      { k: 'testo', testo: 'PROVA STAMPA', grande: true, allinea: 'centro' },
      { k: 'testo', testo: p.nome, grassetto: true, allinea: 'centro' },
      { k: 'vuota' },
      { k: 'coppia', sx: 'Indirizzo', dx: `${p.host}:${p.porta}` },
      ...(p.reparti?.length ? [{ k: 'coppia', sx: 'Reparti', dx: p.reparti.join(', ') } as RigaTicket] : []),
      { k: 'coppia', sx: 'Ora', dx: ora },
      { k: 'separatore' },
      { k: 'testo', testo: `Larghezza ${p.colonne} caratteri:` },
      { k: 'testo', testo: righello },
      { k: 'testo', testo: 'Se la riga di numeri va a capo, scegli una carta più stretta.' },
      { k: 'separatore' },
      { k: 'testo', testo: `Accenti: ${RIGA_ACCENTI}` },
      { k: 'testo', testo: 'Se gli accenti sono sbagliati, usa "Prova caratteri".' },
    ],
  };
}

/** Stampa la stessa riga con ogni set di caratteri: si sceglie la lettera scritta giusta. */
export function byteProvaCaratteri(colonne: number): Uint8Array {
  const b: number[] = [ESC, 0x40, ESC, 0x61, 1, ESC, 0x45, 1];
  b.push(...codificaTesto('PROVA CARATTERI', 19), LF, ESC, 0x45, 0, ESC, 0x61, 0, LF);
  CODE_PAGE.forEach((c, i) => {
    b.push(ESC, 0x74, c.n);
    b.push(...codificaTesto(tronca(`${String.fromCharCode(65 + i)}) ${RIGA_ACCENTI}`, colonne), c.n), LF);
  });
  b.push(ESC, 0x74, 19, LF);
  b.push(...codificaTesto('Scegli la lettera con gli accenti giusti', 19), LF);
  b.push(...codificaTesto('e il simbolo dell\'euro (se c\'e).', 19), LF);
  for (let i = 0; i < 4; i++) b.push(LF);
  b.push(GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(b);
}
