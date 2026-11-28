// Pannello di pagamento del conto: metodi di base e quelli aggiunti in Gestione (Satispay…), buoni pasto per emittente,
// sospeso al cliente, addebito in camera, caparra, pagamento in più modi e codice lotteria degli scontrini.
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Bank, Bed, CreditCard, DotsThreeCircle, HandCoins, Money, Ticket, UserCircle, Vault, X } from '@phosphor-icons/react';
import {
  codiceLotteriaValido, euro, metodiPagamento, nomeCliente, PAGAMENTO_RT,
  type Caparra, type Cliente, type Comanda, type MetodoPagamento, type Pagamento, type TipoPagamento,
} from '@gr/core';
import { useApp, useDati } from '../dati/contesto';
import { inTauri, pagaSulPos } from '../dati/trasporto';
import { FoglioClienteTavolo } from './Clienti';
import { Foglio, Icona, Pulsante, Spinner } from '../ui/primitivi';

type Scelta =
  | { k: 'metodo'; m: MetodoPagamento }
  | { k: 'sospeso' } | { k: 'camera' };

const ICONA: Partial<Record<TipoPagamento, ReactElement>> = {
  contanti: <Money size={22} weight="bold" aria-hidden />, carta: <CreditCard size={22} weight="bold" aria-hidden />,
  buono_pasto: <Ticket size={22} weight="bold" aria-hidden />, bonifico: <Bank size={22} weight="bold" aria-hidden />,
  prepagata: <CreditCard size={22} weight="bold" aria-hidden />,
};
const tasti = ['7', '8', '9', '+50', '4', '5', '6', '+20', '1', '2', '3', '=', '0', '00', ',', 'del'];
const cents = (s: string) => (s ? Math.round(parseFloat(s.replace(',', '.')) * 100) : 0);
const nomePag = (p: Pagamento) => (p.descrizione?.startsWith('caparra:') ? 'Caparra' : p.descrizione || { contanti: 'Contanti', carta: 'Carta', buono_pasto: 'Buono pasto', bonifico: 'Bonifico', prepagata: 'Prepagata', sospeso: 'Sospeso', camera: 'Camera' }[p.tipo]);

