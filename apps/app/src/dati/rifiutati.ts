import type { StatoRt } from '@gr/core';

/**
 * Il contatore "invii rifiutati" dell'Epson è storico: non si azzera mai.
 * La prima volta che lo vediamo lo prendiamo come già controllato;
 * da lì in poi avvisiamo solo se cresce. "Segna come controllati" lo riallinea.
 */
const CHIAVE = 'gr.rt.rifiutati';

export function rifiutatiNoti(s: StatoRt | undefined): number | undefined {
  if (!s || s.fileRifiutati === undefined) return undefined;
  try {
    const v = localStorage.getItem(CHIAVE);
    if (v === null) { localStorage.setItem(CHIAVE, String(s.fileRifiutati)); return s.fileRifiutati; }
    return Number(v);
  } catch { return s.fileRifiutati; }
}

export function segnaRifiutatiControllati(s: StatoRt | undefined) {
  if (!s || s.fileRifiutati === undefined) return;
  try { localStorage.setItem(CHIAVE, String(s.fileRifiutati)); } catch { /* niente */ }
}
