// Prova end-to-end del servizio completo (demo): sposta tavolo, sconto con PIN del responsabile,
// cassa e statistiche, annullo scontrino, chiusura fiscale, personale.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const passo = (t) => console.log('·', t);
const p = await browser.newPage({ viewport: { width: 1366, height: 820 } });
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
const pin = async (c) => { for (const x of c) await p.getByRole('button', { name: x, exact: true }).click(); };

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('1111');
await p.waitForURL(/#\/sala/);
if (await p.getByRole('link', { name: 'Cassa' }).count()) throw new Error('il cameriere vede la Cassa');

// apri tavolo 2, due piatti, invia
await p.getByRole('button', { name: /^Tavolo 2, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Cozze Indiavolate/ }).click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
await p.getByRole('button', { name: /^Invia \(2\)/ }).click();
await p.waitForTimeout(600);

// sposta sul tavolo 9
await p.getByRole('button', { name: 'Sposta, unisci o dividi il tavolo' }).click();
await p.getByRole('button', { name: /Sposta tavolo/ }).click();
await p.locator('dialog[open]').getByRole('button', { name: /^Tavolo 9, / }).click();
await p.getByRole('heading', { name: /Tavolo 9/ }).first().waitFor();
await p.screenshot({ path: `${OUT}/V01-spostato.png` });
passo('tavolo spostato 2 → 9');

// conto con sconto 10%: il cameriere deve far mettere il PIN al responsabile
await p.getByRole('button', { name: 'Conto', exact: true }).click();
await p.waitForURL(/#\/conto\//);
await p.getByRole('button', { name: 'Sconto', exact: true }).click();
await p.getByRole('button', { name: '10%' }).click();
const sc = p.locator('dialog[open]');
for (const x of '9999') await sc.getByRole('button', { name: x, exact: true }).click();
await p.screenshot({ path: `${OUT}/V02-sconto.png` });
await sc.getByRole('button', { name: 'Applica sconto' }).click();
await p.getByText(/Sconto 10%/).first().waitFor();
await p.getByRole('button', { name: 'Importo esatto' }).click();
await p.screenshot({ path: `${OUT}/V03-conto-scontato.png` });
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 5000 });
passo('incassato con sconto');

// entra il responsabile
await p.getByRole('button', { name: /Esci|Cambia operatore/ }).first().click().catch(() => p.goto(URL + '/#/accesso'));
await p.waitForURL(/#\/accesso/);
await pin('9999');
await p.waitForURL(/#\/sala/);
await p.getByRole('link', { name: 'Cassa' }).click();
await p.waitForURL(/#\/cassa/);
await p.getByText('Incasso', { exact: true }).waitFor();
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/V04-cassa.png`, fullPage: true });
const kpi = await p.getByRole('region', { name: 'Numeri principali' }).innerText();
if (!/34,20/.test(kpi)) throw new Error('incasso atteso 34,20 € (34 + 4 coperto − 10%), trovato: ' + kpi);
passo('cassa: incasso 34,20 €');

// annulla lo scontrino
await p.getByRole('button', { name: 'Annulla', exact: true }).first().click();
await p.locator('dialog[open]').getByRole('button', { name: /^Sì, annulla/ }).click();
await p.getByText('Annullo inviato alla cassa').waitFor();
await p.waitForTimeout(2500);
const kpi2 = await p.getByRole('region', { name: 'Numeri principali' }).innerText();
if (!/€\s*0,00/.test(kpi2.split('Coperti')[0])) throw new Error('dopo l\'annullo l\'incasso deve tornare a 0: ' + kpi2);
await p.screenshot({ path: `${OUT}/V05-annullato.png`, fullPage: true });
passo('scontrino annullato');

// chiusura fiscale
await p.getByRole('button', { name: 'Chiusura fiscale' }).click();
await p.screenshot({ path: `${OUT}/V06-chiusura.png` });
await p.locator('dialog[open]').getByRole('button', { name: 'Chiudi la giornata' }).click();
await p.getByText('Chiusura inviata alla cassa').waitFor();
passo('chiusura fiscale inviata');

// periodo 7 giorni
await p.getByRole('radio', { name: '7 giorni' }).click().catch(() => p.getByRole('button', { name: '7 giorni' }).click());
await p.waitForTimeout(300);

// personale: nuova persona, PIN doppio rifiutato
await p.goto(URL + '/#/gestione/personale');
await p.getByRole('button', { name: 'Nuova persona' }).click();
const fo = p.locator('dialog[open]');
await fo.getByLabel('Nome').fill('Valentina');
await fo.getByLabel('PIN').fill('1111');
await fo.getByRole('button', { name: 'Salva' }).click();
await p.getByText(/PIN.*(usato|già)/i).first().waitFor();
await fo.getByLabel('PIN').fill('4321');
await fo.getByRole('button', { name: 'Salva' }).click();
await p.getByText('Persona aggiunta').waitFor();
await p.getByRole('button', { name: /Valentina/ }).waitFor();
await p.screenshot({ path: `${OUT}/V07-personale.png` });
passo('personale: PIN doppio rifiutato, Valentina aggiunta');

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
