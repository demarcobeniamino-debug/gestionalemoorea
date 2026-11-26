// Personale: chi entra con il PIN e cosa può fare.
import { useState } from 'react';
import { Plus, UserCircle } from '@phosphor-icons/react';
import type { OperatoreRiga, RuoloOperatore } from '@gr/core';
import { useApp } from '../../dati/contesto';
import { Foglio, Pulsante } from '../../ui/primitivi';
import { Interruttore, Segmenti, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle, Vuoto } from './Layout';

const RUOLI: { valore: RuoloOperatore; testo: string; cosa: string }[] = [
  { valore: 'cameriere', testo: 'Cameriere', cosa: 'Apre tavoli, prende comande, chiede il conto.' },
  { valore: 'cassiere', testo: 'Cassa', cosa: 'Come il cameriere, in più incassa e stampa scontrini.' },
  { valore: 'bar', testo: 'Bar', cosa: 'Prende comande al banco e vede il monitor del bar.' },
  { valore: 'cucina', testo: 'Cucina', cosa: 'Usa il monitor cucina e segna i piatti pronti.' },
  { valore: 'responsabile', testo: 'Responsabile', cosa: 'Tutto: sconti, annulli, chiusura di cassa, Gestione e statistiche.' },
];
const nomeRuolo = (r: string) => RUOLI.find((x) => x.valore === r)?.testo ?? r;

export function Personale() {
  const t = useTabelle();
  const [aperto, setAperto] = useState<OperatoreRiga | 'nuovo' | null>(null);
  const attivi = t.operatori.filter((o) => o.attivo);
  const spenti = t.operatori.filter((o) => !o.attivo);
  return (
    <Sezione titolo="Personale" sotto="Ognuno entra con il suo PIN: comande, storni e incassi restano firmati"
      azioni={<Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden="true" />} onClick={() => setAperto('nuovo')}>Nuova persona</Pulsante>}>
      <p className="mb-4 rounded-lg border border-warning px-4 py-3 text-sm">
        <strong>Prima del servizio:</strong> cambiate i PIN di prova (1111, 2222, 9999). Ogni persona deve avere un PIN suo, che non dice a nessuno.
      </p>
      {!attivi.length ? <Vuoto titolo="Nessuna persona" testo="Aggiungi camerieri, cassa e cucina con il loro PIN." /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {[...attivi, ...spenti].map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setAperto(o)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2 ${o.attivo ? '' : 'opacity-50'}`}>
                <UserCircle size={32} weight="duotone" aria-hidden="true" className="flex-none text-text-muted" />
                <span className="flex-1">
                  <span className="block text-base font-semibold">{o.nome}</span>
                  <span className="block text-sm text-text-muted">{nomeRuolo(o.ruolo)}{o.attivo ? '' : ' · non attivo'}</span>
                </span>
                <span className="font-mono text-sm tracking-[0.3em] text-text-muted" aria-label="PIN nascosto">••••</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {aperto && <EditorOperatore key={aperto === 'nuovo' ? 'n' : aperto.id} operatore={aperto === 'nuovo' ? null : aperto} onChiudi={() => setAperto(null)} />}
    </Sezione>
  );
}

function EditorOperatore({ operatore, onChiudi }: { operatore: OperatoreRiga | null; onChiudi: () => void }) {
  const { archivio, esegui, inCorso } = useSalva();
  const { operatore: io } = useApp();
  const [nome, setNome] = useState(operatore?.nome ?? '');
  const [ruolo, setRuolo] = useState<RuoloOperatore>(operatore?.ruolo ?? 'cameriere');
  const [pin, setPin] = useState('');
  const [attivo, setAttivo] = useState(operatore?.attivo ?? true);
  const [errPin, setErrPin] = useState<string | null>(null);
  const sonoIo = operatore?.id === io?.id;

  const salva = () => esegui(async () => {
    if (pin && !/^\d{4,6}$/.test(pin)) { setErrPin('Da 4 a 6 cifre'); throw new Error('Il PIN deve avere da 4 a 6 cifre.'); }
    if (!operatore && !pin) { setErrPin('Serve un PIN'); throw new Error('Scegli un PIN per la nuova persona.'); }
    if (sonoIo && (!attivo || ruolo !== 'responsabile' && ruolo !== 'admin')) throw new Error('Non puoi togliere a te stesso il ruolo di responsabile.');
    await archivio.salvaOperatore({ id: operatore?.id, nome, ruolo, pin: pin || undefined, attivo });
    onChiudi();
  }, operatore ? (pin ? 'PIN cambiato' : 'Salvato') : 'Persona aggiunta');

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={operatore ? operatore.nome : 'Nuova persona'} piede={<>
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
    </>}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!operatore} placeholder="Es. Valentina" />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-muted">Ruolo</p>
          <Segmenti etichetta="Ruolo" valore={ruolo} onCambia={setRuolo} opzioni={RUOLI.map((r) => ({ valore: r.valore, testo: r.testo }))} />
          <p className="mt-2 text-sm text-text-muted">{RUOLI.find((r) => r.valore === ruolo)?.cosa}</p>
        </div>
        <Testo etichetta={operatore ? 'Nuovo PIN (lascia vuoto per non cambiarlo)' : 'PIN'} value={pin} errore={errPin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErrPin(null); }}
          type="password" inputMode="numeric" autoComplete="new-password" placeholder="4–6 cifre" aiuto="Non può essere uguale a quello di un collega." />
        {operatore && <Interruttore etichetta="Attivo" descrizione="Se lo spegni, il PIN non funziona più. Lo storico resta." attivo={attivo} onCambia={setAttivo} />}
      </div>
    </Foglio>
  );
}
