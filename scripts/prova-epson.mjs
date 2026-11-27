// Prova end-to-end: collaudo guidato dell'RT (demo, registratore simulato) e stato del registratore in Cassa.
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

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('9999');
await p.waitForURL(/#\/sala/);
await p.goto(URL + '/#/gestione/stampanti');
await p.getByRole('button', { name: 'Collaudo RT' }).click();
await foglio().getByRole('button', { name: 'Leggi lo stato' }).click();
await foglio().getByText('Il registratore risponde.').waitFor();
await foglio().getByRole('button', { name: 'Stampa la prova' }).click();
await foglio().getByText(/COLLAUDO CASSA/).waitFor();
await foglio().getByRole('button', { name: 'Emetti lo scontrino' }).click();
await foglio().getByRole('button', { name: 'Emetti 0,10 €' }).click();
await p.getByText(/Scontrino emesso: n\. \d+-\d{4}/).waitFor({ timeout: 15000 });
await foglio().getByRole('button', { name: 'Annulla lo scontrino' }).click();
await p.getByText(/Annullo emesso/).waitFor({ timeout: 15000 });
await p.screenshot({ path: `${OUT}/E01-collaudo.png` });
passo('collaudo: stato, non fiscale, scontrino 0,10 €, annullo');
await p.keyboard.press('Escape');

await p.goto(URL + '/#/cassa?scheda=invii');
await p.getByRole('region', { name: 'Stato del registratore' }).getByText('Tutto in ordine.').waitFor({ timeout: 10000 });
await p.screenshot({ path: `${OUT}/E02-stato-rt.png`, fullPage: true });
passo('cassa: stato del registratore letto dal battito');

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
