// Clienti: scheda (contatti, allergie, preferenze, dati per la fattura), scelta del cliente per il conto, storico.
import { useEffect, useState } from 'react';
import { Cake, Phone, Plus, Receipt, UserCircle, Warning, X } from '@phosphor-icons/react';
import {
  ALLERGENI_ETICHETTA, controllaIntestatario, euro, nomeCliente,
  type Allergene, type Cliente, type ClienteNuovo, type Comanda, type StoricoCliente,
} from '@gr/core';
import { useApp, useAzione } from '../dati/contesto';
import { Foglio, Pulsante, Spinner } from '../ui/primitivi';
import { Interruttore, Segmenti, Testo } from '../ui/campi';

const ALLERGENI = Object.keys(ALLERGENI_ETICHETTA) as Allergene[];
const vuoto = (): ClienteNuovo => ({ nome: '', allergeni: [], scontoPct: 0, consensoMarketing: false });
const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Ricerca con attesa breve: si scrive e i risultati arrivano. */
export function useCercaClienti(testo: string, attivo = true) {
  const { db } = useApp();
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [giro, setGiro] = useState(0);
  useEffect(() => {
    if (!attivo) return;
    let vivo = true;
    const t = setTimeout(() => { db.cercaClienti(testo).then((l) => vivo && setLista(l)).catch(() => vivo && setLista([])); }, 220);
    return () => { vivo = false; clearTimeout(t); };
  }, [db, testo, attivo, giro]);
  return { lista, ricarica: () => setGiro((g) => g + 1) };
}

export function RigaCliente({ c, onClick, destra }: { c: Cliente; onClick: () => void; destra?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2">
      <UserCircle size={32} weight="duotone" aria-hidden className="flex-none text-text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{nomeCliente(c)}</span>
        <span className="block truncate text-sm text-text-muted">
          {[c.telefono, c.piva ? `P.IVA ${c.piva}` : c.codiceFiscale, c.email].filter(Boolean).join(' · ') || 'Nessun contatto'}
        </span>
      </span>
      {c.allergeni.length > 0 && (
        <span className="flex items-center gap-1 rounded-pill bg-allergene px-2.5 py-0.5 text-xs font-bold text-on-allergene">
          <Warning size={12} weight="fill" aria-hidden />{c.allergeni.length === 1 ? ALLERGENI_ETICHETTA[c.allergeni[0]] : `${c.allergeni.length} allergie`}
        </span>
      )}
      {destra}
    </button>
  );
}

export function Storico({ clienteId }: { clienteId: string }) {
  const { db } = useApp();
  const [s, setS] = useState<StoricoCliente | null>(null);
  useEffect(() => { let v = true; db.storicoCliente(clienteId).then((x) => v && setS(x)).catch(() => v && setS(null)); return () => { v = false; }; }, [db, clienteId]);
  if (!s) return <div className="grid h-20 place-items-center"><Spinner /></div>;
  if (!s.visite && !s.fatture.length) return <p className="text-sm text-text-muted">Prima visita: ancora nessun conto collegato.</p>;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-border text-center">
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">Visite</dt><dd className="text-lg font-bold tabular-nums">{s.visite}</dd></div>
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">Speso</dt><dd className="text-lg font-bold tabular-nums">{euro(s.spesaCents)}</dd></div>
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">Ultima</dt><dd className="text-sm font-bold leading-7">{data(s.ultimaVisita) || '—'}</dd></div>
      </dl>
      {s.piatti.length > 0 && (
        <p className="text-sm"><span className="font-semibold text-text-muted">Ordina spesso: </span>{s.piatti.slice(0, 5).map((p) => `${p.descrizione} (${p.quantita})`).join(', ')}</p>
      )}
      {s.fatture.length > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-text-muted"><Receipt size={16} aria-hidden />{s.fatture.length} {s.fatture.length === 1 ? 'fattura' : 'fatture'}, ultima n. {s.fatture[0].numero}/{s.fatture[0].anno}</p>
      )}
    </div>
  );
}

