import { describe, it, expect } from 'vitest';
import { FakeDataLayer, CodaStampa, TrasportoSimulato, seedDemo, calcolaConto, calcolaFattura, xmlFattura, controllaIntestatario, controllaCedente, anteprima, riepilogo, ponteVivo, esportaCorrispettivi, giornoDiServizio, CassaOffline, datiDaSincronizzare, type Cliente } from './index';

const OP = { id: 'op-aldo', nome: 'Aldo', ruolo: 'cameriere' };
const nuovo = () => { const db = new FakeDataLayer(seedDemo()); return { db, coda: new CodaStampa(db, new TrasportoSimulato()) }; };
const art = (db: FakeDataLayer, nome: string) => db.setup().articoli.find((a) => a.nome === nome)!.id;

describe('Voci libere e quantità', () => {
  it('voce libera: niente articolo, prezzo e reparto scelti al volo, va in cucina', async () => {
    const { db } = nuovo();
    const s = db.setup();
    const c = await db.apriTavolo('t1', 2, OP);
    const cucina = s.centri.find((x) => /cucina/i.test(x.nome))!;
    const iva10 = s.aliquote.find((a) => a.percentuale === 10)!;
    const r = await db.aggiungiRiga(c.id, { libera: { descrizione: 'Pasta al pomodoro', prezzoCents: 1200, centroId: cucina.id, aliquotaIvaId: iva10.id }, portata: 1 });
    expect(r.articoloId).toBeNull();
    expect(s.articoli.some((a) => /pomodoro/i.test(a.nome) && a.prezzoCents === 1200)).toBe(false);
    const jobs = await db.invia(c.id, 'k1', OP);
    expect(jobs).toHaveLength(1);
    expect(anteprima(jobs[0].ticket!, 42).map((x) => x.testo).join('\n')).toMatch(/1 X PASTA AL POMODORO/);
    await expect(db.aggiungiRiga(c.id, { libera: { descrizione: '  ', prezzoCents: 100, centroId: null, aliquotaIvaId: iva10.id } })).rejects.toThrow(/Scrivi/);
  });

  it('lo stesso piatto toccato due volte aumenta la quantità; con una nota diventa una riga nuova', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t1', 2, OP);
    const id = art(db, 'Polpo Scottato');
    await db.aggiungiRiga(c.id, { articoloId: id });
    await db.aggiungiRiga(c.id, { articoloId: id });
    expect(db.righe(c.id)).toHaveLength(1);
    expect(db.righe(c.id)[0].quantita).toBe(2);
    await db.aggiungiRiga(c.id, { articoloId: id, note: 'senza burrata' });
    expect(db.righe(c.id)).toHaveLength(2);
    await db.cambiaQuantita(db.righe(c.id)[0].id, 5);
    expect(calcolaConto(db.righe(c.id), 2, 200).totaleCents).toBe(6 * 2000 + 400);
    await db.cambiaQuantita(db.righe(c.id)[0].id, 0);
    expect(db.righe(c.id)).toHaveLength(1);
  });
});

describe('Messaggi ai reparti', () => {
  it('marcia della 2ª portata: solo ai reparti che hanno piatti di quella portata, con l\'elenco', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t5', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato'), portata: 1 });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Entrecôte alla Griglia'), portata: 2 });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k1', OP);
    await coda.elabora();
    const tutti = db.setup().centri.map((x) => x.id);
    await db.inviaMessaggio({ centriIds: tutti, tipo: 'marcia', portata: 2, comandaId: c.id }, 'm1', OP);
    const nuovi = db.lavori().filter((j) => j.idempotencyKey.startsWith('m1:'));
    expect(nuovi).toHaveLength(1);
    const testo = anteprima(nuovi[0].ticket!, 42).map((x) => x.testo).join('\n');
    expect(testo).toMatch(/MARCIA/);
    expect(testo).toMatch(/TAVOLO 5/);
    expect(testo).toMatch(/ENTREC/);
    expect(testo).not.toMatch(/Polpo/);
    expect(db.messaggi()[0].tipo).toBe('marcia');
    await db.segnaMessaggioVisto(db.messaggi()[0].id);
    expect(db.messaggi()[0].vistoAt).toBeTruthy();
  });

  it('messaggio libero a tutti i reparti; vuoto non parte', async () => {
    const { db } = nuovo();
    const tutti = db.setup().centri.map((x) => x.id);
    await db.inviaMessaggio({ centriIds: tutti, tipo: 'messaggio', testo: 'Tavolo 12 arriva tra 10 minuti' }, 'm2', OP);
    expect(db.messaggi()).toHaveLength(tutti.length);
    await expect(db.inviaMessaggio({ centriIds: tutti, tipo: 'messaggio', testo: ' ' }, 'm3', OP)).rejects.toThrow(/Scrivi/);
  });
});