export function PannelloPagamento({ comanda, cliente, daIncassare, etichetta, inStampa, bloccato, onIncassa }: {
  comanda: Comanda; cliente: Cliente | null; daIncassare: number; etichetta: string; inStampa: boolean; bloccato: boolean;
  onIncassa: (pagamenti: Pagamento[], lotteria?: string) => Promise<boolean>;
}) {
  const { db, toast } = useApp();
  const setup = useDati((d) => d.setup());
  const metodi = useMemo(() => metodiPagamento(setup), [setup]);
  const buoni = setup.impostazioni?.buoniPasto ?? [];
  const [scelta, setScelta] = useState<Scelta>({ k: 'metodo', m: metodi[0] });
  const [parziali, setParziali] = useState<Pagamento[]>([]);
  const [digitato, setDigitato] = useState('');
  const [emittente, setEmittente] = useState('');
  const [camera, setCamera] = useState('');
  const [lotteria, setLotteria] = useState('');
  const [inParti, setInParti] = useState(false);
  const [altro, setAltro] = useState(false);
  const [caparre, setCaparre] = useState<Caparra[] | null>(null);
  const [clienteAperto, setClienteAperto] = useState(false);
  // POS: quale (UniCredit, FlatPay…), attesa del pagamento sul POS collegato, dubbio se l'esito non arriva.
  const { modalita } = useApp();
  const posLista = setup.impostazioni?.pos ?? [];
  const [posId, setPosId] = useState<string | undefined>(() => (posLista.find((p) => p.collegato) ?? posLista[0])?.id);
  const pos = posLista.find((p) => p.id === posId);
  const [attesaPos, setAttesaPos] = useState<{ nome: string; importo: number } | null>(null);
  const [dubbioPos, setDubbioPos] = useState<{ nome: string; importo: number; risolvi: (ok: boolean) => void } | null>(null);
  const posComandabile = !!pos?.collegato && (inTauri() || modalita === 'demo');

  /** Con il POS collegato: manda l'importo e aspetta l'esito. true = pagato. */
  const chiediPos = async (importo: number): Promise<boolean> => {
    if (!(scelta.k === 'metodo' && scelta.m.tipo === 'carta' && pos && posComandabile)) return true;
    setAttesaPos({ nome: pos.nome, importo });
    try {
      const e = await pagaSulPos(pos, importo, modalita === 'demo');
      if (e.ok) { toast({ testo: `${pos.nome}: pagamento approvato${e.carta ? ` (${e.carta})` : ''}`, tipo: 'ok' }); return true; }
      toast({ testo: `${pos.nome}: ${e.motivo ?? 'pagamento non riuscito'}`, tipo: 'errore' });
      return false;
    } catch (err) {
      const m = (err as Error).message;
      if (m.startsWith('INCERTO')) return new Promise<boolean>((risolvi) => setDubbioPos({ nome: pos.nome, importo, risolvi }));
      toast({ testo: `${pos.nome}: ${m.replace(/^NON_INVIATO:\s*/, '')}. Puoi riprovare, o incassare a mano.`, tipo: 'errore' });
      return false;
    } finally { setAttesaPos(null); }
  };

  // Nuova quota o conto: si riparte puliti.
  useEffect(() => { setParziali([]); setDigitato(''); setInParti(false); }, [daIncassare]);

  const residuo = Math.max(0, daIncassare - parziali.reduce((s, p) => s + p.importoCents, 0));
  const contanti = scelta.k === 'metodo' && scelta.m.tipo === 'contanti';
  const importoTastiera = cents(digitato);
  // In più modi la tastiera dice quanto paga questo metodo; con i contanti (pagamento finale) quanto ha dato il cliente.
  const quota = inParti ? Math.min(importoTastiera || residuo, residuo) : residuo;
  const ricevuto = contanti && !inParti && digitato ? importoTastiera : quota;
  const resto = contanti && !inParti ? ricevuto - residuo : 0;

  const pagamento = (importo: number): Pagamento | string => {
    if (scelta.k === 'sospeso') {
      if (!cliente) return 'Per il sospeso collega prima il cliente al conto';
      return { tipo: 'sospeso', importoCents: importo, descrizione: nomeCliente(cliente) };
    }
    if (scelta.k === 'camera') {
      if (!camera.trim()) return 'Scrivi la camera (e il nome dell’ospite)';
      return { tipo: 'camera', importoCents: importo, descrizione: camera.trim() };
    }
    const m = scelta.m;
    if (m.tipo === 'buono_pasto' && buoni.length && !emittente) return 'Scegli l’emittente del buono pasto';
    const descrizione = m.tipo === 'buono_pasto' ? emittente || undefined : m.id === 'carta' && pos ? `Carta ${pos.nome}` : ['contanti', 'carta', 'buono_pasto'].includes(m.id) ? undefined : m.nome;
    return { tipo: m.tipo, importoCents: importo, descrizione };
  };

  const elettronico = [...parziali, ...(scelta.k === 'metodo' ? [{ tipo: scelta.m.tipo }] : [])].some((p) => PAGAMENTO_RT[p.tipo as TipoPagamento] === 'elettronico');

  const aggiungiParte = async () => {
    const p = pagamento(quota);
    if (typeof p === 'string') return toast({ testo: p, tipo: 'errore' });
    if (quota <= 0) return toast({ testo: 'Scrivi l’importo di questa parte', tipo: 'errore' });
    if (!(await chiediPos(quota))) return;
    setParziali((x) => [...x, p]); setDigitato('');
  };

  const incassa = async () => {
    if (contanti && !inParti && ricevuto < residuo) return toast({ testo: `Mancano ${euro(residuo - ricevuto)}`, tipo: 'errore' });
    const finale = residuo > 0 ? pagamento(contanti && !inParti ? ricevuto : residuo) : null;
    if (typeof finale === 'string') return toast({ testo: finale, tipo: 'errore' });
    const codice = lotteria.trim().toUpperCase();
    if (codice && !codiceLotteriaValido(codice)) return toast({ testo: 'Il codice lotteria ha 8 lettere o cifre', tipo: 'errore' });
    if (finale && !(await chiediPos(finale.importoCents))) return;
    const ok = await onIncassa([...parziali, ...(finale ? [finale] : [])], codice && elettronico ? codice : undefined);
    if (ok) { setParziali([]); setDigitato(''); setLotteria(''); setInParti(false); }
  };

  const tasto = (t: string) => {
    if (t === 'del') return setDigitato((d) => d.slice(0, -1));
    if (t === '=') return setDigitato('');
    if (t.startsWith('+')) {
      const nuovo = importoTastiera + parseInt(t.slice(1), 10) * 100;
      return setDigitato((nuovo / 100).toFixed(2).replace('.', ',').replace(',00', ''));
    }
    if (t === ',' && digitato.includes(',')) return;
    if (/,\d\d$/.test(digitato)) return;
    setDigitato((d) => (d + t).replace(/^0+(?=\d)/, ''));
  };

  const usaCaparra = (c: Caparra) => {
    const importo = Math.min(c.importoCents, residuo);
    const tipo: TipoPagamento = c.metodo === 'contanti' ? 'contanti' : c.metodo;
    setParziali((x) => [...x.filter((p) => p.descrizione !== `caparra:${c.id}`), { tipo, importoCents: importo, descrizione: `caparra:${c.id}` }]);
    setAltro(false);
    if (c.importoCents > residuo) toast({ testo: `La caparra (${euro(c.importoCents)}) supera il conto: ne uso ${euro(importo)}`, tipo: 'info' });
  };

  const apriAltro = () => {
    setAltro(true);
    if (caparre === null) db.caparre().then((x) => setCaparre(x.filter((c) => c.stato === 'aperta'))).catch(() => setCaparre([]));
  };

  const sceltaNome = scelta.k === 'sospeso' ? 'Sospeso' : scelta.k === 'camera' ? 'Camera' : scelta.m.nome;
  const principali = metodi.slice(0, 5);

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold text-text-muted">{parziali.length ? 'Resta da incassare' : etichetta}</span>
        <span className="text-[34px] font-bold tracking-tight tabular-nums">{euro(residuo)}</span>
      </div>

      {parziali.length > 0 && (
        <ul aria-label="Già pagato" className="flex flex-col gap-1 rounded-md bg-bg p-2">
          {parziali.map((p, i) => (
            <li key={i} className="flex items-center gap-2 px-1 text-sm">
              <span className="flex-1 font-semibold">{nomePag(p)}</span>
              <span className="tabular-nums">{euro(p.importoCents)}</span>
              <button type="button" aria-label={`Togli ${nomePag(p)}`} onClick={() => setParziali((x) => x.filter((_, j) => j !== i))}
                className="premibile grid h-8 w-8 place-items-center rounded-md text-text-muted"><X size={16} weight="bold" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}

      <div role="radiogroup" aria-label="Metodo di pagamento" className="grid grid-cols-3 gap-2">
        {principali.map((m) => {
          const on = scelta.k === 'metodo' && scelta.m.id === m.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => { setScelta({ k: 'metodo', m }); setDigitato(''); }}
              className={`premibile flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-semibold ${on ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>
              {ICONA[m.tipo] ?? <HandCoins size={22} weight="bold" aria-hidden />}<span className="max-w-full truncate">{m.nome}</span>
            </button>
          );
        })}
        <button type="button" onClick={apriAltro} aria-haspopup="dialog"
          className={`premibile flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-md text-sm font-semibold ${scelta.k !== 'metodo' || !principali.some((m) => scelta.k === 'metodo' && m.id === scelta.m.id) ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>
          <DotsThreeCircle size={22} weight="bold" aria-hidden />{scelta.k !== 'metodo' || !principali.some((m) => scelta.k === 'metodo' && m.id === scelta.m.id) ? sceltaNome : 'Altro'}
        </button>
      </div>

      {scelta.k === 'metodo' && scelta.m.id === 'carta' && posLista.length > 0 && (
        <div>
          <div role="radiogroup" aria-label="Quale POS" className="flex flex-wrap gap-2">
            {posLista.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={posId === p.id} onClick={() => setPosId(p.id)}
                className={`premibile h-10 rounded-pill px-4 text-sm font-semibold ${posId === p.id ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>
                {p.nome}{p.collegato ? ' · collegato' : ''}
              </button>
            ))}
          </div>
          {pos?.nota && <p className="mt-1.5 text-xs text-text-muted">{pos.nome}: {pos.nota}</p>}
        </div>
      )}
      {scelta.k === 'metodo' && scelta.m.tipo === 'buono_pasto' && buoni.length > 0 && (
        <div role="radiogroup" aria-label="Emittente del buono" className="flex flex-wrap gap-2">
          {buoni.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={emittente === b.nome} onClick={() => setEmittente(b.nome)}
              className={`premibile h-10 rounded-pill px-4 text-sm font-semibold ${emittente === b.nome ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{b.nome}</button>
          ))}
        </div>
      )}
      {scelta.k === 'camera' && (
        <input value={camera} onChange={(e) => setCamera(e.target.value)} placeholder="Camera e ospite (es. 12 Rossi)" aria-label="Camera e ospite" autoFocus
          className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
      )}
      {scelta.k === 'sospeso' && (
        <button type="button" onClick={() => setClienteAperto(true)}
          className={`premibile flex h-touch items-center gap-2 rounded-md px-3 text-left text-sm font-semibold ${cliente ? 'bg-bg' : 'border border-warning text-warning'}`}>
          <UserCircle size={20} weight="bold" aria-hidden />
          {cliente ? `Sospeso a ${nomeCliente(cliente)}` : 'Collega il cliente a cui lasciare il conto in sospeso'}
        </button>
      )}

      {(contanti || inParti) && (
        <>
          <div className="flex items-baseline justify-between rounded-md border border-border-input bg-bg px-4 py-2">
            <span className="text-sm font-semibold text-text-muted">{inParti ? `Paga con ${sceltaNome}` : 'Ricevuto'}</span>
            <output aria-live="polite" className="text-[26px] font-bold tabular-nums">{euro(inParti ? quota : ricevuto)}</output>
          </div>
          {!inParti && (
            <div className="flex items-baseline justify-between px-1">
              <span className="text-base font-semibold">{resto < 0 ? 'Mancano' : 'Resto'}</span>
              <span className={`text-[26px] font-bold tabular-nums ${resto < 0 ? 'text-danger' : 'text-success'}`}>{euro(Math.abs(resto))}</span>
            </div>
          )}
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
      )}
      {!contanti && !inParti && scelta.k === 'metodo' && (
        <p className="flex gap-2.5 rounded-md bg-bg p-3 text-sm text-text-muted">
          <Bank size={20} weight="bold" className="flex-none" aria-hidden />
          {scelta.m.tipo === 'buono_pasto' ? 'Ritira i buoni, poi stampa lo scontrino.'
            : scelta.m.id === 'carta' && pos && posComandabile ? `L’importo va da solo sul POS ${pos.nome}: il cliente paga, e appena il POS approva esce lo scontrino.`
            : `Incassa con ${scelta.m.id === 'carta' && pos ? `il POS ${pos.nome}` : scelta.m.nome}, poi stampa lo scontrino: risulterà pagato con pagamento elettronico.`}
        </p>
      )}
      {(scelta.k === 'sospeso' || scelta.k === 'camera') && !inParti && (
        <p className="rounded-md bg-bg p-3 text-sm text-text-muted">Esce lo scontrino “non riscosso”: lo trovi in Cassa → Sospesi e lo incassi quando paga.</p>
      )}

      {elettronico && (
        <input value={lotteria} onChange={(e) => setLotteria(e.target.value.toUpperCase().slice(0, 8))} placeholder="Codice lotteria (facoltativo)" aria-label="Codice lotteria degli scontrini"
          className="h-11 rounded-md border border-border-input bg-bg px-3 font-mono text-base uppercase tracking-widest text-text outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted focus:border-focus" />
      )}

      <div className="flex-1" />
      {inParti ? (
        <div className="grid grid-cols-2 gap-2">
          <Pulsante taglia="lg" onClick={() => { setInParti(false); setDigitato(''); }}>Fine</Pulsante>
          <Pulsante variante="primario" taglia="lg" disabled={residuo <= 0} onClick={() => void aggiungiParte()}>Aggiungi {euro(quota)}</Pulsante>
        </div>
      ) : (
        <button type="button" disabled={bloccato || residuo <= 0} onClick={() => { setInParti(true); setDigitato(''); }}
          className="premibile -mb-1 self-start text-sm font-semibold text-accent underline-offset-4 hover:underline disabled:opacity-40">
          Paga in più modi (es. parte contanti, parte carta)
        </button>
      )}
      <Pulsante variante="conferma" taglia="xl" className="w-full" icona={inStampa ? undefined : Icona.scontrino}
        disabled={bloccato || inParti} onClick={() => void incassa()}>
        {inStampa ? <span className="flex items-center gap-2"><Spinner />Scontrino in stampa</span> : 'Incassa e stampa scontrino'}
      </Pulsante>

      {attesaPos && (
        <div role="status" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-xl bg-surface p-6 text-center shadow-pop">
            <Spinner />
            <p className="mt-4 text-lg font-bold">Il cliente paga sul POS {attesaPos.nome}</p>
            <p className="mt-1 text-[34px] font-bold tabular-nums">{euro(attesaPos.importo)}</p>
            <p className="mt-2 text-sm text-text-muted">Appena il POS approva, la cassa stampa lo scontrino da sola.</p>
          </div>
        </div>
      )}
      {dubbioPos && (
        <div role="alertdialog" aria-label="Esito del POS" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-pop">
            <p className="text-lg font-bold">Il POS {dubbioPos.nome} non ha dato l’esito</p>
            <p className="mt-2 text-sm text-text-muted">Guarda lo scontrino del POS: il pagamento di {euro(dubbioPos.importo)} è approvato?</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Pulsante taglia="lg" onClick={() => { dubbioPos.risolvi(false); setDubbioPos(null); }}>No</Pulsante>
              <Pulsante taglia="lg" variante="conferma" onClick={() => { dubbioPos.risolvi(true); setDubbioPos(null); }}>Sì, approvato</Pulsante>
            </div>
          </div>
        </div>
      )}
      <Foglio aperto={altro} onChiudi={() => setAltro(false)} titolo="Altri modi di pagare">
        <div className="flex flex-col gap-2">
          {metodi.slice(5).map((m) => (
            <Voce key={m.id} icona={ICONA[m.tipo] ?? <HandCoins size={22} weight="bold" aria-hidden />} titolo={m.nome} testo="Metodo aggiunto in Gestione → Pagamenti"
              onClick={() => { setScelta({ k: 'metodo', m }); setAltro(false); }} />
          ))}
          <Voce icona={<UserCircle size={22} weight="bold" aria-hidden />} titolo="Sospeso al cliente" testo="Paga dopo (cliente abituale, azienda): scontrino non riscosso, poi lo incassi dai Sospesi."
            onClick={() => { setScelta({ k: 'sospeso' }); setAltro(false); }} />
          <Voce icona={<Bed size={22} weight="bold" aria-hidden />} titolo="Addebito in camera" testo="Ospite dell’hotel: il conto va sulla camera."
            onClick={() => { setScelta({ k: 'camera' }); setAltro(false); }} />
          <section className="mt-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-muted"><Vault size={16} weight="bold" aria-hidden />Usa una caparra</h3>
            {caparre === null ? <p className="text-sm text-text-muted">Carico…</p> : caparre.length === 0 ? <p className="text-sm text-text-muted">Nessuna caparra aperta. Si registrano in Cassa → Caparre.</p> : (
              <ul className="flex flex-col gap-1.5">
                {caparre.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => usaCaparra(c)} className="premibile flex w-full items-center gap-3 rounded-md bg-bg px-3 py-2.5 text-left">
                      <span className="flex-1"><span className="block font-semibold">{c.nome}</span><span className="block text-xs text-text-muted">{new Date(c.createdAt).toLocaleDateString('it-IT')} · {c.metodo}{c.nota ? ` · ${c.nota}` : ''}</span></span>
                      <span className="font-semibold tabular-nums">{euro(c.importoCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Foglio>
      <FoglioClienteTavolo aperto={clienteAperto} comanda={comanda} onChiudi={() => setClienteAperto(false)} />
    </>
  );
}

function Voce({ icona, titolo, testo, onClick }: { icona: ReactElement; titolo: string; testo: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="premibile flex items-start gap-3 rounded-md bg-bg p-3 text-left">
      <span className="grid h-11 w-11 flex-none place-items-center rounded-md bg-surface-2 text-accent">{icona}</span>
      <span className="flex flex-col"><span className="text-base font-semibold">{titolo}</span><span className="text-sm text-text-muted">{testo}</span></span>
    </button>
  );
}

