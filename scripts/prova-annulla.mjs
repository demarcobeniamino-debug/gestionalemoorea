// Prova end-to-end: annulla conto (responsabile e cameriere con PIN), schede della cassa
// (riepilogo, invio scontrini, chiusure, fatture).
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const passo = (t) => console.log('·', t);
const p = await browser.newPage({ viewport: { width: 1366, height: 820 } });
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
const pin = async (c, dove = p) => { for (const x of c) await dove.getByRole('button', { name: x, exact: true }).click(); };
const foglio = () => p.locator('dialog[open]');
const cambiaOperatore = async (c) => {
  await p.getByRole('button', { name: /^Operatore .*: tocca per cambiare/ }).click();
  await p.waitForURL(/#\/accesso/);
  await pin(c);
  await p.waitForURL(/#\/sala/);
};

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('1111');
await p.waitForURL(/#\/sala/);

// cameriere: apre il 6, manda un piatto, annulla con il PIN del responsabile
await p.getByRole('button', { name: /^Tavolo 6, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Cozze Indiavolate/ }).click();
await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await foglio().getByRole('button', { name: /Elimina conto/ }).click();
await foglio().getByRole('radio', { name: 'Aperto per errore' }).click();
await p.screenshot({ path: `${OUT}/A01-annulla-pin.png` });
await foglio().getByRole('button', { name: 'Elimina il conto' }).click();
await p.getByText('Serve il PIN di un responsabile').waitFor();
await pin('2222', foglio()); // un altro cameriere non basta
await foglio().getByRole('button', { name: 'Elimina il conto' }).click();
await p.getByText('Serve il PIN di un responsabile').waitFor();
await pin('9999', foglio());
await foglio().getByRole('button', { name: 'Elimina il conto' }).click();
await p.waitForURL(/#\/sala/);
await p.getByText('Conto eliminato, il tavolo è libero').waitFor();
await p.getByRole('button', { name: /^Tavolo 6, libero/ }).waitFor();
passo('cameriere: annullo solo con il PIN del responsabile, tavolo 6 libero');

// responsabile: conto pagato non si annulla; quello di prova sì, senza PIN
await cambiaOperatore('9999');
await p.getByRole('button', { name: /^Tavolo 11, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await foglio().getByRole('button', { name: /Elimina conto/ }).click();
await foglio().getByRole('radio', { name: 'Prova' }).click();
await foglio().getByRole('button', { name: 'Elimina il conto' }).click();
await p.waitForURL(/#\/sala/);
await p.getByRole('button', { name: /^Tavolo 11, libero/ }).waitFor();
passo('responsabile: annullo senza PIN, tavolo 11 libero');

// proforma dal conto: famiglia, non incassato, tavolo libero
await p.getByRole('button', { name: /^Tavolo 3, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Conto', exact: true }).click();
await p.getByRole('button', { name: 'Proforma', exact: true }).click();
await foglio().getByRole('radio', { name: 'Famiglia' }).click();
await foglio().getByLabel('Per chi').fill('Zia Anna');
await p.screenshot({ path: `${OUT}/A05-proforma.png` });
await foglio().getByRole('button', { name: 'Chiudi come proforma' }).click();
await p.waitForURL(/#\/sala/);
await p.getByText('Proforma chiuso, il tavolo è libero').waitFor();
await p.getByRole('button', { name: /^Tavolo 3, libero/ }).waitFor();
passo('proforma dal conto: tavolo 3 libero senza scontrino');

// un conto incassato, per riempire le schede della cassa
await p.getByRole('button', { name: /^Tavolo 1, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Totani e Patate/ }).click();
await p.getByRole('button', { name: /^Invia \(1\)/ }).click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Conto', exact: true }).click();
await p.getByRole('button', { name: 'Importo esatto' }).click();
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 5000 });

await p.getByRole('link', { name: 'Cassa' }).click();
await p.getByRole('button', { name: 'Chiusura fiscale' }).click();
await foglio().getByRole('button', { name: 'Chiudi la giornata' }).click();
await p.getByText('Chiusura inviata alla cassa').waitFor();
await p.waitForTimeout(1500);
await p.getByRole('tab', { name: /Invio scontrini/ }).click();
await p.getByText('Chiusura Z').first().waitFor();
await p.screenshot({ path: `${OUT}/A02-invio-scontrini.png`, fullPage: true });
await p.getByRole('tab', { name: 'Chiusure' }).click();
await p.getByText(/Z n\. \d+|Registrata|Stampato/).first().waitFor();
await p.screenshot({ path: `${OUT}/A03-chiusure.png` });
await p.getByRole('tab', { name: 'Fatture' }).click();
await p.getByText('Da inviare allo SDI').waitFor();
await p.screenshot({ path: `${OUT}/A04-situazione-fatture.png` });
passo('cassa: schede invio scontrini, chiusure, fatture');

// le statistiche non contano i conti annullati
await p.getByRole('tab', { name: 'Riepilogo' }).click();
const kpi = await p.getByRole('region', { name: 'Numeri principali' }).innerText();
if (!/20,00/.test(kpi)) throw new Error('incasso atteso 20,00 € (solo il tavolo 1: 16 + 4 coperto): ' + kpi);
const pag = await p.getByText('Proforma (non incassati)').locator('xpath=following-sibling::dd[1]').innerText();
if (!/^1 · /.test(pag)) throw new Error('atteso 1 proforma: ' + pag);
await p.getByText(/Famiglia · Zia Anna/).waitFor();
await p.screenshot({ path: `${OUT}/A06-riepilogo-proforma.png`, fullPage: true });
passo('riepilogo: incasso solo del conto pagato, proforma a parte');

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