export function EditorCliente({ cliente, aperto, onChiudi, onSalvato, perFattura }: {
  cliente: Cliente | null; aperto: boolean; onChiudi: () => void; onSalvato: (c: Cliente) => void; perFattura?: boolean;
}) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const [v, setV] = useState<ClienteNuovo>(vuoto);
  const [tipo, setTipo] = useState<'privato' | 'azienda'>('privato');
  useEffect(() => {
    if (!aperto) return;
    setV(cliente ? { ...cliente } : vuoto());
    setTipo(cliente?.piva || cliente?.ragioneSociale ? 'azienda' : 'privato');
  }, [aperto, cliente]);
  const set = <K extends keyof ClienteNuovo>(k: K, x: ClienteNuovo[K]) => setV((p) => ({ ...p, [k]: x }));
  const ind = v.indirizzoFiscale ?? { via: '', cap: '', comune: '', nazione: 'IT' };
  const setInd = (k: keyof typeof ind, x: string) => set('indirizzoFiscale', { ...ind, [k]: x });
  const mancano = (v.piva || v.codiceFiscale || perFattura) ? controllaIntestatario({ ...v, id: '' } as Cliente) : [];

  const salva = () => void esegui(async () => {
    const pulito: ClienteNuovo = tipo === 'privato' ? { ...v, ragioneSociale: undefined, piva: undefined } : v;
    if (!pulito.indirizzoFiscale?.via && !pulito.indirizzoFiscale?.comune) pulito.indirizzoFiscale = undefined;
    const c = await db.salvaCliente(pulito);
    onSalvato(c);
  }, cliente ? 'Cliente aggiornato' : 'Cliente aggiunto');

  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo={cliente ? nomeCliente(cliente) : 'Nuovo cliente'} piede={<>
      {perFattura && mancano.length > 0 && <p className="mr-auto text-sm font-semibold text-warning">Per la fattura manca: {mancano.join(', ')}</p>}
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={salva}>Salva</Pulsante>
    </>}>
      <div className="flex flex-col gap-5">
        <Segmenti etichetta="Tipo di cliente" valore={tipo} onCambia={setTipo} opzioni={[{ valore: 'privato', testo: 'Persona' }, { valore: 'azienda', testo: 'Azienda / partita IVA' }]} />
        {tipo === 'azienda' && <Testo etichetta="Ragione sociale" value={v.ragioneSociale ?? ''} onChange={(e) => set('ragioneSociale', e.target.value)} placeholder="es. Rossi S.r.l." />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Testo etichetta={tipo === 'azienda' ? 'Nome del referente' : 'Nome'} value={v.nome} onChange={(e) => set('nome', e.target.value)} autoFocus={!cliente} />
          <Testo etichetta="Cognome" value={v.cognome ?? ''} onChange={(e) => set('cognome', e.target.value)} />
          <Testo etichetta="Telefono" type="tel" inputMode="tel" value={v.telefono ?? ''} onChange={(e) => set('telefono', e.target.value)} placeholder="+39 …" />
          <Testo etichetta="Email" type="email" inputMode="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <Testo etichetta="Compleanno" type="date" value={v.compleanno ?? ''} onChange={(e) => set('compleanno', e.target.value)} />
          <Testo etichetta="Sconto abituale (%)" inputMode="numeric" value={v.scontoPct ? String(v.scontoPct) : ''}
            onChange={(e) => set('scontoPct', Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))} placeholder="0" />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text-muted">Allergie e intolleranze</legend>
          <div className="flex flex-wrap gap-2">
            {ALLERGENI.map((a) => {
              const on = v.allergeni.includes(a);
              return (
                <button key={a} type="button" aria-pressed={on} onClick={() => set('allergeni', on ? v.allergeni.filter((x) => x !== a) : [...v.allergeni, a])}
                  className={`premibile h-10 rounded-pill px-3.5 text-sm font-semibold ${on ? 'bg-allergene text-on-allergene' : 'border border-border bg-bg'}`}>{ALLERGENI_ETICHETTA[a]}</button>
              );
            })}
          </div>
          <Testo className="mt-3" etichetta="Note sulle allergie" value={v.noteAllergie ?? ''} onChange={(e) => set('noteAllergie', e.target.value)} placeholder="es. celiaco, anche tracce" />
        </fieldset>
        <Testo etichetta="Preferenze" value={v.preferenze ?? ''} onChange={(e) => set('preferenze', e.target.value)} placeholder="es. tavolo vista mare, acqua frizzante, niente cipolla" />

        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-1 text-base font-bold">Dati per la fattura</h3>
          <p className="mb-4 text-sm text-text-muted">Servono solo se chiede la fattura. {tipo === 'azienda' ? 'Partita IVA e codice destinatario (o PEC).' : 'Codice fiscale e indirizzo.'}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {tipo === 'azienda' && <Testo etichetta="Partita IVA" inputMode="numeric" value={v.piva ?? ''} onChange={(e) => set('piva', e.target.value.replace(/[^\d]/g, '').slice(0, 11))} />}
            <Testo etichetta="Codice fiscale" value={v.codiceFiscale ?? ''} onChange={(e) => set('codiceFiscale', e.target.value.toUpperCase().slice(0, 16))} autoCapitalize="characters" />
            {tipo === 'azienda' && <>
              <Testo etichetta="Codice destinatario (SDI)" value={v.codiceSdi ?? ''} onChange={(e) => set('codiceSdi', e.target.value.toUpperCase().slice(0, 7))} placeholder="7 caratteri" />
              <Testo etichetta="PEC" type="email" value={v.pec ?? ''} onChange={(e) => set('pec', e.target.value)} />
            </>}
            <Testo className="sm:col-span-2" etichetta="Via e numero" value={[ind.via, ind.civico].filter(Boolean).join(', ')}
              onChange={(e) => { const [via, ...civ] = e.target.value.split(','); set('indirizzoFiscale', { ...ind, via: via.trimStart(), civico: civ.join(',').trim() || undefined }); }} placeholder="es. Via Roma, 12" />
            <Testo etichetta="CAP" inputMode="numeric" value={ind.cap} onChange={(e) => setInd('cap', e.target.value.replace(/\s/g, '').slice(0, 10))} />
            <Testo etichetta="Comune" value={ind.comune} onChange={(e) => setInd('comune', e.target.value)} />
            <Testo etichetta="Provincia (sigla)" value={ind.provincia ?? ''} onChange={(e) => setInd('provincia', e.target.value.toUpperCase().slice(0, 2))} placeholder="SA" />
            <Testo etichetta="Nazione" value={ind.nazione} onChange={(e) => setInd('nazione', e.target.value.toUpperCase().slice(0, 2))} placeholder="IT" />
          </div>
        </section>
        <Interruttore etichetta="Consenso alle comunicazioni" descrizione="Può ricevere offerte ed eventi via email o messaggio." attivo={v.consensoMarketing} onCambia={(x) => set('consensoMarketing', x)} />
      </div>
    </Foglio>
  );
}