describe('Fatture', () => {
  const s = seedDemo();
  const iva10 = s.aliquote.find((a) => a.percentuale === 10)!;
  const iva22 = s.aliquote.find((a) => a.percentuale === 22)!;

  it('scorporo IVA: righe e riepiloghi tornano al centesimo, anche con sconto', () => {
    const righe = [
      { descrizione: 'Polpo', quantita: 1, prezzoUnitarioCents: 2000, repartoRt: iva10.repartoRt },
      { descrizione: 'Gnocchi', quantita: 3, prezzoUnitarioCents: 1333, repartoRt: iva10.repartoRt },
      { descrizione: 'Vino', quantita: 1, prezzoUnitarioCents: 3200, repartoRt: iva22.repartoRt },
    ];
    const f = calcolaFattura(righe, 777, s.aliquote);
    const lordo = 2000 + 3999 + 3200 - 777;
    expect(f.totaleCents).toBe(lordo);
    for (const r of f.riepilogo) expect(f.linee.filter((l) => l.aliquota === r.aliquota).reduce((t, l) => t + l.totaleCents, 0)).toBe(r.imponibileCents);
    const r10 = f.riepilogo.find((r) => r.aliquota === 10)!;
    expect(Math.abs(r10.impostaCents - Math.round(r10.imponibileCents * 0.1))).toBeLessThanOrEqual(1);
  });

  it('controlli su intestatario e locale; XML con numero dal server', async () => {
    const privato: Cliente = { id: 'c1', nome: 'Mario', cognome: 'Rossi', allergeni: [], scontoPct: 0, consensoMarketing: false, codiceFiscale: 'RSSMRA80A01F839W' };
    expect(controllaIntestatario(privato)).toContain('indirizzo (via, CAP, comune)');
    privato.indirizzoFiscale = { via: 'Via Roma', civico: '1', cap: '84010', comune: 'Maiori', provincia: 'SA', nazione: 'IT' };
    expect(controllaIntestatario(privato)).toEqual([]);
    expect(controllaCedente({ ragioneSociale: 'Da completare' })).toContain('ragione sociale del locale');

    const ced = { ragioneSociale: 'Moorea S.r.l.', piva: '01234567890', regime: 'RF01', via: 'Lungomare Amendola', civico: '1', cap: '84010', comune: 'Maiori', provincia: 'SA' };
    const calcolo = calcolaFattura([{ descrizione: 'Cena & vino <rosso>', quantita: 2, prezzoUnitarioCents: 4500, repartoRt: iva10.repartoRt }], 0, s.aliquote);
    const xml = xmlFattura({ cedente: ced, cliente: privato, data: '2026-11-27', calcolo, progressivo: 'A1B2C', riferimento: 'scontrino 41-0001' });
    expect(xml).toMatch(/<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
    expect(xml).toMatch(/<Numero>__NUMERO__<\/Numero>/);
    expect(xml).toMatch(/Cena &amp; vino &lt;rosso&gt;/);
    expect(xml).toMatch(/<ImportoTotaleDocumento>90.00<\/ImportoTotaleDocumento>/);
    expect(xml).toMatch(/<ImponibileImporto>81.82<\/ImponibileImporto>/);

    const { db } = nuovo();
    const cl = await db.salvaCliente({ ...privato, id: undefined });
    const f1 = await db.emettiFattura({ clienteId: cl.id, documentoId: 'd1', data: '2026-11-27', calcolo, xml, progressivo: 'A1B2C', intestatario: 'Mario Rossi' }, 'f1');
    const f2 = await db.emettiFattura({ clienteId: cl.id, documentoId: 'd2', data: '2026-11-27', calcolo, xml, progressivo: 'A1B2D', intestatario: 'Mario Rossi' }, 'f2');
    expect([f1.numero, f2.numero]).toEqual([1, 2]);
    expect(f2.xml).toMatch(/<Numero>2<\/Numero>/);
    await expect(db.emettiFattura({ clienteId: cl.id, documentoId: 'd1', data: '2026-11-27', calcolo, xml, progressivo: 'X', intestatario: '' }, 'f3')).rejects.toThrow(/già/);
    expect((await db.storicoCliente(cl.id)).fatture).toHaveLength(2);
  });
});

describe('Annulla conto', () => {
  it('conto di prova: righe stornate, storno ai reparti, tavolo libero; con scontrino emesso no', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t7', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k1', OP);
    await coda.elabora();
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Lasagna') });
    await db.annullaComanda(c.id, 'Prova', 'a1', OP, true);
    expect(db.comanda(c.id)?.stato).toBe('annullata');
    expect(db.comandaDelTavolo('t7')).toBeUndefined();
    expect(db.righe(c.id).every((r) => r.stato === 'stornata')).toBe(true);
    const storni = db.lavori().filter((j) => j.idempotencyKey.startsWith('a1:'));
    expect(storni).toHaveLength(2); // cucina e bar, non la lasagna mai inviata
    expect(anteprima(storni[0].ticket!, 42).map((x) => x.testo).join('\n')).toMatch(/CONTO ANNULLATO: PROVA/);

    const d = await db.apriTavolo('t8', 2, OP);
    await db.aggiungiRiga(d.id, { articoloId: art(db, 'Negroni') });
    await db.invia(d.id, 'k2', OP);
    await db.incassa(d.id, { pagamenti: [{ tipo: 'contanti', importoCents: 5000 }] }, 'i1');
    await expect(db.annullaComanda(d.id, 'Prova', 'a2', OP)).rejects.toThrow(/scontrino/);
  });

  it('scontrino "da verificare" sbloccato a mano: uscito chiude il conto, non uscito permette di rifarlo', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t9', 0, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k', OP);
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: db.righe(c.id)[0].prezzoUnitarioCents }] }, 'i');
    const job = db.lavori().find((j) => j.documentoId === doc.id)!;
    await db.esitoLavoro(job.id, { ok: false, incerto: true, errore: 'nessuna risposta' });
    expect(db.documenti(c.id)[0].stato).toBe('da_verificare');
    await db.esitoLavoro(job.id, { ok: false, errore: 'Verificato a mano: non uscito' });
    expect(db.documenti(c.id)[0].stato).toBe('errore');
    const doc2 = await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: doc.totaleCents }] }, 'i2');
    const job2 = db.lavori().find((j) => j.documentoId === doc2.id)!;
    await db.esitoLavoro(job2.id, { ok: true, zNumero: 41, docNumero: 7 });
    expect(db.comanda(c.id)?.stato).toBe('chiusa');
  });
});

