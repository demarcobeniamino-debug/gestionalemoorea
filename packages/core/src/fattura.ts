// Fattura elettronica (FatturaPA, formato FPR12 tra privati) da uno scontrino o da un conto.
// I prezzi del ristorante sono IVA inclusa: qui si scorpora l'imponibile per aliquota,
// in modo che righe e riepiloghi tornino al centesimo con il totale pagato.
import type { AliquotaIva, Cents, Cliente, DatiFiscali, RigaDocumento } from './types';
import { nomeCliente } from './types';
import { ErroreDominio } from './operazioni';

export interface LineaFattura { descrizione: string; quantita: number; prezzoUnitarioCents: Cents; totaleCents: Cents; aliquota: number; natura?: string }
export interface RiepilogoIva { aliquota: number; natura?: string; imponibileCents: Cents; impostaCents: Cents }
export interface CalcoloFattura { linee: LineaFattura[]; riepilogo: RiepilogoIva[]; imponibileCents: Cents; ivaCents: Cents; totaleCents: Cents }

/** Scorpora l'IVA: righe lorde (IVA inclusa) → linee nette e riepilogo per aliquota. Lo sconto si ripartisce in proporzione. */
export function calcolaFattura(righe: RigaDocumento[], scontoCents: Cents, aliquote: AliquotaIva[]): CalcoloFattura {
  const aliq = (rep: number) => {
    const a = aliquote.find((x) => x.repartoRt === rep);
    if (!a) throw new ErroreDominio(`Reparto IVA ${rep} senza aliquota`);
    return a;
  };
  const lordoTot = righe.reduce((s, r) => s + Math.round(r.prezzoUnitarioCents * r.quantita), 0);
  if (lordoTot <= 0) throw new ErroreDominio('Niente da fatturare');
  const perAliq = new Map<number, { a: AliquotaIva; righe: RigaDocumento[]; lordo: number }>();
  for (const r of righe) {
    const a = aliq(r.repartoRt);
    const g = perAliq.get(a.percentuale) ?? { a, righe: [], lordo: 0 };
    g.righe.push(r); g.lordo += Math.round(r.prezzoUnitarioCents * r.quantita);
    perAliq.set(a.percentuale, g);
  }
  const gruppi = [...perAliq.values()].sort((x, y) => y.lordo - x.lordo);
  // Sconto ripartito per aliquota (i centesimi di arrotondamento sul gruppo più grande).
  let scontoAssegnato = 0;
  const sconti = gruppi.map((g, i) => {
    const s = i === gruppi.length - 1 ? scontoCents - scontoAssegnato : Math.round((scontoCents * g.lordo) / lordoTot);
    scontoAssegnato += s; return s;
  });

  const linee: LineaFattura[] = [];
  const riepilogo: RiepilogoIva[] = [];
  gruppi.forEach((g, gi) => {
    const p = g.a.percentuale;
    const lordoNetto = g.lordo - sconti[gi];
    const imponibile = Math.round((lordoNetto * 100) / (100 + p));
    // Linee nette; l'ultima assorbe l'arrotondamento così la somma = imponibile del gruppo.
    const voci = [...g.righe.map((r) => ({ descrizione: r.descrizione, quantita: r.quantita, lordo: Math.round(r.prezzoUnitarioCents * r.quantita) })),
      ...(sconti[gi] ? [{ descrizione: 'Sconto', quantita: 1, lordo: -sconti[gi] }] : [])];
    let assegnato = 0;
    voci.forEach((v, i) => {
      const netto = i === voci.length - 1 ? imponibile - assegnato : Math.round((v.lordo * 100) / (100 + p));
      assegnato += netto;
      linee.push({
        descrizione: v.descrizione, quantita: v.quantita, totaleCents: netto, aliquota: p,
        prezzoUnitarioCents: v.quantita ? Math.round(netto / v.quantita) : netto,
        natura: p === 0 ? 'N4' : undefined,
      });
    });
    riepilogo.push({ aliquota: p, natura: p === 0 ? 'N4' : undefined, imponibileCents: imponibile, impostaCents: lordoNetto - imponibile });
  });
  const imponibileCents = riepilogo.reduce((s, r) => s + r.imponibileCents, 0);
  const ivaCents = riepilogo.reduce((s, r) => s + r.impostaCents, 0);
  return { linee, riepilogo, imponibileCents, ivaCents, totaleCents: imponibileCents + ivaCents };
}

