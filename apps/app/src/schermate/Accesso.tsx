import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../dati/contesto';

// S01 — accesso operatore con PIN. Il dispositivo è già autenticato: qui si sceglie solo chi lavora.
export function Accesso() {
  const { db, setOperatore } = useApp();
  const nav = useNavigate();
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState('');
  const [tentativi, setTentativi] = useState(0);
  const bloccato = tentativi >= 3;

  const premi = (t: string) => {
    if (bloccato) return;
    setErrore('');
    if (t === '⌫') return setPin((p) => p.slice(0, -1));
    const nuovo = (pin + t).slice(0, 4);
    setPin(nuovo);
    if (nuovo.length === 4) {
      const o = db.login(nuovo);
      if (o) { setOperatore(o); nav('/sala'); }
      else {
        setTentativi((n) => n + 1); setPin('');
        setErrore(tentativi + 1 >= 3 ? 'Troppi tentativi. Attendi 30 secondi.' : 'PIN non corretto.');
        if (tentativi + 1 >= 3) setTimeout(() => { setTentativi(0); setErrore(''); }, 30000);
      }
    }
  };

  return (
    <main className="grid h-full place-items-center bg-bg p-4">
      <div className="w-full max-w-[340px]">
        <h1 className="mb-1 text-center text-xl font-bold">Chi sta lavorando?</h1>
        <p className="mb-6 text-center text-base text-text-muted">Inserisci il tuo PIN a 4 cifre</p>
        <label className="sr-only" htmlFor="pin">PIN</label>
        <input id="pin" type="password" inputMode="numeric" autoFocus value={pin} readOnly={false}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); if (v.length > pin.length) premi(v.slice(-1)); else setPin(v); }}
          className="sr-only" aria-describedby="pin-err" />
        <div className="mb-3 flex justify-center gap-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-4 w-4 rounded-pill border-2 border-border-input ${i < pin.length ? 'bg-text' : ''}`} />
          ))}
        </div>
        <p id="pin-err" role="alert" className="mb-4 h-6 text-center text-base font-semibold text-danger">{errore}</p>
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((t, i) =>
            t ? (
              <button key={i} type="button" disabled={bloccato} onClick={() => premi(t)} aria-label={t === '⌫' ? 'Cancella' : t}
                className="h-16 rounded-md bg-surface-2 text-xl font-semibold disabled:opacity-40 active:scale-[.98]">{t}</button>
            ) : <span key={i} />,
          )}
        </div>
        <p className="mt-6 text-center text-xs text-text-muted">Demo: Aldo 1111 · Luca 2222 · Benny 9999</p>
      </div>
    </main>
  );
}