describe('Offerto dalla casa', () => {
  it('il piatto resta, vale 0, nessun ticket al reparto; si può rimettere a pagamento', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t3', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.invia(c.id, 'k', OP);
    const prima = db.lavori().length;
    const negroni = db.righe(c.id).find((r) => r.descrizione === 'Negroni')!;
    await db.offri(negroni.id, true, OP);
    expect(db.lavori()).toHaveLength(prima);
    expect(calcolaConto(db.righe(c.id), 2, 200).totaleCents).toBe(2000 + 400);
    await db.offri(negroni.id, false, OP);
    expect(calcolaConto(db.righe(c.id), 2, 200).totaleCents).toBe(2000 + 400 + negroni.prezzoUnitarioCents);
  });
});

describe('Proforma', () => {
  it('chiude senza scontrino né incasso, il tavolo si libera, il valore resta nel riepilogo a parte', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t7', 3, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k1', OP);
    const totale = calcolaConto(db.righe(c.id), 3, db.setup().locale.copertoCents).totaleCents;
    await expect(db.chiudiProforma(c.id, { motivo: ' ' }, 'p0', OP)).rejects.toThrow(/motivo/);
    await db.chiudiProforma(c.id, { motivo: 'Famiglia', nome: 'Zia Anna', stampa: true }, 'p1', OP);
    expect(db.comanda(c.id)?.stato).toBe('chiusa');
    expect(db.comanda(c.id)?.proforma).toMatchObject({ motivo: 'Famiglia', nome: 'Zia Anna', totaleCents: totale });
    expect(db.comandaDelTavolo('t7')).toBeUndefined();
    expect(db.documenti(c.id)).toHaveLength(0);
    expect(db.righe(c.id).every((r) => r.stato !== 'stornata')).toBe(true);
    const foglio = db.lavori().find((j) => j.idempotencyKey === 'p1')!;
    const testo = anteprima(foglio.ticket!, 42).map((x) => x.testo).join('\n');
    expect(testo).toMatch(/PROFORMA/); expect(testo).toMatch(/Famiglia · Zia Anna/); expect(testo).toMatch(/NON INCASSATO/);

    const r = riepilogo(await db.datiPeriodo(1), db.setup());
    expect(r.incassoCents).toBe(0);
    expect(r.conti).toBe(0);
    expect(r.proforma).toMatchObject({ conti: 1, coperti: 3, valoreCents: totale });
    expect(r.piatti.length).toBeGreaterThan(0); // consumati: contano nei piatti (e nello scarico)
  });

  it('non si fa su un conto con scontrino o vuoto', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t8', 0, OP);
    await expect(db.chiudiProforma(c.id, { motivo: 'Amici' }, 'p2', OP)).rejects.toThrow(/vuoto/);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k', OP);
    await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: db.righe(c.id)[0].prezzoUnitarioCents }] }, 'i');
    await expect(db.chiudiProforma(c.id, { motivo: 'Amici' }, 'p3', OP)).rejects.toThrow(/scontrino/);
  });
});

