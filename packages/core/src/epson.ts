// Epson RT (FP-81 II RT / FP-90 III RT): Fiscal ePOS-Print XML via fpmate.cgi.
// Sintassi dalla "ePOS Fiscal Print Solution Development Guide" (Epson, pubblica).
// Punti da confermare al collaudo sul registratore del Moorea sono marcati COLLAUDO.

import type { Cents, Pagamento, RigaDocumento } from './types';
import { PAGAMENTO_RT } from './types';

export interface OpzioniEpson {
  host: string;
  /** COLLAUDO: separatore decimale accettato dal firmware ("," o "."). */
  decimale?: ',' | '.';
  operatore?: string;
  timeoutMs?: number;
}

export const urlFpMate = (o: OpzioniEpson) =>
  `http://${o.host}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=${o.timeoutMs ?? 10000}`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** La descrizione sul documento commerciale è al massimo 38 caratteri. */
export const descrizioneRt = (s: string) => {
  const pulita = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  return pulita.length <= 38 ? pulita : pulita.slice(0, 37) + '.';
};

const imp = (c: Cents, dec: string) => (c / 100).toFixed(2).replace('.', dec);
const qta = (q: number, dec: string) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace('.', dec));

const busta = (corpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">\n<s:Body>\n${corpo}\n</s:Body>\n</s:Envelope>`;

/** paymentType / index secondo la tabella del manuale. COLLAUDO: index carta (1–10) secondo la programmazione dell'RT. */
export function mezzoPagamento(p: Pagamento): { paymentType: number; index: number; descrizione: string } {
  switch (PAGAMENTO_RT[p.tipo]) {
    case 'contanti': return { paymentType: 0, index: 0, descrizione: 'CONTANTI' };
    case 'elettronico': return { paymentType: 2, index: 1, descrizione: 'PAGAMENTO ELETTRONICO' };
    case 'ticket': return { paymentType: 3, index: 1, descrizione: 'BUONO PASTO' };
    case 'non_riscosso': return { paymentType: 5, index: p.tipo === 'camera' ? 2 : 0, descrizione: 'NON RISCOSSO' };
  }
}

export interface DocumentoRt {
  righe: RigaDocumento[];
  scontoCents?: Cents;          // sconto sul subtotale
  pagamenti: Pagamento[];
  /** Codice lotteria degli scontrini del cliente (8 caratteri). Va sull'RT prima dei pagamenti. */
  lotteria?: string;
}

/** Codice lotteria: 8 caratteri, lettere maiuscole e cifre (quello che il cliente mostra dall'app). */
export const codiceLotteriaValido = (c: string) => /^[A-Z0-9]{8}$/.test(c.trim().toUpperCase());

export function xmlDocumentoCommerciale(d: DocumentoRt, o: OpzioniEpson): string {
  const dec = o.decimale ?? ',';
  const op = esc(o.operatore ?? '1');
  if (!d.righe.length) throw new Error('Il documento deve avere almeno una riga');
  const totale = d.righe.reduce((s, r) => s + Math.round(r.prezzoUnitarioCents * r.quantita), 0) - (d.scontoCents ?? 0);
  const pagato = d.pagamenti.reduce((s, p) => s + p.importoCents, 0);
  if (totale < 0) throw new Error('Totale negativo');
  if (pagato < totale) throw new Error(`Pagamento incompleto: ${pagato} su ${totale}`);
  const contanti = d.pagamenti.filter((p) => p.tipo === 'contanti').reduce((s, p) => s + p.importoCents, 0);
  if (pagato > totale && contanti < pagato - totale) throw new Error('Il resto si può dare solo sui contanti');

  const l: string[] = ['<printerFiscalReceipt>', `<beginFiscalReceipt operator="${op}" />`];
  for (const r of d.righe) {
    l.push(`<printRecItem operator="${op}" description="${esc(descrizioneRt(r.descrizione))}" quantity="${qta(r.quantita, dec)}" unitPrice="${imp(r.prezzoUnitarioCents, dec)}" department="${r.repartoRt}" justification="1" />`);
  }
  if (d.scontoCents && d.scontoCents > 0) {
    l.push(`<printRecSubtotalAdjustment operator="${op}" adjustmentType="1" description="SCONTO" amount="${imp(d.scontoCents, dec)}" justification="1" />`);
  }
  if (d.lotteria) {
    const codice = d.lotteria.trim().toUpperCase();
    if (!codiceLotteriaValido(codice)) throw new Error('Codice lotteria non valido: 8 lettere o cifre');
    l.push(`<printRecLotteryID operator="${op}" code="${codice}" />`);
  }
  // I pagamenti non in contanti per primi, i contanti per ultimi (così l'RT calcola il resto).
  const ordinati = [...d.pagamenti].sort((a, b) => (a.tipo === 'contanti' ? 1 : 0) - (b.tipo === 'contanti' ? 1 : 0));
  for (const p of ordinati) {
    const m = mezzoPagamento(p);
    const descr = p.descrizione?.startsWith('caparra:') ? 'CAPARRA' : p.descrizione ? descrizioneRt(p.descrizione.toUpperCase()).slice(0, 20) : m.descrizione;
    l.push(`<printRecTotal operator="${op}" description="${esc(descr)}" payment="${imp(p.importoCents, dec)}" paymentType="${m.paymentType}" index="${m.index}" justification="1" />`);
  }
  l.push(`<endFiscalReceipt operator="${op}" />`, '</printerFiscalReceipt>');
  return busta(l.join('\n'));
}

/** Annullo (VOID) o reso (REFUND) di un documento: primo elemento un printRecMessage di tipo 4. */
export function xmlAnnulloReso(
  tipo: 'VOID' | 'REFUND',
  originale: { zNumero: number; docNumero: number; data: Date; matricola: string },
  d: DocumentoRt, o: OpzioniEpson,
): string {
  const dd = String(originale.data.getDate()).padStart(2, '0');
  const mm = String(originale.data.getMonth() + 1).padStart(2, '0');
  const msg = `${tipo} ${String(originale.zNumero).padStart(4, '0')} ${String(originale.docNumero).padStart(4, '0')} ${dd}${mm}${originale.data.getFullYear()} ${originale.matricola}`;
  const base = xmlDocumentoCommerciale(d, o);
  const op = esc(o.operatore ?? '1');
  return base.replace('<printerFiscalReceipt>', `<printerFiscalReceipt>\n<printRecMessage operator="${op}" messageType="4" message="${esc(msg)}" />`);
}

/** La Z può metterci parecchio (stampa e invio all'Agenzia): timeout lungo sia sull'RT sia sulla richiesta. */
export const TIMEOUT_Z_MS = 60000;
export const xmlChiusuraGiornaliera = (o: OpzioniEpson) =>
  busta(`<printerFiscalReport>\n<printZReport operator="${esc(o.operatore ?? '1')}" timeout="${TIMEOUT_Z_MS - 10000}" />\n</printerFiscalReport>`);

export interface RispostaEpson {
  ok: boolean;
  codice: string;
  stato: string;
  numeroDocumento?: number;
  zNumero?: number;
  importo?: string;
  data?: string;
  ora?: string;
}

const campo = (xml: string, nome: string) => {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? m[1].trim() : undefined;
};

export function leggiRispostaEpson(xml: string): RispostaEpson {
  const resp = xml.match(/<response\b([^>]*)>/);
  if (!resp) throw new Error('Risposta Epson non riconosciuta');
  const attr = (n: string) => resp[1].match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? '';
  const num = (s?: string) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : undefined);
  return {
    ok: attr('success') === 'true',
    codice: attr('code'),
    stato: attr('status'),
    numeroDocumento: num(campo(xml, 'fiscalReceiptNumber')),
    zNumero: num(campo(xml, 'zRepNumber')),
    importo: campo(xml, 'fiscalReceiptAmount'),
    data: campo(xml, 'fiscalReceiptDate'),
    ora: campo(xml, 'fiscalReceiptTime'),
  };
}