/** Cosa manca per fatturare a questo cliente (vuoto = si può). */
export function controllaIntestatario(c: Cliente): string[] {
  const m: string[] = [];
  if (!c.piva && !c.codiceFiscale) m.push('partita IVA o codice fiscale');
  if (c.piva && !c.ragioneSociale && !c.cognome) m.push('ragione sociale');
  if (!c.piva && !c.cognome) m.push('cognome');
  if (c.piva && !/^\d{11}$/.test(c.piva.replace(/\s/g, ''))) m.push('partita IVA valida (11 cifre)');
  if (c.codiceFiscale && !/^([A-Z0-9]{16}|\d{11})$/i.test(c.codiceFiscale.replace(/\s/g, ''))) m.push('codice fiscale valido');
  if (c.codiceSdi && !/^[A-Z0-9]{7}$/i.test(c.codiceSdi.trim())) m.push('codice destinatario di 7 caratteri');
  const i = c.indirizzoFiscale;
  if (!i?.via || !i.cap || !i.comune) m.push('indirizzo (via, CAP, comune)');
  if (i?.cap && (i.nazione ?? 'IT') === 'IT' && !/^\d{5}$/.test(i.cap)) m.push('CAP di 5 cifre');
  return m;
}

export function controllaCedente(d?: Partial<DatiFiscali>): string[] {
  const m: string[] = [];
  if (!d?.ragioneSociale || /da completare/i.test(d.ragioneSociale)) m.push('ragione sociale del locale');
  if (!d?.piva || !/^\d{11}$/.test(d.piva)) m.push('partita IVA del locale');
  if (!d?.via || !d.cap || !d.comune || !d.provincia) m.push('indirizzo del locale');
  return m;
}

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** Testo ammesso da FatturaPA (Latin-1 di base), tagliato alla lunghezza massima. */
const t = (s: string, max: number) => x([...s.normalize('NFC')].filter((c) => c.charCodeAt(0) <= 0xff).join('').trim().slice(0, max));
const eur = (c: Cents) => (c / 100).toFixed(2);
const qta = (q: number) => q.toFixed(2);

export interface DatiXmlFattura {
  cedente: DatiFiscali; cliente: Cliente; data: string; calcolo: CalcoloFattura;
  /** Progressivo d'invio (5 caratteri alfanumerici, univoco per il trasmittente). */
  progressivo: string;
  /** Riferimento allo scontrino già emesso, va nella causale. */
  riferimento?: string;
  pagamento?: 'MP01' | 'MP08' | 'MP05';
}

