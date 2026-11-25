import { describe, it, expect } from 'vitest';
import {
  euro, dividiAllaRomana, parseEuro, calcolaConto, aCapo, coppia, codificaTesto, renderEscPos, anteprima,
  xmlDocumentoCommerciale, xmlAnnulloReso, leggiRispostaEpson, descrizioneRt,
  seedMoorea, FakeDataLayer, CodaStampa, TrasportoSimulato, ErroreDominio,
} from './index';

const flush = () => new Promise((r) => setTimeout(r, 0));
const OP = { id: 'op-aldo', nome: 'Aldo', ruolo: 'cameriere' };

describe('soldi', () => {
  it('formatta in italiano', () => {
    expect(euro(123450)).toBe('€ 1.234,50');
    expect(euro(5, false)).toBe('0,05');
    expect(euro(-550)).toBe('−€ 5,50');
  });
  it('alla romana: i centesimi in più vanno sull’ultima quota', () => {
    expect(dividiAllaRomana(10000, 3)).toEqual([3333, 3333, 3334]);
    expect(dividiAllaRomana(14250, 5)).toEqual([2850, 2850, 2850, 2850, 2850]);
    expect(() => dividiAllaRomana(100, 0)).toThrow();
  });
  it('legge gli importi digitati', () => {
    expect(parseEuro('28,50')).toBe(2850);
    expect(parseEuro('€ 1.000')).toBe(100000);
    expect(() => parseEuro('abc')).toThrow();
  });
});