/** Stampa di prova NON fiscale sull'RT (non crea documenti). COLLAUDO: confermare sul firmware del Moorea. */
export function xmlStampaNonFiscale(righe: string[]): string {
  const r = righe.map((t) => `<printNormal operator="1" font="1" data="${esc(descrizioneRt(t))}" />`).join('\n');
  return busta(`<printerNonFiscal>\n<beginNonFiscal operator="1" />\n${r}\n<endNonFiscal operator="1" />\n</printerNonFiscal>`);
}

/** Apertura del cassetto collegato all'RT (comando non fiscale). COLLAUDO: confermare sul firmware. */
export const xmlApriCassetto = (o: OpzioniEpson) =>
  busta(`<printerCommand>\n<openDrawer operator="${esc(o.operatore ?? '1')}" />\n</printerCommand>`);

// ---------------------------------------------------------------------------------------------
// Interrogazioni (non fiscali, non stampano nulla): stato della stampante, stato RT, data e ora.

/** statusType 0 = stato base (carta, giornale elettronico, cassetto); 1 = stato RT (invii all'Agenzia). */
export const xmlStato = (tipo: 0 | 1) => busta(`<printerCommand>\n<queryPrinterStatus operator="1" statusType="${tipo}" />\n</printerCommand>`);
export const xmlLeggiData = () => busta(`<printerCommand>\n<getDate operator="1" />\n</printerCommand>`);
/** Si può solo a giornata chiusa (dopo la Z, prima del primo scontrino). Niente secondi. */
export const xmlImpostaData = (d: Date) =>
  busta(`<printerCommand>\n<setDate operator="1" day="${d.getDate()}" month="${d.getMonth() + 1}" year="${d.getFullYear()}" hour="${d.getHours()}" minute="${d.getMinutes()}" />\n</printerCommand>`);

