// Azioni sul tavolo dalla comanda: sposta su un altro tavolo, unisci un altro tavolo, sposta alcuni piatti, annulla il conto.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight, ArrowsMerge, ForkKnife, Trash } from '@phosphor-icons/react';
import { euro, importoRiga, type Comanda } from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { puoGestire } from '../dati/ruoli';
import { TastierinoPin, verificaResponsabile } from '../ui/PinResponsabile';
import { Interruttore } from '../ui/campi';
import { Foglio, Pulsante } from '../ui/primitivi';

type Vista = 'menu' | 'sposta' | 'unisci' | 'piatti' | 'piatti-dove' | 'annulla';

export function AzioniTavolo({ comanda, aperto, onChiudi, onSpostata }: {
  comanda: Comanda; aperto: boolean; onChiudi: () => void; onSpostata?: (nuovaComandaId: string) => void;
}) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const { setup, aperte, righe } = useDati((d) => ({ setup: d.setup(), aperte: d.comandeAperte(), righe: d.righe(comanda.id) }));
  const [vista, setVista] = useState<Vista>('menu');
  const [scelte, setScelte] = useState<string[]>([]);
  const chiudi = () => { setVista('menu'); setScelte([]); onChiudi(); };
  const numero = (tavoloId: string | null) => setup.tavoli.find((t) => t.id === tavoloId)?.numero ?? '?';
  const altri = aperte.filter((c) => c.id !== comanda.id && c.tavoloId);
  const spostabili = righe.filter((r) => r.stato !== 'stornata');

  const titolo = { menu: `Tavolo ${numero(comanda.tavoloId)}`, sposta: 'Sposta su un tavolo libero', unisci: 'Unisci un altro tavolo a questo', piatti: 'Quali piatti spostare?', 'piatti-dove': 'Su quale tavolo?', annulla: `Annullare il conto del tavolo ${numero(comanda.tavoloId)}?` }[vista];
  const conScontrino = db.documenti(comanda.id).some((d) => d.tipo === 'documento_commerciale' && ['emesso', 'in_emissione', 'da_verificare'].includes(d.stato));

  return (
    <Foglio aperto={aperto} onChiudi={chiudi} titolo={titolo}>
      {vista === 'menu' && (
        <div className="flex flex-col gap-2">
          <Voce icona={<ArrowsLeftRight size={22} weight="bold" aria-hidden />} titolo="Sposta tavolo" testo="Il conto passa su un tavolo libero, con tutto quello che è stato ordinato." onClick={() => setVista('sposta')} />
          <Voce icona={<ArrowsMerge size={22} weight="bold" aria-hidden />} titolo="Unisci tavoli" testo="Porta qui piatti e coperti di un altro tavolo aperto: un solo conto." onClick={() => setVista('unisci')} disabled={!altri.length} />
          <Voce icona={<ForkKnife size={22} weight="bold" aria-hidden />} titolo="Sposta piatti" testo="Alcuni piatti vanno sul conto di un altro tavolo (es. chi si sposta al bar)." onClick={() => setVista('piatti')} disabled={!spostabili.length || !altri.length} />
          <Voce pericolo icona={<Trash size={22} weight="bold" aria-hidden />} titolo="Annulla conto"
            testo={conScontrino ? 'C’è già uno scontrino: prima va annullato dalla Cassa.' : 'Chiude il conto senza incassare (prove, tavolo aperto per errore). Il tavolo torna libero.'}
            onClick={() => setVista('annulla')} disabled={conScontrino} />
        </div>
      )}

      {vista === 'annulla' && <AnnullaConto comandaId={comanda.id} inviate={righe.filter((r) => !['da_inviare', 'in_attesa_marcia', 'stornata'].includes(r.stato)).length} onFatto={chiudi} />}

      {vista === 'sposta' && (
        <SceltaTavolo escludi={aperte.map((c) => c.tavoloId).filter((x): x is string => !!x)} onScegli={(tavoloId) => void esegui(async () => {
          await db.spostaComanda(comanda.id, tavoloId); chiudi();
        }, `Spostato sul tavolo ${numero(tavoloId)}`)} />
      )}

      {vista === 'unisci' && (
        <ListaAperti comande={altri} numero={numero} conto={(c) => db.righe(c.id)} onScegli={(c) => void esegui(async () => {
          await db.unisciComande(comanda.id, c.id); chiudi();
        }, `Tavolo ${numero(c.tavoloId)} unito`)} />
      )}

      {vista === 'piatti' && (
        <>
          <ul className="mb-4 flex flex-col gap-1">
            {spostabili.map((r) => {
              const on = scelte.includes(r.id);
              return (
                <li key={r.id}>
                  <button type="button" aria-pressed={on} onClick={() => setScelte(on ? scelte.filter((x) => x !== r.id) : [...scelte, r.id])}
                    className={`premibile flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ${on ? 'bg-accent text-on-accent' : 'bg-bg'}`}>
                    <span className={`grid h-6 w-6 flex-none place-items-center rounded-sm border-2 text-sm font-bold ${on ? 'border-on-accent' : 'border-border-input'}`} aria-hidden="true">{on ? '✓' : ''}</span>
                    <span className="flex-1 font-semibold">{r.quantita} × {r.descrizione}</span>
                    <span className="tabular-nums">{euro(importoRiga(r), false)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pulsante variante="primario" taglia="lg" className="w-full" disabled={!scelte.length} onClick={() => setVista('piatti-dove')}>
            Avanti{scelte.length ? ` (${scelte.length})` : ''}
          </Pulsante>
        </>
      )}

      {vista === 'piatti-dove' && (
        <ListaAperti comande={altri} numero={numero} conto={(c) => db.righe(c.id)} onScegli={(c) => void esegui(async () => {
          await db.spostaRighe(scelte, c.id); chiudi();
        }, `${scelte.length} piatti spostati sul tavolo ${numero(c.tavoloId)}`)} />
      )}
      {inCorso && <p className="mt-3 text-sm text-text-muted" role="status">Un momento…</p>}
    </Foglio>
  );
}

function Voce({ icona, titolo, testo, onClick, disabled, pericolo }: { icona: ReactNode; titolo: string; testo: string; onClick: () => void; disabled?: boolean; pericolo?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`premibile flex items-start gap-3 rounded-md bg-bg p-3 text-left disabled:opacity-40 ${pericolo ? 'mt-2' : ''}`}>
      <span className={`grid h-11 w-11 flex-none place-items-center rounded-md ${pericolo ? 'bg-danger text-on-danger' : 'bg-surface-2 text-accent'}`}>{icona}</span>
      <span className="flex flex-col">
        <span className="text-base font-semibold">{titolo}</span>
        <span className="text-sm text-text-muted">{testo}</span>
      </span>
    </button>
  );
}

function SceltaTavolo({ escludi, onScegli }: { escludi: string[]; onScegli: (tavoloId: string) => void }) {
  const { setup } = useDati((d) => ({ setup: d.setup() }));
  return (
    <div className="flex flex-col gap-4">
      {setup.sale.map((s) => {
        const liberi = setup.tavoli.filter((t) => t.salaId === s.id && !escludi.includes(t.id));
        if (!liberi.length) return null;
        return (
          <section key={s.id}>
            <h3 className="mb-2 text-sm font-semibold text-text-muted">{s.nome}</h3>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
              {liberi.map((t) => (
                <button key={t.id} type="button" onClick={() => onScegli(t.id)} aria-label={`Tavolo ${t.numero}, ${t.posti} posti`}
                  className="premibile flex h-14 flex-col items-center justify-center rounded-md border-2 border-tavolo-libero-bordo bg-tavolo-libero">
                  <span className="text-lg font-bold leading-none">{t.numero}</span>
                  <span className="text-[11px] text-text-muted">{t.posti} p.</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ListaAperti({ comande, numero, conto, onScegli }: {
  comande: Comanda[]; numero: (id: string | null) => string; conto: (c: Comanda) => { stato: string; quantita: number; prezzoUnitarioCents: number }[];
  onScegli: (c: Comanda) => void;
}) {
  if (!comande.length) return <p className="text-text-muted">Non ci sono altri tavoli aperti.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {comande.map((c) => {
        const righe = conto(c).filter((r) => r.stato !== 'stornata');
        return (
          <li key={c.id}>
            <button type="button" onClick={() => onScegli(c)} className="premibile flex w-full items-center gap-3 rounded-md bg-bg p-3 text-left">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-md bg-tavolo-occupato text-lg font-bold text-on-tavolo">{numero(c.tavoloId)}</span>
              <span className="flex-1">
                <span className="block font-semibold">{c.coperti} coperti · {c.operatore || 'n.d.'}</span>
                <span className="block text-sm text-text-muted">{righe.length} righe</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const MOTIVI = ['Prova', 'Aperto per errore', 'Clienti andati via', 'Offerto dalla casa'];

function AnnullaConto({ comandaId, inviate, onFatto }: { comandaId: string; inviate: number; onFatto: () => void }) {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const nav = useNavigate();
  const [motivo, setMotivo] = useState('Prova');
  const [altro, setAltro] = useState('');
  const [avvisa, setAvvisa] = useState(true);
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const serveResponsabile = !puoGestire(operatore?.ruolo);
  const testo = motivo === 'Altro' ? altro.trim() : motivo;

  const vai = async () => {
    if (!testo) return setErrore('Scrivi il motivo');
    let chi = operatore ?? undefined;
    if (serveResponsabile) {
      const r = await verificaResponsabile(db, pin).catch(() => null);
      if (!r) { setPin(''); return setErrore('Serve il PIN di un responsabile'); }
      chi = r;
    }
    const ok = await esegui(() => db.annullaComanda(comandaId, testo, nuovaChiave(), chi, avvisa), 'Conto annullato, il tavolo è libero');
    if (ok) { onFatto(); nav('/sala', { replace: true }); }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-text-muted">Il conto si chiude senza scontrino e senza incasso. Resta nello storico come annullato, con il motivo e chi l’ha fatto.</p>
      <div role="radiogroup" aria-label="Motivo" className="flex flex-wrap gap-2">
        {[...MOTIVI, 'Altro'].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={motivo === m} onClick={() => { setMotivo(m); setErrore(null); }}
            className={`premibile h-11 rounded-pill px-4 text-[15px] font-semibold ${motivo === m ? 'bg-danger text-on-danger' : 'border border-border bg-bg'}`}>{m}</button>
        ))}
      </div>
      {motivo === 'Altro' && (
        <input value={altro} onChange={(e) => setAltro(e.target.value)} placeholder="Scrivi il motivo" aria-label="Motivo" autoFocus
          className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
      )}
      {inviate > 0 && (
        <Interruttore etichetta="Avvisa cucina e bar" descrizione={`${inviate === 1 ? '1 piatto è già stato inviato' : `${inviate} piatti sono già stati inviati`}: ricevono uno storno “conto annullato”.`}
          attivo={avvisa} onCambia={setAvvisa} />
      )}
      {serveResponsabile && <TastierinoPin pin={pin} onCambia={(p) => { setPin(p); setErrore(null); }} />}
      {errore && <p role="alert" className="text-sm font-semibold text-danger">{errore}</p>}
      <Pulsante variante="pericolo" taglia="lg" className="w-full" caricamento={inCorso} onClick={() => void vai()}>Annulla il conto</Pulsante>
    </div>
  );
}
