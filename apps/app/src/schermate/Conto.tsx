import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { calcolaConto, dividiAllaRomana, euro, importoRiga, type Documento, type TipoPagamento } from '@gr/core';
import { nuovaChiave, useApp, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Icona, Pulsante, Spinner } from '../ui/primitivi';

const METODI: { tipo: TipoPagamento; nome: string }[] = [
  { tipo: 'contanti', nome: 'Contanti' }, { tipo: 'carta', nome: 'Carta' }, { tipo: 'buono_pasto', nome: 'Buono pasto' },
];

// S13 + S14 + S15 — conto, divisione alla romana, pagamento, scontrino dall'Epson.
export function Conto() {
  const { id = '' } = useParams();
  const { db, toast } = useApp();
  const nav = useNavigate();
  const { comanda, righe, documenti, setup } = useDati((d) => ({ comanda: d.comanda(id), righe: d.righe(id), documenti: d.documenti(id), setup: d.setup() }));
  const [modo, setModo] = useState<'unico' | 'romana'>('unico');
  const [persone, setPersone] = useState(comanda?.coperti || 2);
  const [metodo, setMetodo] = useState<TipoPagamento>('contanti');
  const [digitato, setDigitato] = useState('');

  const conto = useMemo(() => calcolaConto(righe, comanda?.coperti ?? 0, setup.locale.copertoCents), [righe, comanda, setup]);
  const emessi = documenti.filter((d) => d.stato === 'emesso');
  const inCorso = documenti.find((d) => d.stato === 'in_emissione');
  const daVerificare = documenti.find((d) => d.stato === 'da_verificare');
  const ultimoErrore = [...documenti].reverse().find((d) => d.stato === 'errore');

  // Se c'è già una quota emessa, il conto resta "alla romana" con quel numero di persone.
  const quoteEmesse = emessi.filter((d) => d.quota);
  const romanaBloccata = quoteEmesse.length > 0;
  const nQuote = romanaBloccata ? quoteEmesse[0].quota!.di : persone;
  const modoEff = romanaBloccata ? 'romana' : modo;
  const quote = modoEff === 'romana' ? dividiAllaRomana(conto.totaleCents, nQuote) : [conto.totaleCents];
  const prossima = modoEff === 'romana' ? (Array.from({ length: nQuote }, (_, i) => i + 1).find((i) => !quoteEmesse.some((d) => d.quota!.indice === i)) ?? null) : 1;
  const daIncassare = prossima ? quote[prossima - 1] : 0;
  const ricevuto = metodo === 'contanti' && digitato ? Math.round(parseFloat(digitato.replace(',', '.')) * 100) : daIncassare;
  const resto = metodo === 'contanti' ? ricevuto - daIncassare : 0;

  useEffect(() => {
    if (comanda?.stato === 'chiusa') {
      toast({ testo: 'Conto chiuso. Tavolo libero.', tipo: 'ok' });
      nav('/sala', { replace: true });
    }
  }, [comanda?.stato]);

  if (!comanda) return <main className="p-8"><Link className="underline" to="/sala">Torna alla sala</Link></main>;

  const tasto = (t: string) => {
    if (t === '⌫') return setDigitato((d) => d.slice(0, -1));
    if (t === '=') return setDigitato('');
    if (t.startsWith('=')) {
      // Banconote rapide: si sommano a quanto già digitato (50 + 50 = 100).
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
    if (metodo === 'contanti' && ricevuto < daIncassare) return toast({ testo: 'L’importo ricevuto è inferiore al dovuto', tipo: 'errore' });
    try {
      db.incassa(comanda.id, {
        pagamenti: [{ tipo: metodo, importoCents: metodo === 'contanti' ? ricevuto : daIncassare }],
        quota: modoEff === 'romana' ? { indice: prossima, di: nQuote } : undefined,
      }, nuovaChiave());
      setDigitato('');
    } catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); }
  };

  const statoQuota = (i: number): { testo: string; doc?: Documento } => {
    const d = documenti.filter((x) => x.quota?.indice === i).at(-1);
    if (!d) return { testo: i === prossima ? 'in pagamento' : 'da pagare' };
    if (d.stato === 'emesso') return { testo: `✓ ${d.pagamenti[0].tipo === 'contanti' ? 'Contanti' : d.pagamenti[0].tipo === 'carta' ? 'Carta' : 'Buono'} · n. ${d.rtDocNumero}`, doc: d };
    if (d.stato === 'in_emissione') return { testo: 'in stampa…', doc: d };
    if (d.stato === 'da_verificare') return { testo: 'da verificare', doc: d };
    return { testo: i === prossima ? 'in pagamento' : 'da pagare' };
  };

  const tavolo = setup.tavoli.find((t) => t.id === comanda.tavoloId);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata indietro={`/comanda/${comanda.id}`} titolo={`Conto · Tavolo ${tavolo?.numero ?? ''}`} sotto={`${comanda.coperti} coperti`} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section aria-label="Dividi il conto" className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-5">
          <div role="radiogroup" aria-label="Come si paga" className="flex w-max gap-1 rounded-lg bg-surface p-1">
            {(['unico', 'romana'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={modoEff === m} disabled={romanaBloccata}
                onClick={() => setModo(m)} className={`h-12 rounded-md px-5 text-[15px] font-semibold ${modoEff === m ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>
                {m === 'unico' ? 'Conto unico' : 'Alla romana'}</button>
            ))}
          </div>

          {modoEff === 'romana' && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-base font-semibold">Persone</span>
                <button type="button" aria-label="Meno" disabled={romanaBloccata} onClick={() => setPersone((p) => Math.max(2, p - 1))} className="h-14 w-14 rounded-md bg-surface-2 text-xl disabled:opacity-40">−</button>
                <output className="w-10 text-center text-xl font-bold tabular-nums">{nQuote}</output>
                <button type="button" aria-label="Più" disabled={romanaBloccata} onClick={() => setPersone((p) => Math.min(30, p + 1))} className="h-14 w-14 rounded-md bg-surface-2 text-xl disabled:opacity-40">+</button>
                <span className="text-sm text-text-muted">{euro(conto.totaleCents)} ÷ {nQuote} = {euro(quote[0])} a testa{quote.at(-1) !== quote[0] ? ` (ultima ${euro(quote.at(-1)!)})` : ''}</span>
              </div>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {quote.map((q, i) => {
                  const st = statoQuota(i + 1);
                  const pagata = st.doc?.stato === 'emesso';
                  return (
                    <li key={i} className={`flex flex-col gap-1 rounded-lg border p-3 ${pagata ? 'border-success bg-surface' : i + 1 === prossima ? 'border-focus bg-surface-2' : 'border-border bg-surface'}`}>
                      <span className="text-xs font-semibold text-text-muted">Quota {i + 1}</span>
                      <span className="text-lg font-bold tabular-nums">{euro(q)}</span>
                      <span className={`text-xs font-bold ${pagata ? 'text-success' : st.testo === 'da verificare' ? 'text-danger' : 'text-text-muted'}`}>{st.testo}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <div className="flex flex-1 flex-col gap-1.5 rounded-lg bg-surface p-4">
            <h2 className="text-xs font-bold text-text-muted">RIEPILOGO CONTO</h2>
            {righe.filter((r) => r.stato !== 'stornata').map((r) => (
              <div key={r.id} className="flex justify-between text-[15px] tabular-nums"><span>{r.quantita} × {r.descrizione}</span><span>{euro(importoRiga(r), false)}</span></div>
            ))}
            {conto.copertoCents > 0 && <div className="flex justify-between text-[15px] tabular-nums"><span>{comanda.coperti} × Coperto</span><span>{euro(conto.copertoCents, false)}</span></div>}
            <div className="flex-1" />
            <div className="flex justify-between pt-2 text-lg font-bold tabular-nums"><span>Totale</span><span>{euro(conto.totaleCents)}</span></div>
          </div>
        </section>

        <aside aria-label="Pagamento" className="flex w-full flex-none flex-col gap-3 border-t border-border bg-surface p-4 md:w-[440px] md:border-l md:border-t-0 md:p-5">
          {daVerificare && (
            <div role="alert" className="rounded-md bg-danger p-3 text-sm font-bold text-on-danger">
              Lo scontrino potrebbe essere già uscito. Controlla la carta dell’Epson prima di riprovare.
              <span className="mt-1 block font-medium">Se è uscito, non ristamparlo. La verifica con l’RT arriva con l’app di cassa.</span>
            </div>
          )}
          {ultimoErrore && !inCorso && !daVerificare && (
            <div role="alert" className="rounded-md border border-danger p-3 text-sm font-semibold text-danger">{ultimoErrore.errore}</div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-base font-semibold text-text-muted">{modoEff === 'romana' && prossima ? `Quota ${prossima} · da incassare` : 'Da incassare'}</span>
            <span className="text-[34px] font-bold tabular-nums">{euro(daIncassare)}</span>
          </div>
          <div role="radiogroup" aria-label="Metodo di pagamento" className="grid grid-cols-3 gap-2">
            {METODI.map((m) => (
              <button key={m.tipo} type="button" role="radio" aria-checked={metodo === m.tipo} onClick={() => { setMetodo(m.tipo); setDigitato(''); }}
                className={`h-14 rounded-md text-base font-semibold ${metodo === m.tipo ? 'border-2 border-accent bg-surface-2' : 'border border-border bg-bg'}`}>{m.nome}</button>
            ))}
          </div>
          {metodo === 'contanti' && (
            <>
              <div className="flex items-baseline justify-between rounded-md border border-border-input bg-bg px-4 py-2">
                <span className="text-sm font-semibold text-text-muted">Ricevuto</span>
                <output aria-live="polite" className="text-[28px] font-bold tabular-nums">{euro(ricevuto)}</output>
              </div>
              <div className="flex items-baseline justify-between px-1">
                <span className="text-base font-semibold">{resto < 0 ? 'Mancano' : 'Resto'}</span>
                <span className={`text-[28px] font-bold tabular-nums ${resto < 0 ? 'text-danger' : 'text-success'}`}>{euro(Math.abs(resto))}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['7', '8', '9', '=50', '4', '5', '6', '=20', '1', '2', '3', '=' , '0', '00', ',', '⌫'].map((t, i) => (
                  <button key={i} type="button" onClick={() => tasto(t)} aria-label={t === '⌫' ? 'Cancella' : t === '=' ? 'Importo esatto' : t.startsWith('=') ? `Aggiungi ${t.slice(1)} euro` : t}
                    className={`h-14 rounded-md text-xl font-semibold tabular-nums active:scale-[.98] ${t.startsWith('=') ? 'bg-border text-base' : 'bg-surface-2'}`}>
                    {t === '=' ? 'Esatto' : t.startsWith('=') ? `€ ${t.slice(1)}` : t}
                  </button>
                ))}
              </div>
            </>
          )}
          {metodo === 'carta' && <p className="rounded-md bg-bg p-3 text-sm text-text-muted">Incassa sul POS, poi stampa lo scontrino: risulterà pagato con pagamento elettronico.</p>}
          <div className="flex-1" />
          <Pulsante variante="conferma" taglia="xl" className="w-full" icona={Icona.scontrino}
            disabled={!prossima || !!inCorso || !!daVerificare || righe.length === 0} onClick={incassa}>
            {inCorso ? <span className="flex items-center gap-2"><Spinner />Scontrino in stampa…</span> : 'Incassa e stampa scontrino'}
          </Pulsante>
        </aside>
      </div>
    </div>
  );
}