export interface StatoRt {
  /** Cifre del codice stato a 5 posizioni (comando 1-074). */
  stampante?: 'ok' | 'carta_in_esaurimento' | 'offline';
  giornale?: 'ok' | 'quasi_pieno' | 'da_formattare' | 'precedente' | 'altro_misuratore' | 'pieno';
  cassettoAperto?: boolean;
  memoriaFiscale?: string;
  firmware?: string;
  giornataAperta?: boolean;
  /** Periodo di inattività: serve una Z prima di emettere. */
  serveZ?: boolean;
  fileDaInviare?: number;
  fileVecchiDaInviare?: number;
  fileRifiutati?: number;
  scadenzaCertificato?: string;   // yyyymmdd
  scadenzaCertificatoAde?: string;
  formazione?: boolean;
  orologio?: string;              // ISO
  letto: string;                  // quando
  /** Lettura non riuscita (registratore spento o fuori rete). */
  errore?: string;
}

const num = (s?: string) => (s && /^-?\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : undefined);

/** Legge la risposta di queryPrinterStatus (tipo 0 o 1) o di getDate e la aggiunge allo stato. */
export function leggiStato(xml: string, prima: StatoRt = { letto: new Date().toISOString() }): StatoRt {
  const r = leggiRispostaEpson(xml);
  if (!r.ok) throw new Error(spiegaErroreEpson(r.codice, r.stato));
  const s: StatoRt = { ...prima };
  const fp = campo(xml, 'fpStatus') ?? campo(xml, 'printerStatus');
  if (fp && /^\d{5}$/.test(fp)) {
    s.stampante = fp[0] === '0' ? 'ok' : fp[0] === '2' ? 'carta_in_esaurimento' : 'offline';
    s.giornale = (['ok', 'quasi_pieno', 'da_formattare', 'precedente', 'altro_misuratore', 'pieno'] as const)[+fp[1]] ?? s.giornale;
    s.cassettoAperto = fp[2] === '0';
  }
  const mf = campo(xml, 'mfStatus'); if (mf) s.memoriaFiscale = mf;
  const cpu = campo(xml, 'cpuRel'); if (cpu) s.firmware = cpu;
  const b = (n: string) => { const v = campo(xml, n); return v === undefined ? undefined : v.trim() === '1'; };
  s.giornataAperta = b('rtDailyOpen') ?? s.giornataAperta;
  s.serveZ = b('rtNoWorkingPeriod') ?? s.serveZ;
  s.fileDaInviare = num(campo(xml, 'rtFileToSend')) ?? s.fileDaInviare;
  s.fileVecchiDaInviare = num(campo(xml, 'rtOldFileToSend')) ?? s.fileVecchiDaInviare;
  s.fileRifiutati = num(campo(xml, 'rtFileRejected')) ?? s.fileRifiutati;
  s.scadenzaCertificato = campo(xml, 'rtExpiryCD') ?? s.scadenzaCertificato;
  s.scadenzaCertificatoAde = campo(xml, 'rtExpiryCA') ?? s.scadenzaCertificatoAde;
  s.formazione = b('rtTrainingMode') ?? s.formazione;
  const g = ['year', 'month', 'day', 'hour', 'minute'].map((n) => num(campo(xml, n)));
  if (g.every((x) => x !== undefined)) {
    const [y, mo, d, h, mi] = g as number[];
    s.orologio = new Date(y < 100 ? 2000 + y : y, mo - 1, d, h, mi).toISOString();
  }
  return s;
}

export interface AvvisoRt { livello: 'errore' | 'attenzione' | 'info'; testo: string }

