// POS bancari con il Protocollo 17 (ECR17), lo standard italiano per mandare l'importo dal gestionale al POS.
// Messaggi a lunghezza fissa dalla documentazione pubblica Nexi "Traditional POS – LAN integration".
// COLLAUDO: il calcolo dell'LRC (STX incluso o no) si conferma al primo pagamento sul POS UniCredit/Nexi:
// se il POS risponde NAK si prova l'altra variante e la cassa ricorda quella giusta.

export interface PosConfig {
  id: string; nome: string;
  /** Collegato alla cassa (Protocollo 17 in rete) o usato a mano. */
  collegato: boolean;
  host?: string; porta?: number;
  /** Codice terminale stampato sul POS (8 cifre). 00000000 se il POS non lo controlla. */
  terminale?: string;
  /** Carte che accetta solo questo POS (es. American Express): promemoria per chi incassa. */
  nota?: string;
}

const STX = 0x02, ETX = 0x03, ACK = 0x06;
export type VarianteLrc = 'senza_stx' | 'con_stx';

const cifre = (n: number | string, len: number) => String(n).replace(/\D/g, '').padStart(len, '0').slice(-len);
const ascii = (s: string) => [...s.normalize('NFD').replace(/[̀-ͯ]/g, '')].map((c) => { const k = c.charCodeAt(0); return k >= 0x20 && k < 0x7f ? k : 0x20; });

export function lrc(byte: number[]) { return byte.reduce((x, b) => x ^ b, 0x7f); }

/** STX + messaggio + ETX + LRC. */
export function incornicia(msg: string, v: VarianteLrc = 'senza_stx'): Uint8Array {
  const corpo = [...ascii(msg), ETX];
  const l = lrc(v === 'con_stx' ? [STX, ...corpo] : corpo);
  return new Uint8Array([STX, ...corpo, l]);
}
/** ACK che la cassa manda al POS dopo l'esito. */
export const conferma = (v: VarianteLrc = 'senza_stx') => new Uint8Array([ACK, ETX, lrc(v === 'con_stx' ? [ACK, ETX] : [ACK, ETX])]);

/** Richiesta di pagamento ('P'): importo in centesimi, riconoscimento automatico della carta. */
export function messaggioPagamento(p: { terminale?: string; cassa?: string; importoCents: number; testo?: string }): string {
  if (!Number.isInteger(p.importoCents) || p.importoCents <= 0) throw new Error('Importo non valido per il POS');
  if (p.importoCents > 99_999_999) throw new Error('Importo troppo alto per il POS');
  const testo = (p.testo ?? '').slice(0, 128).padStart(128, ' ');
  const m = cifre(p.terminale ?? '0', 8) + '0' + 'P' + cifre(p.cassa ?? '1', 8) + '0' + '00' + '0' + '0' + cifre(p.importoCents, 8) + testo + '00000000';
  if (m.length !== 167) throw new Error(`Messaggio POS di lunghezza ${m.length}`);
  return m;
}

export interface EsitoPos {
  ok: boolean;
  codice: string;
  /** Carta mascherata (ultime 4 cifre). */
  carta?: string;
  lettura?: string;
  autorizzazione?: string;
  tipoCarta?: 'bancomat' | 'credito' | 'altra';
  motivo?: string;
  stan?: string;
}

/** Esito ('E' o 'V'). Posizioni 1-based della specifica. */
export function leggiEsitoPos(msg: string): EsitoPos {
  const f = (pos: number, len: number) => msg.slice(pos - 1, pos - 1 + len);
  const codiceMsg = f(10, 1);
  if (codiceMsg !== 'E' && codiceMsg !== 'V') throw new Error(`Risposta del POS non riconosciuta (${codiceMsg || 'vuota'})`);
  const codice = f(11, 2);
  const tipo = f(48, 1);
  const base = { codice, tipoCarta: tipo === '1' ? 'bancomat' as const : tipo === '2' ? 'credito' as const : tipo === '3' ? 'altra' as const : undefined, stan: f(60, 6) || undefined };
  if (codice === '00') {
    const pan = f(13, 19).replace(/^0+/, '');
    return { ...base, ok: true, carta: pan ? `**** ${pan.slice(-4)}` : undefined, lettura: f(32, 3).trim() || undefined, autorizzazione: f(35, 6).trim() || undefined };
  }
  const motivo = codice === '01' ? f(13, 24).trim() || 'Pagamento rifiutato' : codice === '05' ? 'Carta non presente' : codice === '09' ? 'Errore del POS (tag sconosciuto)' : `Esito ${codice}`;
  return { ...base, ok: false, motivo };
}
