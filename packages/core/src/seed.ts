// Dati di esempio per sviluppo e demo. Prezzi e piatti sono indicativi: si sostituiscono dal back office.
import menuMoorea from './menu-moorea.json';
import { testoSu } from './gestione';
import type { AliquotaIva, Articolo, Categoria, CentroProduzione, Sala, Stampante, Tavolo, Variante } from './types';

export interface Setup {
  locale: { id: string; nome: string; citta: string; copertoCents: number; aliquotaCopertoId: string };
  stampanti: Stampante[];
  centri: CentroProduzione[];
  aliquote: AliquotaIva[];
  sale: Sala[];
  tavoli: Tavolo[];
  categorie: Categoria[];
  articoli: Articolo[];
  varianti: Variante[];
  operatori: { id: string; nome: string; pin?: string; ruolo: string }[];
}

const t = (id: string, salaId: string, numero: string, forma: Tavolo['forma'], x: number, y: number, larghezza = 1, altezza = 1, posti = 4): Tavolo =>
  ({ id, salaId, numero, forma, x, y, larghezza, altezza, posti });

let n = 0;
const a = (categoriaId: string, nome: string, euro: number, allergeni: Articolo['allergeni'] = [], extra: Partial<Articolo> = {}): Articolo => ({
  id: `art-${++n}`, categoriaId, nome, prezzoCents: Math.round(euro * 100), aliquotaIvaId: 'iva10',
  allergeni, esaurito: false, variantiIds: [], ...extra,
});

