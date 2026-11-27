// Collaudo guidato del registratore Epson RT, da fare a locale chiuso dalla cassa (10 minuti):
// stato e invii all'Agenzia, orologio, stampa non fiscale, scontrino vero da 0,10 €, suo annullo, poi la Z dalla Cassa.
// Ogni passo dice cosa controllare sulla carta. Lo scontrino di prova passa dallo stesso percorso di un conto vero.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Circle, Warning, XCircle } from '@phosphor-icons/react';
import { avvisiRt, leggiStato, urlFpMate, xmlImpostaData, xmlLeggiData, xmlStampaNonFiscale, xmlStato, type StampanteRiga, type StatoRt } from '@gr/core';
import { nuovaChiave, useApp } from '../../dati/contesto';
import { creaTrasporto, inTauri } from '../../dati/trasporto';
import { Foglio, Pulsante } from '../../ui/primitivi';

type Esito = { ok: boolean; testo: string } | undefined;

export function CollaudoRt({ rt, onChiudi }: { rt: StampanteRiga; onChiudi: () => void }) {
  const { db, modalita, simulato, operatore } = useApp();
  const possibile = inTauri() || modalita === 'demo';
  const [stato, setStato] = useState<StatoRt | null>(null);
  const [esiti, setEsiti] = useState<Record<string, Esito>>({});
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [docProva, setDocProva] = useState<string | null>(null);

  const trasporto = () => simulato ?? creaTrasporto().trasporto;
  const url = urlFpMate({ host: rt.host, timeoutMs: 8000 });
  const passo = async (k: string, f: () => Promise<string>) => {
    setInCorso(k);
    try { setEsiti((e) => ({ ...e, [k]: { ok: true, testo: '' } })); const t = await f(); setEsiti((e) => ({ ...e, [k]: { ok: true, testo: t } })); }
    catch (e) { setEsiti((x) => ({ ...x, [k]: { ok: false, testo: typeof e === 'string' ? e : (e as Error).message } })); }
    finally { setInCorso(null); }
  };

  const leggi = () => passo('stato', async () => {
    let s: StatoRt = { letto: new Date().toISOString() };
    s = leggiStato(await trasporto().postXml(url, xmlStato(0), 10000), s);
    s = leggiStato(await trasporto().postXml(url, xmlStato(1), 10000), s);
    s = leggiStato(await trasporto().postXml(url, xmlLeggiData(), 10000), s);
    setStato(s);
    const gravi = avvisiRt(s).filter((a) => a.livello === 'errore');
    if (gravi.length) throw new Error(gravi.map((a) => a.testo).join(' '));
    return 'Il registratore risponde.';
  });

  const allinea = () => passo('orologio', async () => {
    await trasporto().postXml(url, xmlImpostaData(new Date()), 10000);
    const s = leggiStato(await trasporto().postXml(url, xmlLeggiData(), 10000), stato ?? { letto: new Date().toISOString() });
    setStato(s);
    return `Orologio impostato: ${new Date(s.orologio!).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`;
  });

  const nonFiscale = () => passo('nonfiscale', async () => {
    await trasporto().postXml(url, xmlStampaNonFiscale(['COLLAUDO CASSA', 'Stampa non fiscale di prova', new Date().toLocaleString('it-IT')]), 10000);
    return 'Inviata: deve uscire un foglietto "COLLAUDO CASSA" senza valore fiscale.';
  });

  /** Aspetta che il documento esca (o vada in errore) dalla coda della cassa. */
  const attendi = async (id: string, comandaId: string) => {
    for (let i = 0; i < 60; i++) {
      const d = db.documenti(comandaId).find((x) => x.id === id);
      if (d && d.stato !== 'in_emissione') return d;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Nessuna risposta dopo 30 secondi: guarda la carta e la scheda Cassa → Invio scontrini.');
  };

  const scontrino = () => passo('scontrino', async () => {
    if (!operatore) throw new Error('Entra con il tuo PIN');
    const iva = db.setup().aliquote.find((a) => a.percentuale === 22) ?? db.setup().aliquote[0];
    const c = await db.apriBanco('banco', 'Collaudo RT', operatore);
    await db.aggiungiRiga(c.id, { libera: { descrizione: 'PROVA COLLAUDO', prezzoCents: 10, centroId: null, aliquotaIvaId: iva.id } });
    await db.invia(c.id, nuovaChiave(), operatore);
    const doc = await db.incassa(c.id, { pagamenti: [{ tipo: 'contanti', importoCents: 10 }] }, nuovaChiave(), operatore);
    const d = await attendi(doc.id, c.id);
    if (d.stato !== 'emesso') throw new Error(d.errore ?? `Scontrino ${d.stato}`);
    setDocProva(d.id);
    return `Scontrino emesso: n. ${d.rtZNumero ?? '?'}-${String(d.rtDocNumero ?? '?').padStart(4, '0')} del ${d.rtData ?? 'oggi'}. Controlla che la carta riporti lo stesso numero.`;
  });

  const annullo = () => passo('annullo', async () => {
    if (!docProva) throw new Error('Prima fai lo scontrino di prova');
    await db.annullaDocumento(docProva, nuovaChiave(), operatore ?? undefined);
    for (let i = 0; i < 60; i++) {
      const a = db.lavori().filter((j) => j.tipo === 'annullo').at(-1);
      if (a && a.stato === 'stampato') return 'Annullo emesso: deve uscire un documento di annullo con il riferimento allo scontrino di prova.';
      if (a && (a.stato === 'errore' || a.stato === 'da_verificare')) throw new Error(a.errore ?? 'Annullo non riuscito');
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Nessuna risposta dopo 30 secondi.');
  });

  const avvisi = stato ? avvisiRt(stato) : [];
  const diffMin = stato?.orologio ? Math.round((new Date(stato.orologio).getTime() - Date.now()) / 60000) : null;

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={`Collaudo · ${rt.nome}`}>
      {!possibile ? (
        <p className="text-base text-text-muted">Il collaudo si fa dall’app Cassa installata sul computer del locale, collegato alla stessa rete del registratore.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          <Passo n={1} titolo="Stato del registratore" esito={esiti.stato} inCorso={inCorso === 'stato'} azione="Leggi lo stato" onClick={() => void leggi()}
            testo="Carta, giornale elettronico, giornata, invii all’Agenzia, certificati. Non stampa niente.">
            {stato && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {avvisi.length === 0 ? <li className="text-success">Nessun problema.</li> : avvisi.map((a) => (
                  <li key={a.testo} className={a.livello === 'errore' ? 'font-semibold text-danger' : a.livello === 'attenzione' ? 'text-warning' : 'text-text-muted'}>{a.testo}</li>
                ))}
                <li className="text-text-muted">Firmware {stato.firmware ?? '?'} · giornata {stato.giornataAperta ? 'aperta' : 'chiusa'} · {stato.fileDaInviare ?? 0} invii in attesa · {stato.fileRifiutati ?? 0} rifiutati</li>
              </ul>
            )}
          </Passo>

          <Passo n={2} titolo="Orologio" esito={esiti.orologio} inCorso={inCorso === 'orologio'} azione="Allinea all’ora del computer"
            disabled={!stato || stato.giornataAperta !== false}
            conferma={{ testo: 'Imposto data e ora del registratore uguali a quelle di questo computer. Controlla prima che l’ora del computer sia giusta.', azione: 'Imposta' }}
            onClick={() => void allinea()}
            testo={diffMin === null ? 'Prima leggi lo stato.' : Math.abs(diffMin) < 2 ? 'L’orologio del registratore è giusto.' : `Il registratore è ${diffMin > 0 ? 'avanti' : 'indietro'} di ${Math.abs(diffMin)} minuti. ${stato?.giornataAperta ? 'Si può correggere solo a giornata chiusa: fai prima la Z (passo 6).' : 'Puoi correggerlo adesso.'}`} />

          <Passo n={3} titolo="Stampa non fiscale" esito={esiti.nonfiscale} inCorso={inCorso === 'nonfiscale'} azione="Stampa la prova" onClick={() => void nonFiscale()}
            testo="Esce un foglietto senza valore fiscale: conferma che la cassa parla con il registratore." />

          <Passo n={4} titolo="Scontrino vero da 0,10 €" esito={esiti.scontrino} inCorso={inCorso === 'scontrino'} azione="Emetti lo scontrino"
            disabled={!!docProva}
            conferma={{ testo: 'È un vero documento commerciale da 0,10 € in contanti: va all’Agenzia delle Entrate. Subito dopo lo annulliamo (passo 5).', azione: 'Emetti 0,10 €' }}
            onClick={() => void scontrino()}
            testo="Fa lo stesso percorso di un conto vero (banco → incasso → registratore) e legge numero e Z dalla risposta." />

          <Passo n={5} titolo="Annullo dello scontrino di prova" esito={esiti.annullo} inCorso={inCorso === 'annullo'} azione="Annulla lo scontrino"
            disabled={!docProva || esiti.annullo?.ok === true}
            onClick={() => void annullo()}
            testo="Il registratore cerca lo scontrino originale (Z, numero, data, matricola) e stampa il documento di annullo." />

          <li className="rounded-lg border border-border p-4">
            <p className="font-semibold">6 · Chiusura giornaliera (Z)</p>
            <p className="mt-1 text-sm text-text-muted">Chiude la giornata di prova e manda i dati all’Agenzia. Dalla Cassa: “Chiusura fiscale”. Dopo la Z puoi correggere l’orologio (passo 2).</p>
            <Link to="/cassa" className="premibile mt-3 inline-flex h-touch items-center rounded-md bg-surface-2 px-4 font-semibold">Vai alla Cassa</Link>
          </li>
        </ol>
      )}
    </Foglio>
  );
}

