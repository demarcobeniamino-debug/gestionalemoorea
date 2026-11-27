// Prova end-to-end: banco veloce (passante, asporto con nome) e tavoli uniti (da sala e dal menu del tavolo).
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const MOBILE = process.argv[4] === 'mobile';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const passo = (t) => console.log('·', t);
const p = await browser.newPage(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 820 } });
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
const pin = async (c, dove = p) => { for (const x of c) await dove.getByRole('button', { name: x, exact: true }).click(); };
const foglio = () => p.locator('dialog[open]');
const pre = MOBILE ? 'M' : 'B';

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('9999');
await p.waitForURL(/#\/sala/);

// passante al banco: due cozze, incassa con carta
await p.getByRole('button', { name: /^Banco \/ Asporto/ }).click();
await p.screenshot({ path: `${OUT}/${pre}01-banco.png` });
await foglio().getByRole('button', { name: 'Banco', exact: true }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('heading', { name: 'Banco' }).waitFor();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Cozze Indiavolate/ }).click();
await p.getByRole('button', { name: /^Cozze Indiavolate/ }).click();
await p.screenshot({ path: `${OUT}/${pre}02-banco-comanda.png` });
await p.getByRole('button', { name: /^Incassa/ }).first().click();
await p.waitForURL(/#\/conto\//);
await p.getByRole('heading', { name: /Conto · Banco/ }).waitFor();
await p.getByRole('radio', { name: /Carta/ }).click();
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 5000 });
passo('banco: aperto, 2 cozze, incassato con carta in 4 tocchi');

// asporto con nome: resta in sospeso e si riprende dal chip
await p.getByRole('button', { name: /^Banco \/ Asporto/ }).click();
await foglio().getByLabel('Nome del cliente').fill('Luca');
await foglio().getByRole('button', { name: 'Asporto', exact: true }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('heading', { name: 'Asporto · Luca' }).waitFor();
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
await p.getByRole('link', { name: 'Indietro' }).click();
await p.waitForURL(/#\/sala/);
await p.getByRole('button', { name: /Asporto · Luca/ }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('link', { name: 'Indietro' }).click();
passo('asporto con nome: si riprende dalla sala');

// unisci 2 + 4 dalla sala, prima di aprire
await p.getByRole('button', { name: 'Unisci tavoli' }).click();
await p.getByRole('button', { name: /^Tavolo 2, libero/ }).click();
await p.getByRole('button', { name: /^Tavolo 4, libero/ }).click();
await p.screenshot({ path: `${OUT}/${pre}03-unisci-sala.png` });
await p.getByRole('button', { name: 'Apri insieme' }).click();
await foglio().getByRole('heading', { name: 'Apri i tavoli 2 + 4' }).waitFor();
await foglio().getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.waitForURL(/#\/comanda\//);
await p.locator('h1', { hasText: /^Tavoli 2\+4$/ }).waitFor();
passo('unisci dalla sala: conto "Tavoli 2+4"');

// dal menu del tavolo: aggiungo l'8, poi lo separo
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await foglio().getByRole('button', { name: /Unisci tavoli/ }).click();
await foglio().getByRole('button', { name: /^Tavolo 8,/ }).click();
await foglio().getByRole('button', { name: 'Unisci 2 + 4 + 8' }).click();
await p.locator('h1', { hasText: /^Tavoli 2\+4\+8$/ }).waitFor();
await p.getByRole('link', { name: 'Indietro' }).click();
await p.waitForURL(/#\/sala/);
await p.getByRole('button', { name: 'Tavolo 8, unito al tavolo 2' }).waitFor();
await p.screenshot({ path: `${OUT}/${pre}04-sala-uniti.png` });
await p.getByRole('button', { name: 'Tavolo 8, unito al tavolo 2' }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await foglio().getByRole('button', { name: 'Separa il tavolo 8' }).click();
await p.keyboard.press('Escape');
await p.locator('h1', { hasText: /^Tavoli 2\+4$/ }).waitFor();
await p.getByRole('link', { name: 'Indietro' }).click();
await p.getByRole('button', { name: /^Tavolo 8, libero/ }).waitFor();
passo('unisci dal tavolo (+8), il tavolo 8 porta al conto, poi separato e libero');

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