/** XML FatturaPA 1.2 (FPR12). Il numero si mette come "__NUMERO__": lo assegna il server. */
export function xmlFattura(d: DatiXmlFattura): string {
  const c = d.cliente, ced = d.cedente, ind = c.indirizzoFiscale!;
  const nazione = (ind.nazione || 'IT').toUpperCase();
  const codDest = c.codiceSdi?.trim().toUpperCase() || (nazione === 'IT' ? '0000000' : 'XXXXXXX');
  const anagrafica = c.ragioneSociale
    ? `<Denominazione>${t(c.ragioneSociale, 80)}</Denominazione>`
    : `<Nome>${t(c.nome, 60)}</Nome><Cognome>${t(c.cognome ?? '', 60)}</Cognome>`;
  const linee = d.calcolo.linee.map((l, i) => `
      <DettaglioLinee>
        <NumeroLinea>${i + 1}</NumeroLinea>
        <Descrizione>${t(l.descrizione, 1000)}</Descrizione>
        <Quantita>${qta(l.quantita)}</Quantita>
        <PrezzoUnitario>${eur(l.prezzoUnitarioCents)}</PrezzoUnitario>
        <PrezzoTotale>${eur(l.totaleCents)}</PrezzoTotale>
        <AliquotaIVA>${l.aliquota.toFixed(2)}</AliquotaIVA>${l.natura ? `\n        <Natura>${l.natura}</Natura>` : ''}
      </DettaglioLinee>`).join('');
  const riep = d.calcolo.riepilogo.map((r) => `
      <DatiRiepilogo>
        <AliquotaIVA>${r.aliquota.toFixed(2)}</AliquotaIVA>${r.natura ? `\n        <Natura>${r.natura}</Natura>` : ''}
        <ImponibileImporto>${eur(r.imponibileCents)}</ImponibileImporto>
        <Imposta>${eur(r.impostaCents)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${ced.codiceFiscale || ced.piva}</IdCodice></IdTrasmittente>
      <ProgressivoInvio>${t(d.progressivo, 10)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${codDest}</CodiceDestinatario>${c.pec && !c.codiceSdi ? `\n      <PECDestinatario>${t(c.pec, 256)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${ced.piva}</IdCodice></IdFiscaleIVA>${ced.codiceFiscale ? `\n        <CodiceFiscale>${t(ced.codiceFiscale, 16)}</CodiceFiscale>` : ''}
        <Anagrafica><Denominazione>${t(ced.ragioneSociale, 80)}</Denominazione></Anagrafica>
        <RegimeFiscale>${ced.regime || 'RF01'}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${t(ced.via, 60)}</Indirizzo>${ced.civico ? `\n        <NumeroCivico>${t(ced.civico, 8)}</NumeroCivico>` : ''}
        <CAP>${ced.cap}</CAP>
        <Comune>${t(ced.comune, 60)}</Comune>
        <Provincia>${ced.provincia.toUpperCase()}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>${ced.rea?.numero ? `
      <IscrizioneREA>
        <Ufficio>${ced.rea.ufficio.toUpperCase()}</Ufficio>
        <NumeroREA>${t(ced.rea.numero, 20)}</NumeroREA>
        <StatoLiquidazione>LN</StatoLiquidazione>
      </IscrizioneREA>` : ''}
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${c.piva ? `
        <IdFiscaleIVA><IdPaese>${nazione}</IdPaese><IdCodice>${c.piva.replace(/\s/g, '')}</IdCodice></IdFiscaleIVA>` : ''}${c.codiceFiscale ? `
        <CodiceFiscale>${c.codiceFiscale.replace(/\s/g, '').toUpperCase()}</CodiceFiscale>` : ''}
        <Anagrafica>${anagrafica}</Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${t(ind.via, 60)}</Indirizzo>${ind.civico ? `\n        <NumeroCivico>${t(ind.civico, 8)}</NumeroCivico>` : ''}
        <CAP>${nazione === 'IT' ? ind.cap : '00000'}</CAP>
        <Comune>${t(ind.comune, 60)}</Comune>${ind.provincia && nazione === 'IT' ? `\n        <Provincia>${ind.provincia.toUpperCase()}</Provincia>` : ''}
        <Nazione>${nazione}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${d.data}</Data>
        <Numero>__NUMERO__</Numero>
        <ImportoTotaleDocumento>${eur(d.calcolo.totaleCents)}</ImportoTotaleDocumento>
        <Causale>${t(`Servizio di ristorazione${d.riferimento ? ` - ${d.riferimento}` : ''}`, 200)}</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>${linee}${riep}
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${d.pagamento ?? 'MP08'}</ModalitaPagamento>
        <ImportoPagamento>${eur(d.calcolo.totaleCents)}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;
}

/** Nome file SDI: IT + identificativo del trasmittente + "_" + progressivo. */
export const nomeFileFattura = (ced: DatiFiscali, progressivo: string) => `IT${ced.codiceFiscale || ced.piva}_${progressivo}.xml`;

/** Progressivo d'invio: 5 caratteri alfanumerici casuali (60 milioni di combinazioni), scelto prima che il server dia il numero. */
export const progressivoInvio = (casuale: () => number = Math.random) =>
  Array.from({ length: 5 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(casuale() * 36)]).join('');

export { nomeCliente };