describe('Tavoli uniti e banco', () => {
  it('unisce tavoli liberi: occupati, un solo conto, comanda "3+4", poi si separano', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t3', 10, OP);
    await db.unisciTavoli(c.id, ['t4', 't3']);
    expect(db.comanda(c.id)?.tavoliUniti).toEqual(['t4']);
    expect(db.comandaDelTavolo('t4')?.id).toBe(c.id);
    await expect(db.apriTavolo('t4', 2, OP)).rejects.toThrow(/aperto/);
    const altro = await db.apriTavolo('t6', 2, OP);
    await expect(db.unisciTavoli(altro.id, ['t4'])).rejects.toThrow(/occupato/);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    const [j] = await db.invia(c.id, 'k', OP);
    expect(anteprima(j.ticket!, 42).map((x) => x.testo).join('\n')).toMatch(/3\+4/);
    await db.separaTavolo(c.id, 't4');
    expect(db.comandaDelTavolo('t4')).toBeUndefined();
  });

  it('banco: conto senza tavolo, si incassa e si chiude', async () => {
    const { db } = nuovo();
    const c = await db.apriBanco('banco', 'Marco', OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k', OP);
    await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: db.righe(c.id)[0].prezzoUnitarioCents }] }, 'i');
    expect(db.documenti(c.id)).toHaveLength(1);
  });
});

describe('Cassa spenta', () => {
  it('lavori mai partiti dopo 10 minuti si sospendono; stampa o scarta (lo scontrino scartato libera il conto)', async () => {
    let t = new Date(2026, 10, 27, 20, 0);
    const db = new FakeDataLayer(seedDemo(), () => t);
    const c = await db.apriTavolo('t1', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    const [j] = await db.invia(c.id, 'k', OP);
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: 2000 + 2 * db.setup().locale.copertoCents }] }, 'i');
    t = new Date(2026, 10, 27, 20, 30); // la cassa si riaccende mezz'ora dopo
    expect(await db.prendiLavori()).toHaveLength(0);
    expect(db.lavori().every((x) => x.stato === 'sospeso')).toBe(true);
    await db.decidiLavoro(j.id, true);
    expect((await db.prendiLavori()).map((x) => x.id)).toEqual([j.id]);
    const fiscale = db.lavori().find((x) => x.documentoId === doc.id)!;
    await db.decidiLavoro(fiscale.id, false);
    expect(db.documenti(c.id)[0].stato).toBe('errore');
  });

  it('battito della cassa: vivo per 90 secondi, con lo stato del registratore', async () => {
    const db = new FakeDataLayer(seedDemo());
    const coda = new CodaStampa(db, new TrasportoSimulato());
    const stato = await coda.leggiRt();
    expect(stato).toMatchObject({ stampante: 'ok', giornataAperta: true, fileRifiutati: 0 });
    await db.battito('Cassa', '0.8.0', stato);
    expect(ponteVivo(db.ponti()[0])).toBe(true);
    expect(ponteVivo(db.ponti()[0], Date.now() + 120_000)).toBe(false);
  });
});

