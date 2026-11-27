import { describe, it, expect } from 'vitest';
import { avvisiRt, leggiStato, spiegaErroreEpson, erroreEpsonIncerto, xmlDocumentoCommerciale, xmlStato, xmlImpostaData, xmlChiusuraGiornaliera, codiceLotteriaValido } from './index';

const risposta = (campi: Record<string, string>, ok = true, code = '', status = '2') =>
  `<?xml version="1.0"?><s:Envelope><s:Body><response success="${ok}" code="${code}" status="${status}"><addInfo><elementList>${Object.keys(campi).join(',')}</elementList>${Object.entries(campi).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</addInfo></response></s:Body></s:Envelope>`;

describe('Epson RT: interrogazioni e avvisi', () => {
  it('stato base e stato RT diventano avvisi chiari', () => {
    let s = leggiStato(risposta({ lastCommand: '74', cpuRel: '04.30', mfRel: '01', mfStatus: 'OK', fpStatus: '21110' }));
    s = leggiStato(risposta({ lastCommand: '138', rtType: 'M', rtMainStatus: '02', rtSubStatus: '08', rtDailyOpen: '1', rtNoWorkingPeriod: '0', rtFileToSend: '3', rtOldFileToSend: '0', rtFileRejected: '18', rtExpiryCD: '20261215', rtExpiryCA: '20300101', rtTrainingMode: '0', rtUpgradeResult: '0' }), s);
    s = leggiStato(risposta({ day: '27', month: '11', year: '2026', hour: '12', minute: '50' }), s);
    expect(s).toMatchObject({ stampante: 'carta_in_esaurimento', giornale: 'quasi_pieno', cassettoAperto: false, giornataAperta: true, serveZ: false, fileDaInviare: 3, fileRifiutati: 18, firmware: '04.30' });
    const a = avvisiRt(s, new Date(2026, 10, 27, 12, 40)).map((x) => x.testo).join('\n');
    expect(a).toMatch(/Carta in esaurimento/);
    expect(a).toMatch(/18 invii rifiutati/);
    expect(a).toMatch(/certificato del registratore scade tra 1[78] giorni/);
    expect(a).toMatch(/avanti di 10 minuti/);
    expect(a).not.toMatch(/Agenzia scade/);
  });

  it('errori: messaggi in italiano, e quelli che non escludono la stampa sono "incerti"', () => {
    expect(spiegaErroreEpson('EPTR_REC_EMPTY', '3')).toMatch(/Carta finita/);
    expect(spiegaErroreEpson('PRINTER ERROR', '17')).toMatch(/non possibile adesso/);
    expect(erroreEpsonIncerto('FP_NO_ANSWER')).toBe(true);
    expect(erroreEpsonIncerto('LAN_ERROR')).toBe(false);
    expect(() => leggiStato(risposta({}, false, 'EPTR_REC_EMPTY', '3'))).toThrow(/Carta finita/);
  });

  it('comandi: stato, data, Z con timeout, lotteria prima dei pagamenti', () => {
    expect(xmlStato(1)).toMatch(/<queryPrinterStatus operator="1" statusType="1" \/>/);
    expect(xmlImpostaData(new Date(2026, 11, 7, 9, 5))).toMatch(/day="7" month="12" year="2026" hour="9" minute="5"/);
    expect(xmlChiusuraGiornaliera({ host: 'rt' })).toMatch(/printZReport operator="1" timeout="50000"/);
    const x = xmlDocumentoCommerciale({ righe: [{ descrizione: 'Polpo', quantita: 1, prezzoUnitarioCents: 2000, repartoRt: 1 }], pagamenti: [{ tipo: 'carta', importoCents: 2000 }], lotteria: 'ab12cd34' }, { host: 'rt' });
    expect(x.indexOf('printRecLotteryID operator="1" code="AB12CD34"')).toBeGreaterThan(0);
    expect(x.indexOf('printRecLotteryID')).toBeLessThan(x.indexOf('printRecTotal'));
    expect(codiceLotteriaValido('AB12CD3')).toBe(false);
    expect(() => xmlDocumentoCommerciale({ righe: [{ descrizione: 'x', quantita: 1, prezzoUnitarioCents: 100, repartoRt: 1 }], pagamenti: [{ tipo: 'carta', importoCents: 100 }], lotteria: 'XX' }, { host: 'rt' })).toThrow(/lotteria/);
  });
});
