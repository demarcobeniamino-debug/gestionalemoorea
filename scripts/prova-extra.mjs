// Prova end-to-end v0.7 (demo): voce libera, quantità rapide, marcia e sollecito, messaggi, cliente al tavolo,
// monitor cucina con avvisi, dati fiscali, fattura elettronica dalla cassa.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'screens';
const URL = process.argv[3] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errori = [];
const passo = (t) => console.log('·', t);
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => errori.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
const pin = async (c) => { for (const x of c) await p.getByRole('button', { name: x, exact: true }).click(); };
const foglio = () => p.locator('dialog[open]');

await p.goto(URL + '/#/accesso');
await p.getByRole('button', { name: 'Prova la demo, senza account' }).click();
await pin('9999');
await p.waitForURL(/#\/sala/);

// dati fiscali del locale
await p.goto(URL + '/#/gestione/fatture');
await p.getByLabel('Ragione sociale').fill('Moorea S.r.l.');
await p.getByLabel('Partita IVA').fill('01234567890');
await p.getByLabel('Via', { exact: true }).fill('Lungomare Amendola');
await p.getByLabel('Civico').fill('1');
await p.getByLabel('CAP').fill('84010');
await p.getByLabel('Comune').fill('Maiori');
await p.getByLabel('Provincia').fill('SA');
await p.getByRole('button', { name: 'Salva dati fiscali' }).click();
await p.getByText('Dati fiscali salvati').waitFor();
passo('dati fiscali del locale');

// tavolo 3
await p.goto(URL + '/#/sala');
await p.getByRole('button', { name: /^Tavolo 3, libero/ }).click();
await p.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await p.waitForURL(/#\/comanda\//);

// ×3 Polpo, poi +1 e −1 sulla riga
await p.getByRole('button', { name: 'Antipasti', exact: true }).first().click();
await p.getByRole('radio', { name: '×3' }).click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
await p.getByRole('button', { name: /^Polpo Scottato/ }).click();
const riga = p.getByRole('button', { name: /^4 Polpo Scottato/ });
await riga.waitFor();
await p.getByRole('button', { name: 'Uno in meno: Polpo Scottato' }).click();
await p.getByRole('button', { name: /^3 Polpo Scottato/ }).waitFor();
passo('quantità: ×3 + tocco = 4, poi meno uno = 3');

// voce libera dalla ricerca
await p.getByPlaceholder('Cerca piatto').fill('pasta al pomodoro');
await p.getByRole('button', { name: /^Voce libera/ }).click();
await foglio().getByLabel('Prezzo').fill('12');
await foglio().getByLabel('Prezzo').blur();
await foglio().getByRole('radio', { name: '2ª' }).click();
await p.screenshot({ path: `${OUT}/X01-voce-libera.png` });
await foglio().getByRole('button', { name: /^Aggiungi/ }).click();
await p.getByText('Pasta al pomodoro aggiunto').waitFor();
await p.getByPlaceholder('Cerca piatto').fill('');
passo('voce libera "Pasta al pomodoro" 12 € in 2ª portata');

// invio
await p.getByRole('button', { name: /^Invia \(2\)/ }).click();
await p.waitForTimeout(700);

// cliente nuovo con allergia → allergia al tavolo
await p.getByRole('button', { name: 'Collega un cliente' }).click();
await foglio().getByRole('button', { name: 'Nuovo' }).click();
const ed = foglio();
await ed.getByLabel('Nome', { exact: true }).fill('Giulia');
await ed.getByLabel('Cognome').fill('Esposito');
await ed.getByLabel('Telefono').fill('+39 333 1234567');
await ed.getByRole('button', { name: 'Glutine', exact: true }).click();
await ed.getByLabel('Codice fiscale').fill('SPSGLI90A41F839X');
await ed.getByLabel('Via e numero').fill('Via Roma, 12');
await ed.getByLabel('CAP').fill('84010');
await ed.getByLabel('Comune').fill('Maiori');
await ed.getByLabel('Provincia (sigla)').fill('SA');
await p.screenshot({ path: `${OUT}/X02-cliente.png` });
await ed.getByRole('button', { name: 'Salva' }).click();
await p.getByText('Giulia Esposito collegato al conto').waitFor();
await p.keyboard.press('Escape');
await p.getByRole('button', { name: /^Allergie \(1\)/ }).waitFor();
passo('cliente creato, collegato, allergia glutine portata al tavolo');

// marcia della 2ª portata
await p.getByRole('button', { name: 'Marcia 2ª portata' }).click();
await p.getByText(/Marcia 2ª portata inviato/).waitFor();
await p.getByRole('button', { name: 'Sollecita 1ª portata' }).click();
await p.getByText(/Sollecito 1ª portata inviato/).waitFor();
await p.screenshot({ path: `${OUT}/X03-comanda.png` });
passo('marcia 2ª e sollecito 1ª');

// messaggio libero
await p.getByRole('button', { name: 'Messaggio ai reparti' }).click();
await foglio().getByRole('button', { name: 'Ospite allergico: chiamatemi' }).click();
await p.getByText(/Messaggio inviato a/).waitFor();
passo('messaggio con frase pronta');

// monitor cucina: avvisi e "visto"
await p.goto(URL + '/#/cucina');
await p.getByRole('region', { name: 'Messaggi dalla sala' }).waitFor();
await p.screenshot({ path: `${OUT}/X04-cucina.png` });
const prima = await p.getByRole('region', { name: 'Messaggi dalla sala' }).getByRole('button').count();
await p.getByRole('region', { name: 'Messaggi dalla sala' }).getByRole('button').first().click();
await p.waitForTimeout(300);
const dopo = await p.getByRole('region', { name: 'Messaggi dalla sala' }).getByRole('button').count().catch(() => 0);
if (!(dopo < prima)) throw new Error(`il messaggio visto non sparisce (${prima} → ${dopo})`);
passo(`cucina: ${prima} avvisi, uno segnato visto`);

// conto e scontrino
await p.goBack();
await p.waitForURL(/#\/comanda\//);
await p.getByRole('button', { name: 'Conto', exact: true }).click();
await p.waitForURL(/#\/conto\//);
await p.getByRole('button', { name: 'Importo esatto' }).click();
await p.getByRole('button', { name: /Incassa e stampa scontrino/ }).click();
await p.waitForURL(/#\/sala/, { timeout: 5000 });

// fattura dalla cassa
await p.getByRole('link', { name: 'Cassa' }).click();
await p.getByRole('button', { name: 'Fattura', exact: true }).first().click();
await foglio().getByText('Giulia Esposito').waitFor();
await p.screenshot({ path: `${OUT}/X05-fattura.png` });
await foglio().getByRole('button', { name: /^Crea fattura/ }).click();
await p.getByRole('heading', { name: /Fattura n\. 1\// }).waitFor();
const [dl] = await Promise.all([p.waitForEvent('download'), foglio().getByRole('button', { name: 'Scarica XML' }).click()]);
const percorso = await dl.path();
const xml = (await import('node:fs')).readFileSync(percorso, 'utf8');
if (!/<Numero>1<\/Numero>/.test(xml) || !/SPSGLI90A41F839X/.test(xml) || !/Pasta al pomodoro/.test(xml)) throw new Error('XML della fattura incompleto');
console.log('  file:', dl.suggestedFilename());
await foglio().getByRole('button', { name: 'Copia di cortesia' }).click();
await p.getByText('Copia di cortesia in stampa').waitFor();
await p.screenshot({ path: `${OUT}/X06-fattura-fatta.png` });
await foglio().getByRole('button', { name: 'Fatto' }).click();
passo('fattura n. 1 creata, XML scaricato e corretto, copia di cortesia');

// gestione: clienti e fatture
await p.goto(URL + '/#/gestione/clienti');
await p.getByRole('button', { name: /Giulia Esposito/ }).click();
await p.getByText('Visite', { exact: true }).waitFor();
await p.screenshot({ path: `${OUT}/X07-clienti.png` });
await p.goto(URL + '/#/gestione/fatture');
await p.getByText(/N\. 1\/\d{4} · Giulia Esposito/).waitFor();
await p.screenshot({ path: `${OUT}/X08-fatture.png`, fullPage: true });
passo('gestione: scheda cliente con storico, elenco fatture');

// telefono
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
await m.goto(URL + '/#/accesso');
await m.getByRole('button', { name: 'Prova la demo, senza account' }).click();
for (const c of '1111') await m.getByRole('button', { name: c, exact: true }).click();
await m.getByRole('button', { name: /^Tavolo 4, libero/ }).click();
await m.getByRole('button', { name: 'Apri e prendi la comanda' }).click();
await m.getByRole('tab', { name: 'Pasta' }).click();
await m.screenshot({ path: `${OUT}/X09-palmare.png` });

console.log(errori.length ? errori : 'Nessun errore in console');
await browser.close();
if (errori.length) process.exit(1);
