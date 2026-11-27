import { describe, it, expect } from 'vitest';
import { FakeDataLayer, CodaStampa, TrasportoSimulato, seedDemo, calcolaConto, calcolaFattura, xmlFattura, controllaIntestatario, controllaCedente, anteprima, riepilogo, type Cliente } from './index';

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
    expect(anteprima(jobs[0].ticket!, 42).map((x) => x.testo).join('\n')).toMatch(/1 x Pasta al pomodoro/);
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
    expect(testo).toMatch(/Entrec/);
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
    expect(anteprima(storni[0].ticket!, 42).map((x) => x.testo).join('\n')).toMatch(/CONTO ANNULLATO: Prova/);

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
