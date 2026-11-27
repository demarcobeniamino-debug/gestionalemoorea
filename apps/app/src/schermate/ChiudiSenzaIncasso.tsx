// Due modi di chiudere un conto senza incassare:
// - Proforma: famiglia, amici, staff. Niente scontrino, ma i prodotti sono consumati (scarico di magazzino) e il valore resta registrato.
// - Elimina conto: aperto per errore, prova, clienti andati via. Le righe vengono stornate, i reparti avvisati.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { euro } from '@gr/core';
import { nuovaChiave, useApp, useAzione } from '../dati/contesto';
import { puoGestire } from '../dati/ruoli';
import { TastierinoPin, verificaResponsabile } from '../ui/PinResponsabile';
import { Interruttore } from '../ui/campi';
import { Pulsante } from '../ui/primitivi';

const MOTIVI_ELIMINA = ['Aperto per errore', 'Prova', 'Clienti andati via', 'Conto doppio'];
const MOTIVI_PROFORMA = ['Famiglia', 'Amici', 'Staff', 'Ospite della casa', 'Fornitore'];

/** Motivo a scelta rapida + "Altro", PIN del responsabile se serve. Restituisce chi autorizza. */
function useAutorizzazione(motivi: string[]) {
  const { db, operatore } = useApp();
  const [motivo, setMotivo] = useState(motivi[0]);
  const [altro, setAltro] = useState('');
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const serveResponsabile = !puoGestire(operatore?.ruolo);
  const testo = motivo === 'Altro' ? altro.trim() : motivo;
  const autorizza = async () => {
    if (!testo) { setErrore('Scrivi il motivo'); return null; }
    if (!serveResponsabile) return operatore ?? undefined;
    const r = await verificaResponsabile(db, pin).catch(() => null);
    if (!r) { setPin(''); setErrore('Serve il PIN di un responsabile'); return null; }
    return r;
  };
  return { motivo, setMotivo, altro, setAltro, pin, setPin, errore, setErrore, serveResponsabile, testo, autorizza };
}
type Aut = ReturnType<typeof useAutorizzazione>;

function SceltaMotivo({ a, motivi, colore }: { a: Aut; motivi: string[]; colore: 'pericolo' | 'accento' }) {
  const on = colore === 'pericolo' ? 'bg-danger text-on-danger' : 'bg-accent text-on-accent';
  return (
    <>
      <div role="radiogroup" aria-label="Motivo" className="flex flex-wrap gap-2">
        {[...motivi, 'Altro'].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={a.motivo === m} onClick={() => { a.setMotivo(m); a.setErrore(null); }}
            className={`premibile h-11 rounded-pill px-4 text-[15px] font-semibold ${a.motivo === m ? on : 'border border-border bg-bg'}`}>{m}</button>
        ))}
      </div>
      {a.motivo === 'Altro' && (
        <input value={a.altro} onChange={(e) => a.setAltro(e.target.value)} placeholder="Scrivi il motivo" aria-label="Motivo" autoFocus
          className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
      )}
    </>
  );
}

function CodaAutorizzazione({ a }: { a: Aut }) {
  return (
    <>
      {a.serveResponsabile && <TastierinoPin pin={a.pin} onCambia={(p) => { a.setPin(p); a.setErrore(null); }} />}
      {a.errore && <p role="alert" className="text-sm font-semibold text-danger">{a.errore}</p>}
    </>
  );
}

export function EliminaConto({ comandaId, inviate, onFatto }: { comandaId: string; inviate: number; onFatto: () => void }) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const nav = useNavigate();
  const a = useAutorizzazione(MOTIVI_ELIMINA);
  const [avvisa, setAvvisa] = useState(true);
  const vai = async () => {
    const chi = await a.autorizza();
    if (chi === null) return;
    const ok = await esegui(() => db.annullaComanda(comandaId, a.testo, nuovaChiave(), chi, avvisa), 'Conto eliminato, il tavolo è libero');
    if (ok) { onFatto(); nav('/sala', { replace: true }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-text-muted">Per un conto aperto per errore o di prova. Niente scontrino, niente incasso, i piatti non risultano venduti. Resta nello storico come eliminato, con il motivo e chi l’ha fatto.</p>
      <p className="rounded-md bg-bg p-3 text-sm text-text-muted">Hai offerto il tavolo a famiglia o amici? Usa <strong className="text-text">Proforma</strong>: così i prodotti escono dal magazzino.</p>
      <SceltaMotivo a={a} motivi={MOTIVI_ELIMINA} colore="pericolo" />
      {inviate > 0 && (
        <Interruttore etichetta="Avvisa cucina e bar" descrizione={`${inviate === 1 ? '1 piatto è già stato inviato' : `${inviate} piatti sono già stati inviati`}: ricevono uno storno “conto annullato”.`}
          attivo={avvisa} onCambia={setAvvisa} />
      )}
      <CodaAutorizzazione a={a} />
      <Pulsante variante="pericolo" taglia="lg" className="w-full" caricamento={inCorso} onClick={() => void vai()}>Elimina il conto</Pulsante>
    </div>
  );
}

export function Proforma({ comandaId, totaleCents, onFatto }: { comandaId: string; totaleCents: number; onFatto: () => void }) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const nav = useNavigate();
  const a = useAutorizzazione(MOTIVI_PROFORMA);
  const [nome, setNome] = useState('');
  const [stampa, setStampa] = useState(false);
  const vai = async () => {
    const chi = await a.autorizza();
    if (chi === null) return;
    const ok = await esegui(() => db.chiudiProforma(comandaId, { motivo: a.testo, nome, stampa }, nuovaChiave(), chi), 'Proforma chiuso, il tavolo è libero');
    if (ok) { onFatto(); nav('/sala', { replace: true }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between rounded-md bg-bg px-4 py-3">
        <span className="text-[15px] font-semibold text-text-muted">Valore del conto</span>
        <span className="text-2xl font-bold tabular-nums">{euro(totaleCents)}</span>
      </div>
      <p className="text-[15px] text-text-muted">Non incassi e non esce lo scontrino, ma i prodotti risultano consumati e scaricati dal magazzino. In Cassa trovi il totale dei proforma a parte, fuori dall’incasso.</p>
      <SceltaMotivo a={a} motivi={MOTIVI_PROFORMA} colore="accento" />
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Per chi? (facoltativo, es. Zia Anna)" aria-label="Per chi"
        className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
      <Interruttore etichetta="Stampa il proforma" descrizione="Un foglio non fiscale sulla stampante del preconto, con scritto NON INCASSATO." attivo={stampa} onCambia={setStampa} />
      <CodaAutorizzazione a={a} />
      <Pulsante variante="primario" taglia="lg" className="w-full" caricamento={inCorso} onClick={() => void vai()}>Chiudi come proforma</Pulsante>
    </div>
  );
}
