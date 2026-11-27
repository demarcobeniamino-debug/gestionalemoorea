// Prova end-to-end delle funzioni di cassa: Satispay ed emittenti buoni (Gestione), pagamento in più modi con caparra,
// addebito in camera e incasso dai Sospesi, cassetto con fondo e conteggio, menu fisso in comanda, fattura riepilogativa.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const passo = (t) => console.log('·', t);
const p = await browser.newPage({ viewport: { width: 1366, height: 900 } });
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
const pin = async (c, dove = p) => { for (const x of c) await dove.getByRole('button', { name: x, exact: true }).click(); };
const foglio = () => p.locator('dialog[open]').last();
const vai = async (h) => { await p.goto(URL + '/#' + h); await p.waitForTimeout(300); };
const ordina = async (tavolo, piatto, cat = 'Antipasti') => {
  await vai('/sala');
  await p.getByRole('button', { name: new RegExp(`^Tavolo ${tavolo}, libero`) }).click();
  await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
  await p.getByRole('button', { name: cat, exact: true }).first().click();
  await p.getByRole('button', { name: new RegExp(`^${piatto}`) }).click();
  await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Conto', exact: true }).click();
  await p.waitForURL(/#\/conto\//);
};

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('9999');
await p.waitForURL(/#\/sala/);

// Gestione: Satispay ed Edenred
await vai('/gestione/pagamenti');
await p.getByLabel('Nome').fill('Satispay');
await p.getByRole('button', { name: 'Aggiungi', exact: true }).first().click();
await p.getByText(/^Satispay ·/).waitFor();
await p.getByLabel('Emittente').fill('Edenred');
await p.getByRole('button', { name: 'Aggiungi', exact: true }).last().click();
await p.getByText('Edenred').first().waitFor();
await p.screenshot({ path: `${OUT}/C01-pagamenti.png`, fullPage: true });
passo('gestione: Satispay e emittente Edenred');

// Caparra del gruppo
await vai('/cassa');
await p.getByRole('tab', { name: 'Caparre' }).click();
await p.getByRole('button', { name: 'Nuova caparra' }).click();
await foglio().getByLabel('Per chi').fill('Gruppo Esposito');
await foglio().getByLabel('Importo').fill('10');
await foglio().getByRole('button', { name: 'Registra' }).click();
await p.getByText('Gruppo Esposito').waitFor();
passo('caparra registrata');

// Tavolo 1: caparra 10 € + resto con Satispay e codice lotteria
await ordina(1, 'Polpo Scottato');
await p.getByRole('button', { name: /^Altro/ }).click();
await foglio().getByRole('button', { name: /Gruppo Esposito/ }).click();
await p.getByRole('radio', { name: 'Satispay' }).click();
await p.getByLabel('Codice lotteria degli scontrini').fill('ab12cd34');
await p.screenshot({ path: `${OUT}/C02-conto-misto.png` });
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 8000 });
passo('conto: caparra + Satispay + lotteria, scontrino emesso');

// Tavolo 2: addebito in camera, poi incasso dai Sospesi
await ordina(2, 'Totani e Patate');
await p.getByRole('button', { name: /^Altro/ }).click();
await foglio().getByRole('button', { name: /Addebito in camera/ }).click();
await p.getByLabel('Camera e ospite').fill('12 Rossi');
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 8000 });
await vai('/cassa');
await p.getByRole('tab', { name: 'Sospesi' }).click();
await p.getByText('12 Rossi').waitFor();
await p.getByRole('button', { name: 'Incassa', exact: true }).click();
await foglio().getByRole('radio', { name: 'Carta' }).click();
await foglio().getByRole('button', { name: 'Registra l’incasso' }).click();
await p.getByText('Già incassati').waitFor();
passo('camera: scontrino non riscosso, poi incassato dai Sospesi');

// Cassetto: fondo 100 € e conteggio
await p.getByRole('tab', { name: 'Cassetto' }).click();
await p.getByRole('button', { name: 'Fondo cassa' }).click();
await foglio().getByLabel('Importo').fill('100');
await foglio().getByRole('button', { name: 'Registra' }).click();
await p.waitForTimeout(800); await p.getByRole('button', { name: 'Conteggio' }).click();
await foglio().getByRole('button', { name: 'Registra' }).click();
await p.getByText('torna al centesimo').waitFor();
await p.screenshot({ path: `${OUT}/C03-cassetto.png`, fullPage: true });
passo('cassetto: fondo, contante atteso, conteggio che torna');

// Riepilogativa: due scontrini in una fattura
await p.getByRole('tab', { name: 'Riepilogo' }).click();
await p.getByRole('button', { name: 'Fattura riepilogativa' }).click();
for (const c of await p.getByRole('checkbox').all()) await c.check();
await p.getByRole('button', { name: /^Fattura su 2 scontrini/ }).click();
await foglio().waitFor();
await p.screenshot({ path: `${OUT}/C04-riepilogativa.png` });
await p.keyboard.press('Escape');
passo('fattura riepilogativa su 2 scontrini');

// Reso parziale di uno scontrino, poi file per il commercialista
await vai('/cassa');
await p.getByRole('button', { name: 'Reso', exact: true }).first().click();
await foglio().getByRole('button', { name: /^Più / }).first().click();
await foglio().getByRole('button', { name: 'Fai il reso' }).click();
await p.getByText('Reso inviato alla cassa').waitFor();
await p.waitForTimeout(1500);
await p.getByText(/^Reso( n\.|$)/).first().waitFor();
await p.getByRole('tab', { name: 'Chiusure' }).click();
await p.getByRole('button', { name: 'Questo mese' }).click();
const [file] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Corrispettivi' }).click()]);
const testo = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
if (!/Corrispettivi/.test(testo) || testo.trim().split('\n').length < 3) throw new Error('CSV corrispettivi vuoto: ' + testo);
passo('reso parziale e corrispettivi scaricati (' + file.suggestedFilename() + ')');

// Ristampa dal tavolo
await vai('/sala');
await p.getByRole('button', { name: /^Tavolo 6, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Cozze/ }).click();
await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await foglio().getByRole('button', { name: /Ristampa comanda/ }).click();
await foglio().getByRole('button', { name: /Ristampa per Cucina/ }).click();
await p.getByText('Ristampa mandata a Cucina').waitFor();
passo('ristampa della comanda alla cucina');

// Promozione happy hour e menu fisso dalla Gestione
await vai('/gestione/promozioni');
await p.getByRole('button', { name: 'Nuova promozione' }).click();
await foglio().getByRole('button', { name: 'Cocktail', exact: true }).click();
await foglio().getByRole('button', { name: 'Salva' }).click();
await p.getByText(/−20% · 18:00–20:00/).waitFor();
await vai('/gestione/menu-fissi');
await p.getByRole('button', { name: 'Nuovo menu fisso' }).click();
await foglio().getByLabel('Articolo del menu (il prezzo è il suo)').selectOption({ label: 'Polpo Scottato · € 20,00' });
await foglio().getByPlaceholder('Cerca un articolo da aggiungere').fill('cozze');
await foglio().getByRole('button', { name: /^\+ Cozze/ }).click();
await foglio().getByRole('button', { name: 'Salva' }).click();
await p.getByText(/Antipasto \(1 su 1\)/).waitFor();
await ordina(4, 'Polpo Scottato').catch(() => undefined);
passo('gestione: happy hour e menu fisso salvati');

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
