// Prova end-to-end della fetta verticale nel browser (trasporto simulato). Salva screenshot.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const pagina = async (w, h) => {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  p.on('pageerror', (e) => errori.push(String(e)));
  return p;
};
const p = await pagina(1280, 800);
await p.goto(URL + '/#/accesso');
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/S00-collegamento.png` });
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/S01-accesso.png` });
for (const c of '1111') await p.getByRole('button', { name: c, exact: true }).click();
await p.waitForURL(/#\/sala/);
await p.screenshot({ path: `${OUT}/S03-sala-vuota.png` });

// apri il 7 con 4 coperti
await p.getByRole('button', { name: /^Tavolo 7, libero/ }).click();
await p.getByRole('button', { name: 'Più coperti' }).click();
await p.getByRole('button', { name: 'Più coperti' }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.waitForURL(/#\/comanda\//);

// allergia
await p.getByRole('button', { name: /^Allergie/ }).click();
await p.getByRole('button', { name: 'Frutta a guscio', exact: true }).click();
await p.locator('dialog[open]').getByRole('button', { name: '2', exact: true }).click();
await p.getByRole('button', { name: 'Aggiungi allergie' }).click();

// antipasti, primi con variante, vino
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('button', { name: /^Vitello tonnato/ }).click();
await p.getByRole('button', { name: 'Primi', exact: true }).first().click();
await p.getByRole('button', { name: /^Paccheri alla genovese/ }).click({ button: 'right' });
await p.getByRole('button', { name: '- pecorino' }).click();
await p.locator('dialog[open]').getByRole('button', { name: '2', exact: true }).click();
await p.getByPlaceholder('es. niente noci, poco sale').fill('niente noci');
await p.locator('dialog[open]').getByRole('button', { name: /^Aggiungi/ }).click();
await p.getByRole('button', { name: /^Spaghettone cacio e pepe/ }).click();
await p.getByRole('button', { name: 'Vini', exact: true }).first().click();
await p.getByRole('button', { name: /^Primitivo Desire/ }).click();
await p.getByRole('button', { name: 'Primi', exact: true }).first().click();
await p.screenshot({ path: `${OUT}/S06-comanda-prima-invio.png` });

await p.getByRole('button', { name: /^Invia \(4\)/ }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/S06-comanda-inviata.png` });
const urlComanda = p.url();
await p.getByRole('link', { name: 'Indietro' }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/S03-sala-occupata.png` });
await p.goto(urlComanda);
await p.waitForTimeout(300);

// carta simulata
await p.getByRole('button', { name: 'Apri la carta simulata' }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/carta-comanda.png` });
await p.getByRole('dialog', { name: 'Carta simulata' }).getByRole('button', { name: 'Chiudi' }).click();

// cucina in un'altra finestra 1440x810 (stessa sessione → stessi dati? no: dati in memoria per pagina)
await p.goto(URL + '/#/cucina');
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/S11-cucina.png` });
await p.goBack();
await p.waitForURL(/#\/comanda\//);

// conto
await p.getByRole('button', { name: 'Conto', exact: true }).click();
await p.waitForURL(/#\/conto\//);
await p.getByRole('button', { name: 'Aggiungi 50 euro' }).click();
await p.getByRole('button', { name: 'Aggiungi 50 euro' }).click();
await p.screenshot({ path: `${OUT}/S15-conto.png` });
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 5000 });
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/S03-sala-dopo-incasso.png` });
const libero = await p.getByRole('button', { name: /^Tavolo 7, libero/ }).count();

// palmare
const m = await pagina(390, 844);
await m.goto(URL + '/#/accesso');
await m.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await m.waitForTimeout(300);
for (const c of '2222') await m.getByRole('button', { name: c, exact: true }).click();
await m.getByRole('button', { name: /^Tavolo 4, libero/ }).click();
await m.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await m.getByRole('tab', { name: 'Primi' }).click();
await m.getByRole('button', { name: /^Spaghettone cacio e pepe/ }).click();
await m.screenshot({ path: `${OUT}/S06-palmare.png` });

// design
const d = await pagina(1280, 900);
await d.goto(URL + '/#/accesso');
await d.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await d.goto(URL + '/#/design');
await d.screenshot({ path: `${OUT}/design.png`, fullPage: true });

console.log(JSON.stringify({ tavolo7LiberoDopoIncasso: libero === 1, errori }, null, 1));
await browser.close();
