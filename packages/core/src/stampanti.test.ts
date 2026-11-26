import { describe, it, expect } from 'vitest';
import { codificaTesto, profiloDa, soloStampanti, ticketProva, anteprima, byteProvaCaratteri, xmlStampaNonFiscale, renderEscPos } from './index';

describe('Stampanti', () => {
  it('set di caratteri: accenti ed euro', () => {
    expect(codificaTesto('à€', 19)).toEqual([0x85, 0xd5]);
    expect(codificaTesto('à€', 2)).toEqual([0x85, 0x45, 0x55, 0x52]);
    expect(codificaTesto('à€', 16)).toEqual([0xe0, 0x80]);
    expect(codificaTesto('È', 0)).toEqual([0x45]); // PC437 non ha È: resta la E
  });

  it('il set scelto arriva nei byte della comanda', () => {
    const b = Array.from(renderEscPos({ titolo: 't', righe: [{ k: 'testo', testo: 'caffè' }], taglio: false }, { colonne: 48, codePage: 16 }));
    expect(b.slice(2, 5)).toEqual([0x1b, 0x74, 16]);
    expect(b).toContain(0xe8);
  });

  it('profilo dalla ricerca in rete', () => {
    expect(profiloDa({ ip: '192.168.1.50', porta: 9100, genere: 'escpos', marca: 'EPSON', modello: 'TM-T20III' }))
      .toMatchObject({ tipo: 'comande_escpos', porta: 9100, colonne: 48, descrizione: 'Stampante comande EPSON TM-T20III', supportata: true });
    expect(profiloDa({ ip: '192.168.1.51', porta: 9100, genere: 'porta9100', modello: 'POS-58' })?.colonne).toBe(32);
    expect(profiloDa({ ip: '192.168.1.60', porta: 80, genere: 'epson_rt', marca: 'EPSON', modello: 'FP-81' }))
      .toMatchObject({ tipo: 'rt_epson_xml', porta: 80, supportata: true });
    expect(profiloDa({ ip: '192.168.1.61', porta: 80, genere: 'rch_rt' })?.supportata).toBe(false);
    expect(profiloDa({ ip: '192.168.1.1', porta: 80, genere: 'web', dettaglio: 'Router' })).toBeNull();
    expect(soloStampanti([
      { ip: '192.168.1.1', porta: 80, genere: 'web' },
      { ip: '192.168.1.50', porta: 9100, genere: 'escpos' },
    ]).map((t) => t.ip)).toEqual(['192.168.1.50']);
  });

  it('prova stampa: righello largo quanto la carta', () => {
    const r = anteprima(ticketProva({ nome: 'Cucina', host: '192.168.1.50', porta: 9100, colonne: 32, reparti: ['Cucina'] }), 32);
    expect(r.some((x) => x.testo === '12345678901234567890123456789012')).toBe(true);
    expect(r.every((x) => [...x.testo].length <= 32)).toBe(true);
  });

  it('prova caratteri: una riga per ogni set, poi taglio', () => {
    const b = Array.from(byteProvaCaratteri(48));
    for (const n of [19, 2, 16, 0]) expect(b.join(',')).toContain(`27,116,${n}`);
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('RT: prova non fiscale', () => {
    const x = xmlStampaNonFiscale(['Prova Cassa RT', 'àè & co']);
    expect(x).toContain('<beginNonFiscal operator="1" />');
    expect(x).toContain('data="ae &amp; co"');
    expect(x).not.toContain('printRecItem');
  });
});