export function seedMoorea(): Setup {
  n = 0;
  return {
    locale: { id: 'demo', nome: 'Moorea Food Club', citta: 'Maiori', copertoCents: 200, aliquotaCopertoId: 'iva10' },
    // IP segnaposto: si inseriscono quelli veri dopo il collaudo.
    stampanti: [
      { id: 'st-cucina', nome: 'Cucina', tipo: 'comande_escpos', host: '192.168.1.101', porta: 9100, colonne: 48 },
      { id: 'st-bar', nome: 'Bar', tipo: 'comande_escpos', host: '192.168.1.102', porta: 9100, colonne: 48 },
      { id: 'st-preconto', nome: 'Preconto', tipo: 'comande_escpos', host: '192.168.1.103', porta: 9100, colonne: 48, perPreconto: true },
      { id: 'st-rt', nome: 'Cassa RT', tipo: 'rt_epson_xml', host: '192.168.1.110', porta: 80, colonne: 48, matricolaRt: '' },
    ],
    centri: [
      { id: 'cp-cucina', nome: 'Cucina', stampanteId: 'st-cucina' },
      { id: 'cp-bar', nome: 'Bar', stampanteId: 'st-bar' },
    ],
    // COLLAUDO: reparti come programmati sull'RT dal tecnico.
    aliquote: [
      { id: 'iva10', descrizione: '10% somministrazione', percentuale: 10, repartoRt: 1 },
      { id: 'iva22', descrizione: '22%', percentuale: 22, repartoRt: 2 },
    ],
    sale: [
      { id: 'sala-int', nome: 'Interno', ordine: 1 },
      { id: 'sala-perg', nome: 'Pergotenda', ordine: 2 },
    ],
    tavoli: [
      t('t1', 'sala-int', '1', 'quadrato', 0, 0, 1, 1, 2), t('t2', 'sala-int', '2', 'quadrato', 1, 0),
      t('t3', 'sala-int', '3', 'quadrato', 2, 0), t('t4', 'sala-int', '4', 'quadrato', 3, 0),
      t('t5', 'sala-int', '5', 'quadrato', 4, 0), t('t6', 'sala-int', '6', 'tondo', 0, 1, 1, 1, 2),
      t('t7', 'sala-int', '7', 'tondo', 1, 1), t('t8', 'sala-int', '8', 'tondo', 2, 1, 1, 1, 2),
      t('t9', 'sala-int', '9', 'tondo', 3, 1, 1, 1, 2), t('t10', 'sala-int', '10', 'rettangolo', 0, 2, 3, 1, 14),
      t('t11', 'sala-int', '11', 'quadrato', 3, 2), t('t12', 'sala-int', '12', 'quadrato', 4, 2, 1, 1, 6),
      t('p1', 'sala-perg', '21', 'quadrato', 0, 0), t('p2', 'sala-perg', '22', 'quadrato', 1, 0),
      t('p3', 'sala-perg', '23', 'quadrato', 2, 0), t('p4', 'sala-perg', '24', 'tondo', 0, 1, 1, 1, 2),
    ],
    categorie: [
      { id: 'c-tapas', nome: 'Tapas', colore: '#e9c46a', testoColore: '#1a1204', ordine: 1, centroProduzioneId: 'cp-cucina', portataPredefinita: 1 },
      { id: 'c-antipasti', nome: 'Antipasti', colore: '#f4a261', testoColore: '#1a0d04', ordine: 2, centroProduzioneId: 'cp-cucina', portataPredefinita: 1 },
      { id: 'c-primi', nome: 'Primi', colore: '#f2f4f7', testoColore: '#0f1216', ordine: 3, centroProduzioneId: 'cp-cucina', portataPredefinita: 2 },
      { id: 'c-secondi', nome: 'Secondi', colore: '#e76f51', testoColore: '#160604', ordine: 4, centroProduzioneId: 'cp-cucina', portataPredefinita: 3 },
      { id: 'c-dessert', nome: 'Dessert', colore: '#c9a7eb', testoColore: '#140a1e', ordine: 5, centroProduzioneId: 'cp-cucina', portataPredefinita: 9 },
      { id: 'c-cocktail', nome: 'Cocktail', colore: '#7cc8ff', testoColore: '#04121c', ordine: 6, centroProduzioneId: 'cp-bar', portataPredefinita: 0 },
      { id: 'c-vini', nome: 'Vini', colore: '#d4a5a5', testoColore: '#1c0a0a', ordine: 7, centroProduzioneId: 'cp-bar', portataPredefinita: 0 },
      { id: 'c-bibite', nome: 'Acqua e bibite', colore: '#a3acba', testoColore: '#0f1216', ordine: 8, centroProduzioneId: 'cp-bar', portataPredefinita: 0 },
    ],
    articoli: [
      a('c-tapas', 'Polpette al sugo', 9, ['glutine', 'uova', 'latte']),
      a('c-tapas', 'Bruschetta salsiccia e provola', 8, ['glutine', 'latte']),
      a('c-tapas', 'Mozzarella in carrozza', 9, ['glutine', 'latte', 'uova']),
      a('c-tapas', 'Scamorza in foglia di limone', 10, ['latte']),
      a('c-tapas', 'Fresella, alici di Cetara', 12, ['glutine', 'pesce']),
      a('c-antipasti', 'Vitello tonnato', 14, ['uova', 'pesce']),
      a('c-antipasti', 'Carpaccio di manzo', 15, ['latte']),
      a('c-antipasti', 'Crocchetta di baccalà', 12, ['glutine', 'pesce', 'latte']),
      a('c-antipasti', 'Carciofo alla romana', 11),
      a('c-primi', 'Spaghettone cacio e pepe', 16, ['glutine', 'latte'], { variantiIds: ['v-poco-pepe', 'v-senza-glutine'] }),
      a('c-primi', 'Paccheri alla genovese', 17, ['glutine', 'latte', 'sedano'], { variantiIds: ['v-senza-pecorino', 'v-burrata', 'v-senza-glutine'] }),
      a('c-primi', 'Linguine ai frutti di mare', 22, ['glutine', 'molluschi', 'crostacei']),
      a('c-primi', 'Risotto al limone', 18, ['latte'], { esaurito: true }),
      a('c-secondi', 'Polpo, crema di zucca', 22, ['molluschi']),
      a('c-secondi', 'Tagliata di manzo', 24, [], { variantiIds: ['v-al-sangue', 'v-media', 'v-ben-cotta'] }),
      a('c-dessert', 'Tiramisù', 8, ['glutine', 'uova', 'latte']),
      a('c-dessert', 'Profiterole al cioccolato caldo', 9, ['glutine', 'uova', 'latte']),
      a('c-cocktail', 'Espresso Martini caramellato', 12, [], { aliquotaIvaId: 'iva10' }),
      a('c-cocktail', 'Moorea Punch', 11),
      a('c-cocktail', 'Moorea Lemon', 11),
      a('c-vini', 'Ripasso Valpolicella', 37, ['solfiti']),
      a('c-vini', 'Primitivo Desire', 32, ['solfiti']),
      a('c-bibite', 'Acqua naturale 0,75', 3),
      a('c-bibite', 'Acqua frizzante 0,75', 3),
    ],
    varianti: [
      { id: 'v-poco-pepe', gruppo: 'Note', nome: 'poco pepe', deltaCents: 0 },
      { id: 'v-senza-glutine', gruppo: 'Senza', nome: 'pasta senza glutine', deltaCents: 200 },
      { id: 'v-senza-pecorino', gruppo: 'Senza', nome: '- pecorino', deltaCents: 0 },
      { id: 'v-burrata', gruppo: 'Aggiunte', nome: '+ burrata', deltaCents: 300 },
      { id: 'v-al-sangue', gruppo: 'Cottura', nome: 'al sangue', deltaCents: 0 },
      { id: 'v-media', gruppo: 'Cottura', nome: 'media', deltaCents: 0 },
      { id: 'v-ben-cotta', gruppo: 'Cottura', nome: 'ben cotta', deltaCents: 0 },
    ],
    operatori: [
      { id: 'op-aldo', nome: 'Aldo', pin: '1111', ruolo: 'cameriere' },
      { id: 'op-luca', nome: 'Luca', pin: '2222', ruolo: 'cameriere' },
      { id: 'op-benny', nome: 'Benny', pin: '9999', ruolo: 'responsabile' },
    ],
  };
}

