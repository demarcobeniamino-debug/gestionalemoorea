import { describe, it, expect } from 'vitest';
import { FakeDataLayer, CodaStampa, TrasportoSimulato, seedDemo, riepilogo, calcolaConto } from './index';

const OP = { id: 'op-aldo', nome: 'Aldo', ruolo: 'cameriere' };

describe('Servizio completo', () => {
  const nuovo = () => { const db = new FakeDataLayer(seedDemo()); return { db, coda: new CodaStampa(db, new TrasportoSimulato()) }; };
  const art = (db: FakeDataLayer, nome: string) => db.setup().articoli.find((a) => a.nome === nome)!.id;

  it('la demo ha il menu vero e la sala di Table Flow', () => {
    const s = seedDemo();
    expect(s.articoli).toHaveLength(265);
    expect(s.articoli.find((a) => a.nome === 'Polpo Scottato')?.prezzoCents).toBe(2000);
    expect(s.tavoli).toHaveLength(30);
    expect(s.sale.map((x) => x.nome)).toEqual(['Sala Matine', 'Sala Giardini', 'Sala Mare']);
    expect(s.articoli.find((a) => a.nome === 'Entrecôte alla Griglia')?.variantiIds).toHaveLength(4);
  });

  it('sposta, unisci, sposta righe', async () => {
    const { db } = nuovo();
    const a = await db.apriTavolo('t1', 2, OP);
    const b = await db.apriTavolo('t2', 3, OP);
    await db.aggiungiRiga(b.id, { articoloId: art(db, 'Negroni') });
    await db.aggiungiRiga(b.id, { articoloId: art(db, 'Tiramisù') });
    await db.spostaComanda(a.id, 't14');
    expect(db.comanda(a.id)?.tavoloId).toBe('t14');
    await expect(db.spostaComanda(a.id, 't2')).rejects.toThrow(/già aperto/);
    await db.spostaRighe([db.righe(b.id)[0].id], a.id);
    expect(db.righe(a.id).map((r) => r.descrizione)).toEqual(['Negroni']);
    await db.unisciComande(a.id, b.id);
    expect(db.comanda(a.id)?.coperti).toBe(5);
    expect(db.righe(a.id)).toHaveLength(2);
    expect(db.comanda(b.id)?.stato).toBe('annullata');
  });

  it('sconto, annullo, riepilogo e chiusura', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t5', 2, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Polpo Scottato') });
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Gin Tonic') });
    await db.invia(c.id, 'k1'); await coda.elabora();
    const totale = calcolaConto(db.righe(c.id), 2, 200).totaleCents; // 20 + 8 + 4 coperto
    expect(totale).toBe(3200);
    const doc = await db.incassa(c.id, { scontoCents: 200, pagamenti: [{ tipo: 'carta', importoCents: 3000 }] }, 'k2');
    await coda.elabora();
    expect(db.documenti(c.id)[0].stato).toBe('emesso');
    expect(db.comanda(c.id)?.stato).toBe('chiusa');

    let r = riepilogo(await db.datiPeriodo(1), db.setup());
    expect(r.incassoCents).toBe(3000);
    expect(r.scontiCents).toBe(200);
    expect(r.perPagamento.carta).toBe(3000);
    expect(r.coperti).toBe(2);
    expect(r.aCopertoCents).toBe(1500);
    expect(r.perSala[0].nome).toBe('Sala Matine');
    expect(r.perOperatore[0].nome).toBe('Aldo');
    expect(r.piatti.map((p) => p.descrizione)).toContain('Polpo Scottato');

    await db.annullaDocumento(doc.id, 'k3'); await coda.elabora();
    r = riepilogo(await db.datiPeriodo(1), db.setup());
    expect(r.incassoCents).toBe(0);
    expect(r.annullati).toBe(1);
    await expect(db.annullaDocumento(doc.id, 'k4')).rejects.toThrow();

    await db.chiusuraFiscale({ incasso_cents: 0 }, 'k5'); await coda.elabora();
    expect(db.lavori().at(-1)?.tipo).toBe('chiusura_fiscale');
    expect(db.lavori().at(-1)?.stato).toBe('stampato');
  });

  it('contanti con resto: conta l’incassato', async () => {
    const { db, coda } = nuovo();
    const c = await db.apriTavolo('t6', 1, OP);
    await db.aggiungiRiga(c.id, { articoloId: art(db, 'Tiramisù') });
    await db.invia(c.id, 'k1'); await coda.elabora();
    await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: 5000 }] }, 'k2'); await coda.elabora();
    expect(riepilogo(await db.datiPeriodo(1), db.setup()).perPagamento.contanti).toBe(1000);
  });
});
