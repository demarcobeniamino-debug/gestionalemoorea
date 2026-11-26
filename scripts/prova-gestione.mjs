// Prova end-to-end del pannello Gestione nella demo. Salva screenshot.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
p.on('pageerror', (e) => errori.push(String(e)));
const passo = (s) => console.log('·', s);

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();

// Un cameriere non vede la Gestione
for (const c of '1111') await p.getByRole('button', { name: c, exact: true }).click();
await p.waitForURL(/#\/sala/);
if (await p.getByRole('link', { name: 'Gestione' }).count()) throw new Error('il cameriere vede la Gestione');
await p.goto(URL + '/#/gestione/articoli');
await p.getByText('Solo per i responsabili').waitFor();
passo('cameriere: Gestione bloccata');

// Benny (responsabile)
await p.goto(URL + '/#/accesso');
for (const c of '9999') await p.getByRole('button', { name: c, exact: true }).click();
await p.waitForURL(/#\/sala/);
await p.getByRole('link', { name: 'Gestione' }).click();
await p.waitForURL(/#\/gestione\/articoli/);
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/G01-articoli.png` });

// Nuovo articolo con prezzo, allergeni, variante e ricetta
await p.getByRole('button', { name: 'Nuovo articolo' }).click();
const d = p.locator('dialog[open]');
await d.getByLabel('Nome', { exact: true }).fill('Scialatielli ai frutti di mare');
await d.getByLabel('Prezzo').fill('22,5');
await d.getByLabel('Prezzo').blur();
await d.getByLabel('Categoria').selectOption({ label: 'Primi' });
await d.getByRole('button', { name: 'Glutine', exact: true }).click();
await d.getByRole('button', { name: 'Molluschi', exact: true }).click();
await d.getByRole('button', { name: /pasta senza glutine/ }).click();
await d.getByLabel('Aggiungi un ingrediente').selectOption({ label: 'Pecorino romano DOP (kg)' });
await d.getByLabel('Quantità netta').fill('0,05');
await d.getByLabel('Quantità netta').blur();
await p.waitForTimeout(200);
await p.screenshot({ path: `${OUT}/G02-editor-articolo.png` });
await d.getByRole('button', { name: 'Salva' }).click();
await p.getByText('Articolo aggiunto al menu').waitFor();
await p.getByRole('button', { name: /Scialatielli ai frutti di mare/ }).waitFor();
passo('articolo creato');

// Categoria nuova
await p.getByRole('link', { name: 'Categorie' }).click();
await p.getByRole('button', { name: 'Nuova categoria' }).click();
await p.locator('dialog[open]').getByLabel('Nome').fill('Crudi');
await p.locator('dialog[open]').getByRole('button', { name: 'Salva' }).click();
await p.getByText('Categoria creata').waitFor();
await p.screenshot({ path: `${OUT}/G03-categorie.png` });
passo('categoria creata');

// Sale e tavoli: aggiungi un tavolo e trascinalo
await p.getByRole('link', { name: 'Sale e tavoli' }).click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: 'Aggiungi tavolo' }).click();
const ed = p.locator('dialog[open]');
await ed.waitFor();
await ed.getByLabel('Posti').fill('6');
await ed.getByLabel('Posti').blur();
await ed.getByRole('button', { name: 'Salva' }).click();
await p.getByText('Tavolo salvato').waitFor();
const t13 = p.getByRole('button', { name: /^Tavolo 25, 6 posti/ });
const box = await t13.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 300, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(400);
const box2 = await t13.boundingBox();
if (Math.abs(box2.y - box.y) < 100) throw new Error('il tavolo non si è spostato');
await p.screenshot({ path: `${OUT}/G04-sale-tavoli.png` });
passo('tavolo aggiunto e spostato');

// Magazzino: carico merce
await p.getByRole('link', { name: 'Scorte' }).click();
await p.screenshot({ path: `${OUT}/G05-scorte.png` });
await p.getByRole('button', { name: 'Carico merce' }).click();
const mv = p.locator('dialog[open]');
await mv.getByLabel('Fornitore').selectOption({ label: 'Caseificio dei Monti Lattari' });
await mv.getByLabel('Bolla o fattura n.').fill('DDT 418');
await mv.getByLabel('Aggiungi un prodotto').selectOption({ label: 'Pecorino romano DOP' });
await mv.getByLabel('Quantità').fill('4');
await mv.getByLabel('Quantità').blur();
await p.screenshot({ path: `${OUT}/G06-carico.png` });
await mv.getByRole('button', { name: 'Registra carico' }).click();
await p.getByText('Carico registrato').waitFor();
await p.getByText('5,2').first().waitFor();
passo('carico registrato: pecorino 1,2 → 5,2 kg');

await p.getByRole('link', { name: 'Movimenti' }).click();
await p.screenshot({ path: `${OUT}/G07-movimenti.png` });

// Il nuovo piatto compare in comanda col prezzo giusto
await p.goto(URL + '/#/sala');
await p.getByRole('button', { name: /^Tavolo 3, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('button', { name: 'Primi', exact: true }).first().click();
await p.getByRole('button', { name: /Scialatielli ai frutti di mare/ }).first().waitFor();
await p.screenshot({ path: `${OUT}/G08-comanda-nuovo-piatto.png` });
passo('nuovo piatto in comanda');

// Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', (e) => errori.push(String(e)));
await m.goto(URL + '/#/accesso');
await m.getByRole('button', { name: 'Prova la demo, senza account' }).click();
for (const c of '9999') await m.getByRole('button', { name: c, exact: true }).click();
await m.waitForURL(/#\/sala/);
await m.goto(URL + '/#/gestione/articoli');
await m.waitForTimeout(300);
await m.screenshot({ path: `${OUT}/G09-mobile-articoli.png` });
await m.goto(URL + '/#/gestione/magazzino');
await m.waitForTimeout(300);
await m.screenshot({ path: `${OUT}/G10-mobile-scorte.png` });

console.log(errori.length ? 'ERRORI:\n' + errori.join('\n') : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
