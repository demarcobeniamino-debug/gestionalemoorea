// Stampanti trovate in rete → profilo pronto da usare (il "driver").
// Le termiche di rete non hanno bisogno di driver di sistema: la cassa manda ESC/POS
// sulla porta 9100; l'Epson RT riceve XML su fpmate.cgi. Il profilo dice protocollo,
// porta, larghezza carta e set di caratteri.
import type { TipoStampante } from './types';

export type GenereTrovata = 'escpos' | 'porta9100' | 'epson_rt' | 'rch_rt' | 'web';

export interface Trovata {
  ip: string; porta: number; genere: GenereTrovata;
  marca?: string | null; modello?: string | null; dettaglio?: string | null;
}

export interface Profilo {
  tipo: TipoStampante; porta: number; colonne: 32 | 42 | 48; codePage: number;
  /** "Stampante comande EPSON TM-T20III" */
  descrizione: string;
  /** false: la riconosciamo ma la cassa non sa ancora usarla. */
  supportata: boolean;
  modello: string | null;
}

const nomeModello = (t: Trovata) => [t.marca, t.modello].filter(Boolean).join(' ').trim() || null;

export function profiloDa(t: Trovata): Profilo | null {
  const modello = nomeModello(t);
  switch (t.genere) {
    case 'epson_rt':
      return { tipo: 'rt_epson_xml', porta: 80, colonne: 48, codePage: 19, supportata: true, modello: modello ?? 'EPSON RT',
        descrizione: `Registratore telematico ${modello ?? 'Epson'}` };
    case 'rch_rt':
      return { tipo: 'rt_rch', porta: 80, colonne: 48, codePage: 19, supportata: false, modello: modello ?? 'RCH',
        descrizione: `Registratore telematico ${modello ?? 'RCH'} (non ancora gestito dalla cassa)` };
    case 'escpos':
    case 'porta9100': {
      // 58 mm = 32 caratteri: si riconosce solo dal nome del modello; altrimenti 80 mm (48).
      const stretta = /58|T58|POS-?58|ZJ-?58/i.test(modello ?? '');
      return { tipo: 'comande_escpos', porta: 9100, colonne: stretta ? 32 : 48, codePage: 19, supportata: true, modello,
        descrizione: modello ? `Stampante comande ${modello}` : 'Stampante comande (porta 9100)' };
    }
    default:
      return null;
  }
}

/** Le stampanti prima, poi il resto; un indirizzo può avere sia 9100 che 80 (stampanti con pagina web). */
export function soloStampanti(trovate: Trovata[]): Trovata[] {
  const conProfilo = trovate.filter((t) => profiloDa(t));
  // Se un IP ha già la 9100, la sua pagina web non conta come seconda stampante.
  return conProfilo.filter((t) => !(t.genere === 'web' && conProfilo.some((x) => x.ip === t.ip && x.genere !== 'web')));
}