describe('ticket ESC/POS', () => {
  it('manda a capo e allinea gli importi', () => {
    expect(aCapo('Spaghettone cacio e pepe con burrata', 20)).toEqual(['Spaghettone cacio e', 'pepe con burrata']);
    expect(coppia('Vitello tonnato', '14,00', 30)).toHaveLength(30);
  });
  it('codifica le accentate in PC858 e l’euro', () => {
    expect(codificaTesto('Tiramisù €')).toEqual([...'Tiramis'].map((c) => c.charCodeAt(0)).concat(0x97, 0x20, 0xd5));
    expect(codificaTesto('€', false)).toEqual([0x45, 0x55, 0x52]);
    expect(codificaTesto('2 × caffè')).toEqual([...'2 x caff'].map((c) => c.charCodeAt(0)).concat(0x8a));
  });
  it('inizia con init e finisce con il taglio', () => {
    const b = renderEscPos({ titolo: 't', righe: [{ k: 'testo', testo: 'ciao' }], taglio: true }, { colonne: 48 });
    expect([...b.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...b.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
});

describe('Epson XML', () => {
  const righe = [
    { descrizione: 'Spaghettone cacio e pepe', quantita: 2, prezzoUnitarioCents: 1600, repartoRt: 1 },
    { descrizione: 'Coperto', quantita: 4, prezzoUnitarioCents: 200, repartoRt: 1 },
  ];
  it('costruisce il documento commerciale con resto sui contanti', () => {
    const x = xmlDocumentoCommerciale({ righe, pagamenti: [{ tipo: 'contanti', importoCents: 5000 }] }, { host: 'rt' });
    expect(x).toContain('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">');
    expect(x).toContain('<printRecItem operator="1" description="Spaghettone cacio e pepe" quantity="2" unitPrice="16,00" department="1" justification="1" />');
    expect(x).toContain('payment="50,00" paymentType="0" index="0"');
    expect(x.indexOf('beginFiscalReceipt')).toBeLessThan(x.indexOf('endFiscalReceipt'));
  });
  it('carta = pagamento elettronico (conta per l’incrocio POS-RT)', () => {
    const x = xmlDocumentoCommerciale({ righe, pagamenti: [{ tipo: 'carta', importoCents: 4000 }] }, { host: 'rt' });
    expect(x).toContain('paymentType="2"');
  });
  it('rifiuta pagamenti incompleti e resto su carta', () => {
    expect(() => xmlDocumentoCommerciale({ righe, pagamenti: [{ tipo: 'contanti', importoCents: 100 }] }, { host: 'rt' })).toThrow(/incompleto/);
    expect(() => xmlDocumentoCommerciale({ righe, pagamenti: [{ tipo: 'carta', importoCents: 9000 }] }, { host: 'rt' })).toThrow(/resto/);
  });
  it('descrizioni al massimo 38 caratteri, senza accenti', () => {
    expect(descrizioneRt('Profiterole al cioccolato caldo con panna montata')).toHaveLength(38);
    expect(descrizioneRt('Tiramisù')).toBe('Tiramisu');
  });
  it('annullo con riferimento al documento originale', () => {
    const x = xmlAnnulloReso('VOID', { zNumero: 41, docNumero: 7, data: new Date(2026, 10, 25), matricola: '99MEX012345' }, { righe, pagamenti: [{ tipo: 'contanti', importoCents: 4000 }] }, { host: 'rt' });
    expect(x).toContain('message="VOID 0041 0007 25112026 99MEX012345"');
  });
  it('legge la risposta', () => {
    const r = leggiRispostaEpson('<response success="true" code="" status="2"><addInfo><fiscalReceiptNumber>12</fiscalReceiptNumber><zRepNumber>41</zRepNumber><fiscalReceiptDate>25/11/2026</fiscalReceiptDate></addInfo></response>');
    expect(r).toMatchObject({ ok: true, numeroDocumento: 12, zNumero: 41, data: '25/11/2026' });
    expect(leggiRispostaEpson('<response success="false" code="EPTR_REC_EMPTY" status="0"></response>').ok).toBe(false);
  });
});

describe('servizio completo (fetta verticale)', () => {
  const nuovo = () => {
    const db = new FakeDataLayer(seedMoorea());
    const tr = new TrasportoSimulato();
    const coda = new CodaStampa(db, tr);
    return { db, tr, coda };
  };

  it('tavolo → comanda → cucina e bar → scontrino → tavolo libero', async () => {
    const { db, tr, coda } = nuovo();
    const c = await db.apriTavolo('t7', 4, OP);
    await db.impostaAllergeni(c.id, [{ allergene: 'frutta_a_guscio', posto: 2 }]);
    const s = db.setup();
    const id = (nome: string) => s.articoli.find((a) => a.nome === nome)!.id;
    await db.aggiungiRiga(c.id, { articoloId: id('Vitello tonnato') });
    await db.aggiungiRiga(c.id, { articoloId: id('Paccheri alla genovese'), varianti: [{ nome: '- pecorino', deltaCents: 0 }], note: 'niente noci', posto: 2 });
    await db.aggiungiRiga(c.id, { articoloId: id('Primitivo Desire') });

    const jobs = await db.invia(c.id, 'k-invio-1');
    expect(jobs.map((j) => j.stampanteId).sort()).toEqual(['st-bar', 'st-cucina']);
    // doppio tap: stessa chiave, nessun lavoro in più
    expect(await db.invia(c.id, 'k-invio-1')).toBe(jobs);
    expect(db.lavori()).toHaveLength(2);

    const cucina = anteprima(jobs.find((j) => j.stampanteId === 'st-cucina')!.ticket!, 48).map((r) => r.testo);
    expect(cucina).toContain('TAVOLO 7');
    expect(cucina.some((l) => l.includes('ALLERGIA FRUTTA A GUSCIO'))).toBe(true);
    expect(cucina.some((l) => l.includes('* niente noci'))).toBe(true);
    expect(cucina.some((l) => l.includes('Primitivo'))).toBe(false);   // il vino va al bar
    expect(cucina.some((l) => l.includes('contiene'))).toBe(false);    // nessun piatto con frutta a guscio: niente rumore

    await coda.elabora();
    expect(tr.carta.filter((p) => p.dati)).toHaveLength(2);

    const conto = calcolaConto(db.righe(c.id), 4, 200);
    expect(conto.totaleCents).toBe(1400 + 1700 + 3200 + 800);
    const documento = await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: 8000 }] }, 'k-incasso-1');
    expect(documento.totaleCents).toBe(7100);
    await coda.elabora();
    await flush();
    expect(db.documenti(c.id)[0]).toMatchObject({ stato: 'emesso', rtZNumero: 41, rtDocNumero: 1 });
    expect(db.comanda(c.id)!.stato).toBe('chiusa');
    expect(db.comandaDelTavolo('t7')).toBeUndefined();
  });

  it('non si apre due volte lo stesso tavolo', async () => {
    const { db } = nuovo();
    await db.apriTavolo('t1', 2, OP);
    await expect(db.apriTavolo('t1', 2, OP)).rejects.toThrow(ErroreDominio);
  });

  it('articolo esaurito non si vende', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t1', 2, OP);
    const risotto = db.setup().articoli.find((a) => a.esaurito)!;
    await expect(db.aggiungiRiga(c.id, { articoloId: risotto.id })).rejects.toThrow(/esaurito/);
  });

  it('stampante cucina offline: il lavoro va in errore e riparte', async () => {
    const { db, tr, coda } = nuovo();
    const c = await db.apriTavolo('t2', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: db.setup().articoli[0].id });
    await db.invia(c.id, 'k1');
    tr.guasti['192.168.1.101'] = 'offline';
    await coda.elabora();
    expect(db.lavori()[0]).toMatchObject({ stato: 'errore' });
    expect(db.lavori()[0].errore).toContain('Cucina');
    delete tr.guasti['192.168.1.101'];
    await coda.elabora();
    expect(db.lavori()[0].stato).toBe('stampato');
  });

  it('risposta Epson persa: scontrino "da verificare", nessuna ristampa automatica', async () => {
    const { db, tr, coda } = nuovo();
    const c = await db.apriTavolo('t3', 1, OP);
    await db.aggiungiRiga(c.id, { articoloId: db.setup().articoli[0].id });
    await db.invia(c.id, 'k1');
    await coda.elabora();
    tr.guasti['192.168.1.110'] = 'incerto';
    await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: 1100 }] }, 'k2');
    await coda.elabora();
    expect(db.documenti(c.id)[0].stato).toBe('da_verificare');
    delete tr.guasti['192.168.1.110'];
    await coda.elabora();
    expect(tr.carta.filter((p) => p.xml)).toHaveLength(0);           // non ha riprovato da solo
    await expect(db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: 1100 }] }, 'k3')).rejects.toThrow(/verificare/);
  });

  it('alla romana: 5 scontrini, il tavolo si chiude all’ultimo', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t4', 5, OP);
    const s = db.setup();
    for (const nome of ['Vitello tonnato', 'Vitello tonnato', 'Spaghettone cacio e pepe', 'Ripasso Valpolicella'])
      await db.aggiungiRiga(c.id, { articoloId: s.articoli.find((a) => a.nome === nome)!.id });
    await db.invia(c.id, 'k1'); await coda.elabora();
    const totale = calcolaConto(db.righe(c.id), 5, 200).totaleCents;   // 14+14+16+37+10 = 91,00
    const quote = dividiAllaRomana(totale, 5);
    for (let i = 1; i <= 5; i++) {
      expect(db.comanda(c.id)!.stato).not.toBe('chiusa');
      await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: quote[i - 1] }], quota: { indice: i, di: 5 } }, `q${i}`);
      await coda.elabora();
    }
    const docs = db.documenti(c.id);
    expect(docs.reduce((s, d) => s + d.totaleCents, 0)).toBe(totale);
    expect(db.comanda(c.id)!.stato).toBe('chiusa');
  });

  it('piatto con un allergene del tavolo: avviso in negativo sulla riga', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t8', 2, OP);
    await db.impostaAllergeni(c.id, [{ allergene: 'glutine' }]);
    await db.aggiungiRiga(c.id, { articoloId: db.setup().articoli.find((a) => a.nome === 'Tiramisù')!.id });
    const [job] = await db.invia(c.id, 'k1');
    const righe = anteprima(job.ticket!, 48);
    const avviso = righe.find((r) => r.testo.includes('!! CONTIENE GLUTINE !!'));
    expect(avviso?.stile.inverso).toBe(true);
  });

  it('storno di una riga già inviata stampa STORNO in cucina', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t5', 2, OP);
    const r = await db.aggiungiRiga(c.id, { articoloId: db.setup().articoli[0].id });
    await db.invia(c.id, 'k1'); await coda.elabora();
    await expect(db.togliRiga(r.id)).rejects.toThrow(/stornata/);
    await db.storna(r.id, 'errore cameriere', 'k2');
    const job = db.lavori().at(-1)!;
    expect(anteprima(job.ticket!, 48).map((x) => x.testo)).toContain('*** STORNO ***');
    expect(calcolaConto(db.righe(c.id), 2, 200).subtotaleCents).toBe(0);
  });
});