describe('Cassa completa', () => {
  it('menu fisso: un prezzo sul conto, i piatti in cucina a zero; stornando il menu si stornano anche i piatti', async () => {
    const { db } = nuovo();
    const menu = art(db, 'Polpo Scottato'), a1 = art(db, 'Cozze Indiavolate'), a2 = art(db, 'Lasagna');
    await db.salvaImpostazioni({ menuFissi: { [menu]: { gruppi: [{ nome: 'Antipasto', articoliIds: [a1], scelte: 1, portata: 1 }, { nome: 'Primo', articoliIds: [a2], scelte: 1, portata: 2 }] } } });
    const c = await db.apriTavolo('t2', 0, OP);
    await expect(db.aggiungiMenu(c.id, menu, [{ articoloId: a1, gruppo: 0 }])).rejects.toThrow(/Primo/);
    await db.aggiungiMenu(c.id, menu, [{ articoloId: a1, gruppo: 0 }, { articoloId: a2, gruppo: 1 }]);
    const righe = db.righe(c.id);
    expect(righe).toHaveLength(3);
    expect(calcolaConto(righe, 0, 0).totaleCents).toBe(db.setup().articoli.find((a) => a.id === menu)!.prezzoCents);
    await db.invia(c.id, 'k', OP);
    const padre = righe.find((r) => !r.parentId)!;
    await db.storna(padre.id, 'Errore', 's');
    expect(db.righe(c.id).every((r) => r.stato === 'stornata')).toBe(true);
  });

  it('sospeso e camera: scontrino non riscosso, poi si incassa; caparra usata nel conto', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t3', 0, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.invia(c.id, 'k', OP);
    const cap = await db.salvaCaparra({ nome: 'Gruppo Esposito', clienteId: null, importoCents: 1000, metodo: 'carta' });
    const tot = calcolaConto(db.righe(c.id), 0, 0).totaleCents;
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: 1000, descrizione: `caparra:${cap.id}` }, { tipo: 'camera', importoCents: tot - 1000, descrizione: '12 Rossi' }] }, 'i');
    const coda = new CodaStampa(db, new TrasportoSimulato());
    await coda.elabora();
    expect(db.documenti(c.id).find((d) => d.id === doc.id)?.stato).toBe('emesso');
    expect((await db.caparre()).find((x) => x.id === cap.id)?.stato).toBe('usata');
    const [s] = await db.sospesi();
    expect(s).toMatchObject({ tipo: 'camera', descrizione: '12 Rossi', importoCents: tot - 1000, stato: 'aperto' });
    await db.incassaSospeso(s.id, 'carta');
    expect((await db.sospesi())[0].stato).toBe('incassato');
  });
});

describe('Reso parziale e ristampa', () => {
  it('reso di una riga: documento REFUND con il riferimento, incasso ridotto; non oltre il totale', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t5', 0, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato'), quantita: 2 });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await db.invia(c.id, 'k', OP);
    const tot = calcolaConto(db.righe(c.id), 0, 0).totaleCents;
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'carta', importoCents: tot }] }, 'i');
    await coda.elabora();
    const emesso = db.documenti(c.id)[0];
    const i = emesso.righe.findIndex((r) => /Polpo/.test(r.descrizione));
    await db.resoDocumento(doc.id, [{ indice: i, quantita: 1 }], 'carta', 'r1');
    const job = db.lavori().find((j) => j.tipo === 'reso')!;
    expect(job.xml).toMatch(/REFUND \d{4} \d{4} \d{8}/);
    expect(job.xml).toMatch(/quantity="1"/);
    await coda.elabora();
    const r = riepilogo(await db.datiPeriodo(1), db.setup());
    expect(r.resi).toBe(1);
    expect(r.incassoCents).toBe(tot - emesso.righe[i].prezzoUnitarioCents);
    await expect(db.resoDocumento(doc.id, [{ indice: i, quantita: 2 }], 'carta', 'r2')).rejects.toThrow(/al massimo/);
  });

  it('ristampa: solo i piatti già mandati, al reparto giusto, con RISTAMPA', async () => {
    const { db } = nuovo();
    const c = await db.apriTavolo('t6', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Negroni') });
    await expect(db.ristampa(c.id, 'x0')).rejects.toThrow(/Niente da ristampare/);
    await db.invia(c.id, 'k', OP);
    const cucina = db.setup().centri.find((x) => /cucina/i.test(x.nome))!;
    await db.ristampa(c.id, 'x1', cucina.id);
    const j = db.lavori().filter((x) => x.idempotencyKey.startsWith('x1:'));
    expect(j).toHaveLength(1);
    const t = anteprima(j[0].ticket!, 42).map((x) => x.testo).join('\n');
    expect(t).toMatch(/RISTAMPA/); expect(t).toMatch(/POLPO/); expect(t).not.toMatch(/NEGRONI/);
  });
});