/** Cosa deve sapere chi sta alla cassa, in italiano semplice. `adesso` per i confronti di orologio e scadenze. */
export function avvisiRt(s: StatoRt, adesso = new Date()): AvvisoRt[] {
  const a: AvvisoRt[] = [];
  if (s.errore) a.push({ livello: 'errore', testo: `Registratore non raggiungibile: ${s.errore}` });
  if (s.stampante === 'offline') a.push({ livello: 'errore', testo: 'Registratore offline: carta finita o coperchio aperto.' });
  if (s.stampante === 'carta_in_esaurimento') a.push({ livello: 'attenzione', testo: 'Carta in esaurimento: tieni pronto un rotolo.' });
  if (s.giornale === 'pieno') a.push({ livello: 'errore', testo: 'Giornale elettronico pieno: chiama l’assistenza Epson.' });
  if (s.giornale === 'quasi_pieno') a.push({ livello: 'attenzione', testo: 'Giornale elettronico quasi pieno: avvisa l’assistenza.' });
  if (s.serveZ) a.push({ livello: 'errore', testo: 'Il registratore chiede la chiusura giornaliera (Z) prima di fare scontrini.' });
  if (s.fileRifiutati) a.push({ livello: 'errore', testo: `${s.fileRifiutati} invii rifiutati dall’Agenzia delle Entrate: vanno controllati con l’assistenza Epson o il commercialista.` });
  if (s.fileVecchiDaInviare) a.push({ livello: 'attenzione', testo: `${s.fileVecchiDaInviare} invii all’Agenzia in ritardo: controlla che il registratore sia collegato a internet.` });
  else if (s.fileDaInviare) a.push({ livello: 'info', testo: `${s.fileDaInviare} invii all’Agenzia in attesa (partono da soli).` });
  if (s.formazione) a.push({ livello: 'errore', testo: 'Registratore in modalità formazione: gli scontrini non hanno valore fiscale.' });
  const scade = (v?: string) => (v && /^\d{8}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) : undefined);
  for (const [v, nome] of [[s.scadenzaCertificato, 'certificato del registratore'], [s.scadenzaCertificatoAde, 'certificato dell’Agenzia']] as const) {
    const d = scade(v); if (!d) continue;
    const giorni = Math.floor((d.getTime() - adesso.getTime()) / 86400000);
    if (giorni < 0) a.push({ livello: 'errore', testo: `Il ${nome} è scaduto: chiama l’assistenza Epson.` });
    else if (giorni <= 30) a.push({ livello: 'attenzione', testo: `Il ${nome} scade tra ${giorni} giorni (${d.toLocaleDateString('it-IT')}): avvisa l’assistenza.` });
  }
  if (s.orologio) {
    const diff = Math.round((new Date(s.orologio).getTime() - adesso.getTime()) / 60000);
    if (Math.abs(diff) >= 3) a.push({ livello: 'attenzione', testo: `L’orologio del registratore è ${diff > 0 ? 'avanti' : 'indietro'} di ${Math.abs(diff)} minuti. Si corregge dopo la Z (Gestione → Stampanti → Collaudo RT).` });
  }
  return a;
}

/** Errori FPMate che NON escludono che il documento sia uscito: per un fiscale vanno verificati, mai ripetuti. */
export const erroreEpsonIncerto = (codice: string) => ['FP_NO_ANSWER', 'LAN_TIME_OUT', 'TM_NO_ANSWER', 'FP_NO_ANSWER_NETWORK'].includes(codice.trim().toUpperCase().replace(/ /g, '_'));

/** Messaggio leggibile per i codici FPMate (guida "ePOS Fiscal Print", tabella errori). */
export function spiegaErroreEpson(codice: string, stato: string): string {
  const c = codice.trim().toUpperCase().replace(/ /g, '_');
  const m: Record<string, string> = {
    EPTR_REC_EMPTY: 'Carta finita o coperchio aperto: sistema la carta e riprova.',
    FP_NO_ANSWER: 'Il registratore non ha risposto in tempo.',
    FP_NO_ANSWER_NETWORK: 'Il registratore non risponde in rete.',
    LAN_TIME_OUT: 'Il registratore ha smesso di rispondere durante la stampa.',
    LAN_ERROR: 'Il registratore era occupato: niente è stato stampato, riprova.',
    TM_NO_ANSWER: 'La stampante collegata al registratore non risponde.',
    TM_OFF_LINE: 'La stampante collegata al registratore è offline (carta?).',
    PARSER_ERROR: 'Comando non valido per il registratore (errore del programma: avvisa chi lo gestisce).',
    INCOMPLETE_FILE: 'Comando incompleto per il registratore (errore del programma).',
    NON_VALID_XML_COMMAND: 'Comando non riconosciuto da questo registratore (firmware?).',
    NO_DATA: 'Richiesta vuota.',
    NO_RAM: 'Memoria del registratore piena: spegnilo e riaccendilo.',
    EFT_POS_ERROR: 'Errore del POS collegato al registratore.',
    PRINTER_ERROR: `Il registratore ha rifiutato il comando (errore ${stato || '?'}).`,
  };
  const nativi: Record<string, string> = {
    '16': 'Importo zero non accettato.',
    '17': 'Operazione non possibile adesso (giornata, modalità o login del registratore).',
  };
  if (c === 'PRINTER_ERROR' && nativi[stato]) return `Il registratore ha rifiutato il comando: ${nativi[stato]}`;
  return m[c] ?? `Il registratore ha risposto con errore ${codice || '?'} (stato ${stato || '?'}).`;
}
