// Prova end-to-end delle prenotazioni (demo): tavolo prenotato, apertura dalla prenotazione, no show.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const p = await browser.newPage({ viewport: { width: 1366, height: 820 } });
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
for (const c of '1111') await p.getByRole('button', { name: c, exact: true }).click();
await p.waitForURL(/#\/sala/);
await p.getByRole('button', { name: /^Tavolo 5, prenotato alle .* per Rossi, 4 persone/ }).waitFor();
await p.getByRole('tab', { name: /Prenotazioni · 4/ }).click();
await p.screenshot({ path: `${OUT}/P01-sala-prenotazioni.png` });

// No show per Esposito (in ritardo di 20 minuti)
await p.getByRole('button', { name: 'Esposito non si è presentato' }).click();
await p.locator('dialog[open]').getByRole('button', { name: 'Non si è presentato' }).click();
await p.getByText('Segnato come non presentato').waitFor();
await p.getByRole('tab', { name: /Prenotazioni · 3/ }).waitFor();

// Bianchi senza tavolo: scelgo il tavolo in sala
await p.getByRole('button', { name: /Bianchi · 2/ }).click();
await p.getByText('Tocca un tavolo libero per Bianchi (2)').waitFor();
await p.getByRole('button', { name: /^Tavolo 8, libero/ }).click();
await p.locator('dialog[open]').getByRole('button', { name: 'Apri per Bianchi' }).waitFor();
await p.locator('dialog[open]').getByRole('button', { name: 'Chiudi' }).click();

// Rossi dal tavolo prenotato: allergie in comanda
await p.getByRole('button', { name: /^Tavolo 5, prenotato/ }).click();
const d = p.locator('dialog[open]');
await d.getByText('vanno sulla comanda').waitFor();
await p.screenshot({ path: `${OUT}/P02-apri-da-prenotazione.png` });
await d.getByRole('button', { name: 'Apri per Rossi' }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByText(/glutine/i).first().waitFor();
await p.screenshot({ path: `${OUT}/P03-comanda-rossi.png` });
console.log('· tavolo prenotato, no show, scelta tavolo, apertura con allergie');

// Palmare: elenco dal pulsante
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', (e) => errori.push(String(e)));
await m.goto(URL + '/#/accesso');
await m.getByRole('button', { name: 'Prova la demo, senza account' }).click();
for (const c of '1111') await m.getByRole('button', { name: c, exact: true }).click();
await m.waitForURL(/#\/sala/);
await m.getByRole('navigation', { name: 'Azioni rapide' }).getByRole('button', { name: /Prenotati/ }).click();
await m.getByRole('dialog', { name: 'Prenotazioni di oggi' }).or(m.locator('dialog[open]')).first().waitFor();
await m.waitForTimeout(400);
await m.screenshot({ path: `${OUT}/P04-palmare-prenotazioni.png` });

console.log(errori.length ? 'ERRORI:\n' + errori.join('\n') : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
