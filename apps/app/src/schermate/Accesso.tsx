import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useOra } from '../dati/contesto';
import { Icona, Spinner } from '../ui/primitivi';

// S01: chi lavora entra con il PIN. Il dispositivo è già collegato al locale.
export function Accesso() {
  const { db, setOperatore, modalita, scollega } = useApp();
  const nav = useNavigate();
  const ora = useOra();
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState('');
  const [tentativi, setTentativi] = useState(0);
  const [verifica, setVerifica] = useState(false);
  const bloccato = tentativi >= 5;
  const nomeLocale = db.setup().locale.nome;

  const premi = async (t: string) => {
    if (bloccato || verifica) return;
    setErrore('');
    if (t === 'del') return setPin((p) => p.slice(0, -1));
    const nuovo = (pin + t).slice(0, 4);
    setPin(nuovo);
    if (nuovo.length < 4) return;
    setVerifica(true);
    try {
      const o = await db.login(nuovo);
      if (o) { setOperatore(o); nav('/sala'); return; }
      const n = tentativi + 1;
      setTentativi(n); setPin('');
      setErrore(n >= 5 ? 'Troppi tentativi. Riprova tra 30 secondi.' : 'PIN non corretto.');
      if (n >= 5) setTimeout(() => { setTentativi(0); setErrore(''); }, 30000);
    } catch (e) {
      setPin(''); setErrore((e as Error).message);
    } finally { setVerifica(false); }
  };

  return (
    <main className="flex h-full flex-col bg-bg text-text">
      <header className="flex h-14 flex-none items-center justify-between px-4">
        <span className="text-base font-bold tracking-tight">{nomeLocale}</span>
        <time className="text-lg font-semibold tabular-nums text-text-muted">{ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</time>
      </header>
      <div className="grid flex-1 place-items-center p-4">
        <div className="w-full max-w-[320px]">
          <h1 className="mb-1 text-center text-xl font-bold tracking-tight">Chi sta lavorando?</h1>
          <p className="mb-7 text-center text-base text-text-muted">Inserisci il tuo PIN</p>
          <label className="sr-only" htmlFor="pin">PIN</label>
          <input id="pin" type="password" inputMode="numeric" autoFocus value={pin} aria-describedby="pin-err"
            onKeyDown={(e) => { if (/^\d$/.test(e.key)) { e.preventDefault(); void premi(e.key); } if (e.key === 'Backspace') { e.preventDefault(); void premi('del'); } }}
            onChange={() => undefined} className="sr-only" />
          <div className="mb-3 flex h-6 items-center justify-center gap-4" aria-hidden="true">
            {verifica ? <Spinner /> : [0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-pill transition-transform duration-press ease-out ${i < pin.length ? 'scale-110 bg-text' : 'border-2 border-border-input'}`} />
            ))}
          </div>
          <p id="pin-err" role="alert" className="mb-5 h-6 text-center text-base font-semibold text-danger">{errore}</p>
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((t, i) =>
              t ? (
                <button key={i} type="button" disabled={bloccato} onClick={() => void premi(t)} aria-label={t === 'del' ? 'Cancella' : t}
                  className="premibile grid h-[72px] place-items-center rounded-md bg-surface text-[26px] font-semibold disabled:opacity-40">
                  {t === 'del' ? Icona.cancella : t}
                </button>
              ) : <span key={i} />,
            )}
          </div>
          {modalita === 'demo' && <p className="mt-6 text-center text-sm text-text-muted">Demo: Aldo 1111, Luca 2222, Benny 9999</p>}
        </div>
      </div>
      <footer className="flex justify-center p-4">
        <button type="button" onClick={() => void scollega()} className="premibile flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-text-muted">
          {Icona.esci}{modalita === 'demo' ? 'Esci dalla demo' : 'Scollega il dispositivo'}
        </button>
      </footer>
    </main>
  );
}
