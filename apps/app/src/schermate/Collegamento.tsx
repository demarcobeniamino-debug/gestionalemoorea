import { useState, type FormEvent } from 'react';
import { supabase } from '../dati/supabase';
import { Pulsante } from '../ui/primitivi';

// Primo avvio di un dispositivo: si collega con l'account del locale (uno per locale, condiviso da cassa, palmari e cucina).
// Chi lavora si riconosce poi con il PIN personale.
export function Collegamento({ onDemo, onCollegato, errore: erroreIniziale }: { onDemo: () => void; onCollegato: () => void; errore?: string }) {
  const [modo, setModo] = useState<'accedi' | 'crea'>('accedi');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState(erroreIniziale ?? '');
  const [info, setInfo] = useState('');
  const [attesa, setAttesa] = useState(false);

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    setErrore(''); setInfo(''); setAttesa(true);
    try {
      if (modo === 'accedi') {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message.includes('Invalid login') ? 'Email o password non corretti.' : error.message.includes('not confirmed') ? 'Conferma prima l’indirizzo email dal link che ti abbiamo mandato.' : error.message);
        onCollegato();
      } else {
        if (password.length < 10) throw new Error('Usa una password di almeno 10 caratteri: protegge cassa e incassi.');
        const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
        if (error) throw new Error(error.message);
        if (data.session) onCollegato();
        else { setInfo('Account creato. Apri l’email di conferma, poi torna qui e accedi.'); setModo('accedi'); }
      }
    } catch (err) {
      setErrore((err as Error).message);
    } finally { setAttesa(false); }
  };

  return (
    <main className="grid min-h-full place-items-center bg-bg p-4 text-text">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-2 text-xl font-bold tracking-tight">{modo === 'accedi' ? 'Collega questo dispositivo' : 'Crea l’account del locale'}</h1>
        <p className="mb-6 text-base text-text-muted">
          {modo === 'accedi'
            ? 'Usa l’account del locale. Si fa una volta sola per ogni cassa, palmare o schermo della cucina.'
            : 'Un solo account per il locale. I camerieri entrano poi con il loro PIN.'}
        </p>
        <form onSubmit={invia} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="h-touch rounded-md border border-border-input bg-surface px-3 text-base font-normal text-text outline-none focus:border-focus" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Password
            <input type="password" autoComplete={modo === 'accedi' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)}
              aria-describedby="coll-msg" className="h-touch rounded-md border border-border-input bg-surface px-3 text-base font-normal text-text outline-none focus:border-focus" />
          </label>
          <p id="coll-msg" role={errore ? 'alert' : 'status'} className={`min-h-[1.5rem] text-sm font-semibold ${errore ? 'text-danger' : 'text-success'}`}>{errore || info}</p>
          <Pulsante type="submit" variante="primario" taglia="lg" caricamento={attesa} disabled={!email || !password}>
            {modo === 'accedi' ? 'Collega' : 'Crea account'}
          </Pulsante>
        </form>
        <div className="mt-4 flex flex-col gap-2">
          <Pulsante variante="fantasma" onClick={() => { setModo(modo === 'accedi' ? 'crea' : 'accedi'); setErrore(''); setInfo(''); }}>
            {modo === 'accedi' ? 'Primo avvio? Crea l’account del locale' : 'Ho già l’account: accedi'}
          </Pulsante>
          <Pulsante variante="secondario" onClick={onDemo}>Prova la demo, senza account</Pulsante>
        </div>
      </div>
    </main>
  );
}
