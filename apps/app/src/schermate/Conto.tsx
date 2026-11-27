import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bank, CheckCircle, CreditCard, HandHeart, Money, Percent, Ticket, Trash, Warning } from '@phosphor-icons/react';
import { EliminaConto, Proforma } from './ChiudiSenzaIncasso';
import { calcolaConto, dividiAllaRomana, euro, importoRiga, nomeCliente, type Cliente, type Documento, type TipoPagamento } from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Icona, Pulsante, Spinner } from '../ui/primitivi';
import { CampoEuro } from '../ui/campi';

const METODI: { tipo: TipoPagamento; nome: string; icona: ReactElement }[] = [
  { tipo: 'contanti', nome: 'Contanti', icona: <Money size={22} weight="bold" aria-hidden /> },
  { tipo: 'carta', nome: 'Carta', icona: <CreditCard size={22} weight="bold" aria-hidden /> },
  { tipo: 'buono_pasto', nome: 'Buono pasto', icona: <Ticket size={22} weight="bold" aria-hidden /> },
];
const NOME_METODO: Partial<Record<TipoPagamento, string>> = { contanti: 'Contanti', carta: 'Carta', buono_pasto: 'Buono' };

// S13 + S14 + S15: conto, divisione alla romana, pagamento, scontrino dall'Epson.
export function Conto() {
  const { id = '' } = useParams();
  const { db, toast, operatore } = useApp();
  const { esegui } = useAzione();
  const nav = useNavigate();
  const { comanda, righe, documenti, setup } = useDati((d) => ({ comanda: d.comanda(id), righe: d.righe(id), documenti: d.documenti(id), setup: d.setup() }));
  const [modo, setModo] = useState<'unico' | 'romana'>('unico');
  const [persone, setPersone] = useState(Math.max(2, comanda?.coperti || 2));
  const [metodo, setMetodo] = useState<TipoPagamento>('contanti');
  const [digitato, setDigitato] = useState('');
  const [sconto, setSconto] = useState<{ cents: number; etichetta: string; da: string } | null>(null);
  const [scontoAperto, setScontoAperto] = useState(false);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [senzaIncasso, setSenzaIncasso] = useState<'proforma' | 'elimina' | null>(null);
  useEffect(() => {
    if (!comanda?.clienteId) return;
    let v = true; db.cliente(comanda.clienteId).then((c) => v && setCliente(c)).catch(() => undefined); return () => { v = false; };
  }, [comanda?.clienteId, db]);

  const conto = useMemo(() => calcolaConto(righe, comanda?.coperti ?? 0, setup.locale.copertoCents), [righe, comanda, setup]);
  const emessi = documenti.filter((d) => d.stato === 'emesso');
  const inCorso = documenti.find((d) => d.stato === 'in_emissione');
  const daVerificare = documenti.find((d) => d.stato === 'da_verificare');
  const ultimoErrore = [...documenti].reverse().find((d) => d.stato === 'errore');

  const quoteEmesse = emessi.filter((d) => d.quota);
  const romanaBloccata = quoteEmesse.length > 0;
  const nQuote = romanaBloccata ? quoteEmesse[0].quota!.di : persone;
  const modoEff = romanaBloccata ? 'romana' : modo;
  // Lo sconto vale solo sul conto unico (alla romana si dividerebbe in modo diverso a ogni quota).
  const scontoCents = modoEff === 'unico' && sconto ? Math.min(sconto.cents, conto.totaleCents) : 0;
  const quote = modoEff === 'romana' ? dividiAllaRomana(conto.totaleCents, nQuote) : [conto.totaleCents - scontoCents];
  const prossima = modoEff === 'romana' ? (Array.from({ length: nQuote }, (_, i) => i + 1).find((i) => !quoteEmesse.some((d) => d.quota!.indice === i)) ?? null) : 1;
  const daIncassare = prossima ? quote[prossima - 1] : 0;
  const ricevuto = metodo === 'contanti' && digitato ? Math.round(parseFloat(digitato.replace(',', '.')) * 100) : daIncassare;
  const resto = metodo === 'contanti' ? ricevuto - daIncassare : 0;

  useEffect(() => {
    if (comanda?.stato === 'chiusa' && !comanda.proforma) {
      toast({ testo: 'Conto chiuso. Il tavolo è libero.', tipo: 'ok' });
      nav('/sala', { replace: true });
    }
  }, [comanda?.stato]);

  if (!comanda) return <main className="p-8 text-text"><Link className="underline" to="/sala">Torna alla sala</Link></main>;

  const tasto = (t: string) => {
    if (t === 'del') return setDigitato((d) => d.slice(0, -1));
    if (t === '=') return setDigitato('');
    if (t.startsWith('+')) {
      const attuale = digitato ? Math.round(parseFloat(digitato.replace(',', '.')) * 100) : 0;
      const nuovo = attuale + parseInt(t.slice(1), 10) * 100;
      return setDigitato((nuovo / 100).toFixed(2).replace('.', ',').replace(',00', ''));
    }
    if (t === ',' && digitato.includes(',')) return;
    if (/,\d\d$/.test(digitato)) return;
    setDigitato((d) => (d + t).replace(/^0+(?=\d)/, ''));
  };

  const incassa = () => {
    if (!prossima) return;
    if (metodo === 'contanti' && ricevuto < daIncassare) return toast({ testo: `Mancano ${euro(daIncassare - ricevuto)}`, tipo: 'errore' });
    void esegui(async () => {
      await db.incassa(comanda.id, {
        pagamenti: [{ tipo: metodo, importoCents: metodo === 'contanti' ? ricevuto : daIncassare }],
        quota: modoEff === 'romana' ? { indice: prossima, di: nQuote } : undefined,
        scontoCents: scontoCents || undefined,
      }, nuovaChiave(), operatore ?? undefined);
      setDigitato('');
    });
  };

  const statoQuota = (i: number): { testo: string; doc?: Documento; tono: 'ok' | 'attivo' | 'errore' | 'attesa' } => {
    const d = documenti.filter((x) => x.quota?.indice === i).at(-1);
    if (d?.stato === 'emesso') return { testo: `${NOME_METODO[d.pagamenti[0]?.tipo] ?? 'Pagata'} · n. ${d.rtDocNumero ?? ''}`, doc: d, tono: 'ok' };
    if (d?.stato === 'in_emissione') return { testo: 'In stampa', doc: d, tono: 'attivo' };
    if (d?.stato === 'da_verificare') return { testo: 'Da verificare', doc: d, tono: 'errore' };
    return { testo: i === prossima ? 'Si paga ora' : 'Da pagare', tono: i === prossima ? 'attivo' : 'attesa' };
  };

  const tavolo = setup.tavoli.find((t) => t.id === comanda.tavoloId);
  const tasti = ['7', '8', '9', '+50', '4', '5', '6', '+20', '1', '2', '3', '=', '0', '00', ',', 'del'];

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata indietro={`/comanda/${comanda.id}`} titolo={`Conto · Tavolo ${tavolo?.numero ?? ''}`} sotto={`${comanda.coperti} coperti`} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section aria-label="Dividi il conto" className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
          <div role="radiogroup" aria-label="Come si paga" className="flex w-max gap-1 rounded-pill bg-surface p-1">
            {(['unico', 'romana'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={modoEff === m} disabled={romanaBloccata}
                onClick={() => setModo(m)} className={`premibile h-11 rounded-pill px-5 text-[15px] font-semibold disabled:cursor-not-allowed ${modoEff === m ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>
                {m === 'unico' ? 'Conto unico' : 'Alla romana'}</button>
            ))}
          </div>

          {modoEff === 'romana' && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-base font-semibold">Persone</span>
                <button type="button" aria-label="Meno persone" disabled={romanaBloccata} onClick={() => setPersone((p) => Math.max(2, p - 1))} className="premibile h-12 w-12 rounded-md bg-surface-2 text-xl font-semibold disabled:opacity-40">−</button>
                <output className="w-8 text-center text-xl font-bold tabular-nums">{nQuote}</output>
                <button type="button" aria-label="Più persone" disabled={romanaBloccata} onClick={() => setPersone((p) => Math.min(30, p + 1))} className="premibile h-12 w-12 rounded-md bg-surface-2 text-xl font-semibold disabled:opacity-40">+</button>
                <span className="text-sm text-text-muted">{euro(quote[0])} a testa{quote.at(-1) !== quote[0] ? `, l’ultima ${euro(quote.at(-1)!)}` : ''}</span>
              </div>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {quote.map((q, i) => {
                  const st = statoQuota(i + 1);
                  return (
                    <li key={i} className={`flex flex-col gap-1 rounded-lg border p-3 ${st.tono === 'ok' ? 'border-success' : st.tono === 'attivo' ? 'border-focus bg-surface-2' : st.tono === 'errore' ? 'border-danger' : 'border-border bg-surface'}`}>
                      <span className="text-xs font-semibold text-text-muted">Quota {i + 1}</span>
                      <span className="text-lg font-bold tabular-nums">{euro(q)}</span>
                      <span className={`flex items-center gap-1 text-xs font-bold ${st.tono === 'ok' ? 'text-success' : st.tono === 'errore' ? 'text-danger' : st.tono === 'attivo' ? 'text-focus' : 'text-text-muted'}`}>
                        {st.tono === 'ok' && <CheckCircle size={14} weight="fill" aria-hidden />}{st.testo}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <div className="flex flex-1 flex-col rounded-lg bg-surface p-4 md:p-5">
            <h2 className="mb-2 text-sm font-semibold text-text-muted">Riepilogo</h2>
            <div className="flex flex-col gap-1.5">
              {righe.filter((r) => r.stato !== 'stornata').map((r) => (
                <div key={r.id} className="flex justify-between gap-3 text-[15px] tabular-nums"><span>{r.quantita} × {r.descrizione}</span><span>{euro(importoRiga(r), false)}</span></div>
              ))}
              {conto.copertoCents > 0 && <div className="flex justify-between text-[15px] tabular-nums text-text-muted"><span>{comanda.coperti} × Coperto</span><span>{euro(conto.copertoCents, false)}</span></div>}
            </div>
            <div className="flex-1" />
            {scontoCents > 0 && (
              <div className="mt-3 flex justify-between text-[15px] font-semibold text-success tabular-nums">
                <span>Sconto {sconto!.etichetta} <span className="font-normal text-text-muted">· {sconto!.da}</span></span><span>−{euro(scontoCents, false)}</span>
              </div>
            )}
            <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3 tabular-nums">
              <span className="font-semibold">Totale</span><span className="text-xl font-bold">{euro(conto.totaleCents - scontoCents)}</span>
            </div>
            {modoEff === 'unico' && !emessi.length && (
              <button type="button" onClick={() => (sconto ? setSconto(null) : setScontoAperto(true))}
                className="premibile mt-3 flex h-touch items-center justify-center gap-2 rounded-md border border-border text-sm font-semibold">
                <Percent size={18} weight="bold" aria-hidden />{sconto ? 'Togli lo sconto' : 'Sconto'}
              </button>
            )}
            {modoEff === 'unico' && !emessi.length && !sconto && cliente && cliente.scontoPct > 0 && (
              <button type="button" onClick={() => setSconto({ cents: Math.round((conto.totaleCents * cliente.scontoPct) / 100), etichetta: `${cliente.scontoPct}%`, da: `cliente ${nomeCliente(cliente)}` })}
                className="premibile mt-2 flex h-touch items-center justify-center gap-2 rounded-md bg-surface-2 text-sm font-semibold text-accent">
                <Percent size={18} weight="bold" aria-hidden />Sconto abituale di {nomeCliente(cliente)}: {cliente.scontoPct}%
              </button>
            )}
            {cliente && (cliente.piva || cliente.codiceFiscale) && (
              <p className="mt-2 text-center text-xs text-text-muted">Vuole la fattura? Dopo lo scontrino: Cassa → “Fattura” accanto allo scontrino.</p>
            )}
          </div>
        </section>

        <aside aria-label="Pagamento" className="flex w-full flex-none flex-col gap-3 border-t border-border bg-surface p-4 md:w-[440px] md:border-l md:border-t-0 md:p-5">
          {daVerificare && (
            <div role="alert" className="flex gap-2.5 rounded-lg bg-danger p-3 text-sm font-semibold text-on-danger">
              <Warning size={20} weight="fill" className="flex-none" aria-hidden />
              <span>Lo scontrino potrebbe essere già uscito. Guarda la carta dell’Epson: se è uscito, non ristamparlo.</span>
            </div>
          )}
          {ultimoErrore && !inCorso && !daVerificare && (
            <div role="alert" className="rounded-lg border border-danger p-3 text-sm font-semibold text-danger">{ultimoErrore.errore}</div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold text-text-muted">{modoEff === 'romana' && prossima ? `Quota ${prossima}` : 'Da incassare'}</span>
            <span className="text-[34px] font-bold tracking-tight tabular-nums">{euro(daIncassare)}</span>
          </div>
          <div role="radiogroup" aria-label="Metodo di pagamento" className="grid grid-cols-3 gap-2">
            {METODI.map((m) => (
              <button key={m.tipo} type="button" role="radio" aria-checked={metodo === m.tipo} onClick={() => { setMetodo(m.tipo); setDigitato(''); }}
                className={`premibile flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-md text-sm font-semibold ${metodo === m.tipo ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>
                {m.icona}{m.nome}</button>
            ))}
          </div>
          {metodo === 'contanti' ? (
            <>
              <div className="flex items-baseline justify-between rounded-md border border-border-input bg-bg px-4 py-2">
                <span className="text-sm font-semibold text-text-muted">Ricevuto</span>
                <output aria-live="polite" className="text-[26px] font-bold tabular-nums">{euro(ricevuto)}</output>
              </div>
              <div className="flex items-baseline justify-between px-1">
                <span className="text-base font-semibold">{resto < 0 ? 'Mancano' : 'Resto'}</span>
                <span className={`text-[26px] font-bold tabular-nums ${resto < 0 ? 'text-danger' : 'text-success'}`}>{euro(Math.abs(resto))}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {tasti.map((t, i) => (
                  <button key={i} type="button" onClick={() => tasto(t)}
                    aria-label={t === 'del' ? 'Cancella' : t === '=' ? 'Importo esatto' : t.startsWith('+') ? `Aggiungi ${t.slice(1)} euro` : t}
                    className={`premibile grid h-14 place-items-center rounded-md font-semibold tabular-nums ${t.startsWith('+') || t === '=' ? 'bg-border text-base' : 'bg-surface-2 text-xl'}`}>
                    {t === 'del' ? Icona.cancella : t === '=' ? 'Esatto' : t.startsWith('+') ? `+${t.slice(1)} €` : t}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="flex gap-2.5 rounded-md bg-bg p-3 text-sm text-text-muted">
              <Bank size={20} weight="bold" className="flex-none" aria-hidden />
              {metodo === 'carta' ? 'Incassa sul POS, poi stampa lo scontrino: risulterà pagato con pagamento elettronico.' : 'Ritira i buoni, poi stampa lo scontrino.'}
            </p>
          )}
          <div className="flex-1" />
          <Pulsante variante="conferma" taglia="xl" className="w-full" icona={inCorso ? undefined : Icona.scontrino}
            disabled={!prossima || !!inCorso || !!daVerificare || righe.length === 0} onClick={incassa}>
            {inCorso ? <span className="flex items-center gap-2"><Spinner />Scontrino in stampa</span> : 'Incassa e stampa scontrino'}
          </Pulsante>
          {!emessi.length && !inCorso && !daVerificare && (
            <div className="grid grid-cols-2 gap-2">
              <Pulsante taglia="lg" icona={<HandHeart size={20} weight="bold" aria-hidden />} disabled={!righe.some((r) => r.stato !== 'stornata')}
                onClick={() => setSenzaIncasso('proforma')}>Proforma</Pulsante>
              <Pulsante taglia="lg" className="text-danger" icona={<Trash size={20} weight="bold" aria-hidden />}
                onClick={() => setSenzaIncasso('elimina')}>Elimina conto</Pulsante>
            </div>
          )}
        </aside>
      </div>
      <Foglio aperto={!!senzaIncasso} onChiudi={() => setSenzaIncasso(null)}
        titolo={senzaIncasso === 'proforma' ? 'Chiudi come proforma' : 'Eliminare questo conto?'}>
        {senzaIncasso === 'proforma' && <Proforma comandaId={comanda.id} totaleCents={conto.totaleCents} onFatto={() => setSenzaIncasso(null)} />}
        {senzaIncasso === 'elimina' && <EliminaConto comandaId={comanda.id} inviate={righe.filter((r) => !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato)).length} onFatto={() => setSenzaIncasso(null)} />}
      </Foglio>
      <FoglioSconto aperto={scontoAperto} totaleCents={conto.totaleCents} onChiudi={() => setScontoAperto(false)}
        onApplica={(sc) => { setSconto(sc); setScontoAperto(false); setDigitato(''); }} />
    </div>
  );
}

const puoScontare = (ruolo?: string) => ruolo === 'responsabile' || ruolo === 'admin';

/** Sconto in percentuale o in euro. Se chi è collegato non è responsabile, serve il PIN di un responsabile. */
function FoglioSconto({ aperto, totaleCents, onChiudi, onApplica }: {
  aperto: boolean; totaleCents: number; onChiudi: () => void;
  onApplica: (s: { cents: number; etichetta: string; da: string }) => void;
}) {
  const { db, operatore } = useApp();
  const [pct, setPct] = useState<number | null>(10);
  const [cents, setCents] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const serveAutorizzazione = !puoScontare(operatore?.ruolo);
  const valore = cents ?? (pct ? Math.round((totaleCents * pct) / 100) : 0);
  const etichetta = cents != null ? euro(cents) : `${pct}%`;

  const conferma = async () => {
    if (!valore || valore <= 0) return setErrore('Scegli lo sconto.');
    if (valore >= totaleCents) return setErrore('Lo sconto non può azzerare il conto.');
    let da = operatore?.nome ?? '';
    if (serveAutorizzazione) {
      const r = await db.login(pin);
      if (!r || !puoScontare(r.ruolo)) { setPin(''); return setErrore('Serve il PIN di un responsabile.'); }
      da = r.nome;
    }
    setErrore(null); setPin('');
    onApplica({ cents: valore, etichetta, da: `autorizzato da ${da}` });
  };

  return (
    <Foglio aperto={aperto} onChiudi={() => { setErrore(null); setPin(''); onChiudi(); }} titolo="Sconto sul conto">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Percentuale">
        {[5, 10, 15, 20, 50].map((p) => (
          <button key={p} type="button" aria-pressed={pct === p && cents == null} onClick={() => { setPct(p); setCents(null); }}
            className={`premibile h-touch min-w-16 rounded-pill px-4 text-base font-bold ${pct === p && cents == null ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{p}%</button>
        ))}
      </div>
      <CampoEuro etichetta="Oppure un importo" valore={cents} onCambia={setCents} className="mb-4" />
      <p className="mb-4 text-base">Sconto <strong className="tabular-nums">{euro(valore)}</strong> · si paga <strong className="tabular-nums">{euro(Math.max(0, totaleCents - valore))}</strong></p>
      {serveAutorizzazione && (
        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold text-text-muted">PIN del responsabile</p>
          <output className="mb-2 block h-10 rounded-md bg-bg px-3 text-2xl tracking-[0.5em]" aria-label="PIN inserito">{'•'.repeat(pin.length)}</output>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((t, i) => t === '' ? <span key={i} /> : (
              <button key={t} type="button" aria-label={t === 'del' ? 'Cancella' : t}
                onClick={() => setPin((p) => (t === 'del' ? p.slice(0, -1) : (p + t).slice(0, 6)))}
                className="premibile grid h-12 place-items-center rounded-md bg-surface-2 text-xl font-semibold tabular-nums">{t === 'del' ? Icona.cancella : t}</button>
            ))}
          </div>
        </div>
      )}
      {errore && <p role="alert" className="mb-3 text-sm font-semibold text-danger">{errore}</p>}
      <Pulsante variante="primario" taglia="lg" className="w-full" onClick={() => void conferma()}>Applica sconto</Pulsante>
    </Foglio>
  );
}