/** Dal tavolo: collega un cliente al conto (o creane uno). Mostra allergie e storico. */
export function FoglioClienteTavolo({ aperto, comanda, onChiudi }: { aperto: boolean; comanda: Comanda; onChiudi: () => void }) {
  const { db } = useApp();
  const { esegui } = useAzione();
  const [cerca, setCerca] = useState('');
  const [attuale, setAttuale] = useState<Cliente | null>(null);
  const [editor, setEditor] = useState<{ c: Cliente | null } | null>(null);
  const { lista } = useCercaClienti(cerca, aperto && !comanda.clienteId);
  useEffect(() => {
    if (!aperto) return;
    setCerca('');
    if (comanda.clienteId) db.cliente(comanda.clienteId).then(setAttuale).catch(() => setAttuale(null)); else setAttuale(null);
  }, [aperto, comanda.clienteId, db]);

  const collega = (c: Cliente) => void esegui(async () => {
    await db.impostaCliente(comanda.id, c.id);
    // Allergie del cliente: si aggiungono al tavolo, così escono sulle comande.
    const nuove = c.allergeni.filter((a) => !comanda.allergeniTavolo.some((x) => x.allergene === a && !x.posto));
    if (nuove.length) await db.impostaAllergeni(comanda.id, [...comanda.allergeniTavolo, ...nuove.map((allergene) => ({ allergene }))]);
    setAttuale(c);
  }, `${nomeCliente(c)} collegato al conto`);

  return (<>
    <Foglio aperto={aperto && !editor} onChiudi={onChiudi} titolo="Cliente del tavolo">
      {attuale ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <UserCircle size={44} weight="duotone" aria-hidden className="flex-none text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">{nomeCliente(attuale)}</p>
              <p className="flex flex-wrap gap-x-3 text-sm text-text-muted">
                {attuale.telefono && <span className="flex items-center gap-1"><Phone size={14} aria-hidden />{attuale.telefono}</span>}
                {attuale.compleanno && <span className="flex items-center gap-1"><Cake size={14} aria-hidden />{new Date(attuale.compleanno).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</span>}
              </p>
            </div>
            <Pulsante taglia="md" onClick={() => setEditor({ c: attuale })}>Modifica</Pulsante>
          </div>
          {attuale.allergeni.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-allergene px-3 py-2 text-sm font-bold text-on-allergene">
              <Warning size={18} weight="fill" aria-hidden className="mt-px flex-none" />
              {attuale.allergeni.map((a) => ALLERGENI_ETICHETTA[a]).join(', ')}{attuale.noteAllergie ? ` — ${attuale.noteAllergie}` : ''}
            </p>
          )}
          {attuale.preferenze && <p className="text-[15px]"><span className="font-semibold text-text-muted">Preferenze: </span>{attuale.preferenze}</p>}
          {attuale.scontoPct > 0 && <p className="text-[15px]"><span className="font-semibold text-text-muted">Sconto abituale: </span>{attuale.scontoPct}%</p>}
          <Storico clienteId={attuale.id} />
          <button type="button" onClick={() => void esegui(async () => { await db.impostaCliente(comanda.id, null); setAttuale(null); }, 'Cliente tolto dal conto')}
            className="premibile mt-1 flex h-touch items-center justify-center gap-2 rounded-md text-sm font-semibold text-text-muted hover:bg-surface-2">
            <X size={16} aria-hidden />Togli dal conto
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Nome, telefono, email o P.IVA" aria-label="Cerca cliente" autoFocus
              className="h-touch min-w-0 flex-1 rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
            <Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditor({ c: null })}>Nuovo</Pulsante>
          </div>
          {lista === null ? <div className="grid h-24 place-items-center"><Spinner /></div>
            : lista.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">{cerca ? `Nessun cliente per “${cerca}”.` : 'Ancora nessun cliente in anagrafica.'}</p>
            : <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {lista.map((c) => <li key={c.id}><RigaCliente c={c} onClick={() => collega(c)} /></li>)}
              </ul>}
        </div>
      )}
    </Foglio>
    <EditorCliente aperto={!!editor} cliente={editor?.c ?? null} onChiudi={() => setEditor(null)}
      onSalvato={(c) => { setEditor(null); if (!attuale || attuale.id !== c.id) collega(c); else setAttuale(c); }} />
  </>);
}
