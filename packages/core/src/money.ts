import type { Cents } from './types';

/** "€ 1.234,50" — formato italiano, sempre due decimali. */
export function euro(cents: Cents, simbolo = true): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const intero = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${simbolo ? '€ ' : ''}${intero},${dec}`;
}

/** Divide un totale in n quote uguali; i centesimi di resto vanno sull'ultima. */
export function dividiAllaRomana(totale: Cents, persone: number): Cents[] {
  if (!Number.isInteger(persone) || persone < 1) throw new Error('Numero di persone non valido');
  const base = Math.floor(totale / persone);
  const quote = Array.from({ length: persone }, () => base);
  quote[persone - 1] += totale - base * persone;
  return quote;
}

/** Converte "28,50" / "28.5" / "28" in centesimi. */
export function parseEuro(testo: string): Cents {
  let pulito = testo.replace(/[€\s]/g, '');
  // "1.234,50" e "1.000": punto delle migliaia. "28.5" o "28.50": punto decimale.
  if (pulito.includes(',') || /\.\d{3}$/.test(pulito)) pulito = pulito.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(pulito)) throw new Error(`Importo non valido: ${testo}`);
  return Math.round(parseFloat(pulito) * 100);
}
