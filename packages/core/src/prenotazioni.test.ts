import { describe, it, expect } from 'vitest';
import { FakeDataLayer, CodaStampa, TrasportoSimulato, seedMoorea, prenotazioniDemo, daAccogliere, calcolaConto } from './index';

const OP = { id: 'op-aldo', nome: 'Aldo', ruolo: 'cameriere' };

describe('Prenotazioni da Table Flow', () => {
  it('apro il tavolo dalla prenotazione: allergie in comanda, poi conto chiuso = terminata', async () => {
    const db = new FakeDataLayer(seedMoorea());
    db.impostaPrenotazioni(prenotazioniDemo());
    const coda = new CodaStampa(db, new TrasportoSimulato());
    expect(db.prenotazioni().filter(daAccogliere)).toHaveLength(4);

    const c = await db.apriTavolo('t5', 4, OP, 'pr-rossi');
    expect(c.prenotazioneId).toBe('pr-rossi');
    expect(c.allergeniTavolo).toEqual([{ allergene: 'glutine' }]);
    expect(db.prenotazioni().find((p) => p.id === 'pr-rossi')?.stato).toBe('arrivata');

    await db.aggiungiRiga(c.id, { articoloId: db.setup().articoli[0].id });
    await db.invia(c.id, 'k1'); await coda.elabora();
    const totale = calcolaConto(db.righe(c.id), c.coperti, db.setup().locale.copertoCents).totaleCents;
    await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: totale }] }, 'k2'); await coda.elabora();
    expect(db.prenotazioni().find((p) => p.id === 'pr-rossi')?.stato).toBe('terminata');
  });

  it('no show', async () => {
    const db = new FakeDataLayer(seedMoorea());
    db.impostaPrenotazioni(prenotazioniDemo());
    await db.segnaNonPresentato('pr-esposito');
    expect(db.prenotazioni().find((p) => p.id === 'pr-esposito')?.stato).toBe('mancata');
    expect(db.prenotazioni().filter(daAccogliere)).toHaveLength(3);
  });
});