function Passo({ n, titolo, testo, esito, inCorso, azione, onClick, disabled, children, conferma }: {
  n: number; titolo: string; testo: string; esito: Esito; inCorso: boolean; azione: string; onClick: () => void; disabled?: boolean; children?: React.ReactNode;
  /** Chiede conferma sul posto (niente fogli sopra il foglio). */
  conferma?: { testo: string; azione: string };
}) {
  const [chiedi, setChiedi] = useState(false);
  const icona = inCorso ? <Circle size={22} weight="bold" className="animate-pulse text-accent" aria-hidden />
    : !esito ? <Circle size={22} weight="bold" className="text-text-muted" aria-hidden />
    : esito.ok ? <CheckCircle size={22} weight="fill" className="text-success" aria-hidden />
    : <XCircle size={22} weight="fill" className="text-danger" aria-hidden />;
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        {icona}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{n} · {titolo}</p>
          <p className="mt-1 text-sm text-text-muted">{testo}</p>
          {esito?.testo && <p className={`mt-2 flex gap-1.5 text-sm font-semibold ${esito.ok ? 'text-success' : 'text-danger'}`}>{!esito.ok && <Warning size={16} weight="fill" aria-hidden className="mt-0.5 flex-none" />}{esito.testo}</p>}
          {children}
        </div>
        {!chiedi && <Pulsante taglia="md" disabled={disabled || inCorso} caricamento={inCorso} onClick={() => (conferma ? setChiedi(true) : onClick())}>{azione}</Pulsante>}
      </div>
      {chiedi && conferma && (
        <div role="alertdialog" aria-label={`Conferma: ${titolo}`} className="mt-3 rounded-md border border-warning bg-bg p-3">
          <p className="mb-3 text-sm">{conferma.testo}</p>
          <div className="flex justify-end gap-2">
            <Pulsante taglia="md" onClick={() => setChiedi(false)}>Annulla</Pulsante>
            <Pulsante taglia="md" variante="pericolo" onClick={() => { setChiedi(false); onClick(); }}>{conferma.azione}</Pulsante>
          </div>
        </div>
      )}
    </li>
  );
}