describe('Export per il commercialista', () => {
  it('corrispettivi del giorno con IVA scorporata e resi; elenco documenti', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t4', 0, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.invia(c.id, 'k', OP);
    const tot = calcolaConto(db.righe(c.id), 0, 0).totaleCents;
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: tot + 500 }] }, 'i');
    await coda.elabora();
    await db.resoDocumento(doc.id, [{ indice: 0, quantita: 1 }], 'contanti', 'r');
    await coda.elabora();
    const oggi = giornoDiServizio(new Date().toISOString());
    const e = esportaCorrispettivi(await db.datiPeriodo(1), db.setup(), oggi, oggi);
    const righe = e.corrispettivi.trim().split('\r\n');
    expect(righe[0]).toMatch(/^Data;Scontrini;Corrispettivi;Contanti/);
    expect(righe[1].split(';')[1]).toBe('1');
    expect(righe[1].split(';')[2]).toBe('0,00'); // reso totale: corrispettivi a zero
    expect(e.documenti).toMatch(/Reso;\d+-\d{4};-/);
  });
});

describe('Cassa senza internet', () => {
  it('lavora dall’istantanea, stampa e fa scontrini; al ritorno manda solo il nuovo, già emesso', async () => {
    const setup = seedDemo();
    const online = new FakeDataLayer(setup);
    const aperta = await online.apriTavolo('t1', 2, OP);
    await online.aggiungiRiga(aperta.id, { articoloId: setup.articoli.find((a) => a.nome === 'Negroni')!.id });
    const base = { quando: new Date().toISOString(), localeId: 'L', setup, comande: online.comandeAperte(), righe: online.righe(aperta.id), documenti: [] };
    const off = new CassaOffline(base, async (pin) => (pin === '1111' ? OP : null));
    expect(await off.login('1111')).toEqual(OP);
    await expect(off.salvaCaparra()).rejects.toThrow(/Senza internet/);
    const coda = new CodaStampa(off, new TrasportoSimulato());
    // Il tavolo aperto prima del guasto continua; se ne apre un altro.
    await off.invia(aperta.id, 'k1', OP);
    const nuovo = await off.apriTavolo('t2', 3, OP);
    expect(nuovo.numero).toBe(aperta.numero + 1);
    await off.aggiungiRiga(nuovo.id, { articoloId: art(off, 'Polpo Scottato') });
    await off.invia(nuovo.id, 'k2', OP);
    await coda.elabora();
    const tot = calcolaConto(off.righe(aperta.id), 2, setup.locale.copertoCents).totaleCents;
    await off.incassa(aperta.id, { pagamenti: [{ tipo: 'carta', importoCents: tot }] }, 'i1');
    await coda.elabora();
    await off.registraMovimento('fondo', 10000, '', 'm1', OP);
    const d = datiDaSincronizzare(base, off.stato());
    expect(d.comande.map((c) => [c.id, c.stato, c.nuova])).toEqual(expect.arrayContaining([[aperta.id, 'chiusa', false], [nuovo.id, 'aperta', true]]));
    expect(d.righe.every((r) => r.stato === 'inviata' && !/\d{6}$/.test(r.created_at!))).toBe(true);
    expect(d.documenti).toHaveLength(1);
    expect(d.documenti[0]).toMatchObject({ stato: 'emesso', comanda_id: aperta.id, nuovo: true });
    expect(d.documenti[0].rt_doc_numero).toBeGreaterThan(0);
    expect(d.movimenti).toHaveLength(1);
    // Il tavolo nuovo è ancora aperto: ripreso dopo un riavvio senza linea.
    const ripreso = new CassaOffline(base, async () => null);
    ripreso.ripristina(off.stato());
    expect(ripreso.comandaDelTavolo('t2')?.id).toBe(nuovo.id);
  });
});
