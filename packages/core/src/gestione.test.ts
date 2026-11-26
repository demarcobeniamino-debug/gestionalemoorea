import { describe, it, expect } from 'vitest';
import {
  seedMoorea, tabelleDaSetup, setupDaTabelle, magazzinoDemo, MemoriaArchivio, deltaMovimento, foodCost,
  statoScorta, prezzoDi, FakeDataLayer,
} from './index';

const demo = () => magazzinoDemo(tabelleDaSetup(seedMoorea()));

describe('Gestione', () => {
  it('tabelle ↔ configurazione: il giro completo non perde piatti, prezzi, varianti e tavoli', () => {
    const s = seedMoorea();
    const s2 = setupDaTabelle(tabelleDaSetup(s), s.operatori);
    expect(s2.articoli.map((a) => [a.nome, a.prezzoCents, a.variantiIds.length]))
      .toEqual(s.articoli.map((a) => [a.nome, a.prezzoCents, a.variantiIds.length]));
    expect(s2.tavoli).toHaveLength(s.tavoli.length);
    expect(s2.categorie.map((c) => c.centroProduzioneId)).toEqual(s.categorie.map((c) => c.centroProduzioneId));
  });

  it('nuovo articolo con prezzo compare nel listino della comanda', async () => {
    const s = seedMoorea();
    const db = new FakeDataLayer(s);
    const ar = new MemoriaArchivio(tabelleDaSetup(s), (t) => db.impostaSetup(setupDaTabelle(t, s.operatori)));
    const t = ar.tabelle();
    const a = await ar.salva('articoli', {
      categoria_id: 'c-primi', nome: 'Scialatielli ai frutti di mare', nome_breve: null, aliquota_iva_id: 'iva10',
      centro_produzione_id: null, allergeni: ['glutine', 'molluschi'], esaurito: false, ordine: 99, attivo: true,
    });
    await ar.salva('prezzi_listino', { listino_id: t.listini[0].id, articolo_id: a.id, prezzo_cents: 2200 });
    expect(db.setup().articoli.find((x) => x.id === a.id)?.prezzoCents).toBe(2200);
    expect(prezzoDi(a.id, ar.tabelle())).toBe(2200);

    await ar.salva('articoli', { id: a.id, attivo: false });
    expect(db.setup().articoli.some((x) => x.id === a.id)).toBe(false);
  });

  it('non si elimina una categoria con articoli né una sala con tavoli', async () => {
    const ar = new MemoriaArchivio(demo());
    await expect(ar.elimina('categorie', { id: 'c-primi' })).rejects.toThrow(/articoli/);
    await expect(ar.elimina('sale', { id: 'sala-int' })).rejects.toThrow(/tavoli/);
  });

  it('numero di tavolo doppio rifiutato', async () => {
    const ar = new MemoriaArchivio(demo());
    await expect(ar.salva('tavoli', { sala_id: 'sala-int', numero: '7', forma: 'tondo', x: 5, y: 5, larghezza: 1, altezza: 1, posti: 2, attivo: true }))
      .rejects.toThrow(/già un tavolo/);
  });

  it('movimenti: carico, scarico e inventario aggiornano la giacenza', async () => {
    const ar = new MemoriaArchivio(demo());
    const g = () => ar.tabelle().scorte.find((s) => s.mag_articolo_id === 'm-pecorino')!.giacenza;
    expect(g()).toBe(1.2);
    await ar.registraMovimento({ tipo: 'carico', rif: 'DDT 12', righe: [{ magArticoloId: 'm-pecorino', quantita: 5, costoCents: 1900 }] });
    expect(g()).toBeCloseTo(6.2);
    expect(ar.tabelle().mag_articoli.find((m) => m.id === 'm-pecorino')!.costo_ultimo_cents).toBe(1900);
    await ar.registraMovimento({ tipo: 'scarto', righe: [{ magArticoloId: 'm-pecorino', quantita: 0.2 }] });
    expect(g()).toBeCloseTo(6);
    await ar.registraMovimento({ tipo: 'inventario', righe: [{ magArticoloId: 'm-pecorino', quantita: 5.5 }] });
    expect(g()).toBe(5.5);
    expect(ar.tabelle().movimenti[0].righe[0].quantita).toBeCloseTo(-0.5);
    expect(ar.tabelle().movimenti).toHaveLength(3);
  });

  it('delta, food cost e stato scorta', () => {
    expect(deltaMovimento('carico', 3, 10)).toBe(3);
    expect(deltaMovimento('scarico', 3, 10)).toBe(-3);
    expect(deltaMovimento('inventario', 7, 10)).toBe(-3);
    expect(() => deltaMovimento('carico', -1, 0)).toThrow();
    const t = demo();
    const cacio = t.articoli.find((a) => /cacio e pepe/i.test(a.nome))!.id;
    // 0,12 kg × 4,20 + 0,06/0,9 kg × 18,00 + 0,003 kg × 24,00 = 0,504 + 1,20 + 0,072 = 1,776 €
    expect(foodCost(cacio, t)).toBe(178);
    expect(statoScorta({ giacenza: 1.2, scorta_min: 2 })).toBe('bassa');
    expect(statoScorta({ giacenza: 0, scorta_min: null })).toBe('esaurita');
    expect(statoScorta({ giacenza: 5, scorta_min: 2 })).toBe('ok');
  });
});