/** Prenotazioni di esempio per la demo, come se arrivassero da Table Flow (orari relativi ad adesso). */
export function prenotazioniDemo(ora = new Date()): import('./types').Prenotazione[] {
  const tra = (min: number) => new Date(ora.getTime() + min * 60000).toISOString();
  const p = (id: string, nome: string, coperti: number, min: number, tavoloId: string | null, tavoliExt: string[], extra: Partial<import('./types').Prenotazione> = {}) => ({
    id, nome, coperti, inizio: tra(min), fine: tra(min + 105), stato: 'confermata' as const, fonte: 'web', allergeni: [], tag: [], tavoloId, tavoliExt, ...extra,
  });
  return [
    p('pr-esposito', 'Esposito', 6, -20, 't12', ['12'], { fonte: 'thefork', telefono: '333 111 2222' }),
    p('pr-rossi', 'Rossi', 4, 30, 't5', ['5'], { allergeni: ['glutine'], tag: ['celiaco', 'compleanno'], note: 'Torta portata da loro' }),
    p('pr-bianchi', 'Bianchi', 2, 75, null, [], { fonte: 'telefono', stato: 'richiesta' }),
    p('pr-gruppo', 'Gruppo Amalfi', 12, 120, 't10', ['10'], { note: 'Menu gruppo 25 €', tag: ['vip'] }),
  ];
}

// ---------------------------------------------------------------------------
// Demo con il menu vero del Moorea (mooreafoodclub.it/menu, vedi scripts/importa-menu.py)
// e la sala di Table Flow: Sala Matine 1–12, Sala Giardini 14–23, Sala Mare 24–31.

export type MenuCompatto = {
  coperto: number | null;
  categorie: [string, string, string, number][];
  articoli: [number, string, number, string[], string | null][];
  varianti: [string, string, number, string[]][];
};

export function seedDemo(menu: MenuCompatto = menuMoorea as unknown as MenuCompatto): Setup {
  const base = seedMoorea();
  const articoli: Articolo[] = menu.articoli.map(([cat, nome, prezzo, allergeni, descrizione], i) => ({
    id: `a${i}`, categoriaId: `c${cat}`, nome, prezzoCents: prezzo, aliquotaIvaId: 'iva10',
    allergeni: allergeni as Articolo['allergeni'], esaurito: false, variantiIds: [], descrizione: descrizione ?? undefined,
  }));
  const varianti: Variante[] = menu.varianti.map(([gruppo, nome, delta, sui], k) => {
    for (const a of articoli) if (sui.includes(a.nome)) a.variantiIds.push(`v${k}`);
    return { id: `v${k}`, gruppo, nome, deltaCents: delta };
  });
  const posto = (n: number) => (n <= 12 ? ['sala-matine', (n - 1) % 6, Math.floor((n - 1) / 6)] : n <= 23 ? ['sala-giardini', (n - 14) % 5, Math.floor((n - 14) / 5)] : ['sala-mare', (n - 24) % 4, Math.floor((n - 24) / 4)]) as [string, number, number];
  const numeri = [...Array.from({ length: 12 }, (_, i) => i + 1), ...Array.from({ length: 18 }, (_, i) => i + 14)];
  return {
    ...base,
    locale: { ...base.locale, copertoCents: menu.coperto ?? 200 },
    sale: [{ id: 'sala-matine', nome: 'Sala Matine', ordine: 1 }, { id: 'sala-giardini', nome: 'Sala Giardini', ordine: 2 }, { id: 'sala-mare', nome: 'Sala Mare', ordine: 3 }],
    tavoli: numeri.map((n) => { const [sala, x, y] = posto(n); return t(`t${n}`, sala, String(n), 'quadrato', x, y, 1, 1, n === 24 || n === 31 ? 4 : 2); }),
    categorie: menu.categorie.map(([nome, colore, reparto, uscita], i) => ({
      id: `c${i}`, nome, colore, testoColore: testoSu(colore), ordine: i + 1, centroProduzioneId: reparto === 'bar' ? 'cp-bar' : 'cp-cucina', portataPredefinita: uscita,
    })),
    articoli,
    varianti,
  };
}
