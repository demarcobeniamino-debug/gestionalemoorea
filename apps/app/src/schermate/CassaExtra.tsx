// Schede della cassa: cassetto (fondo, versamenti, prelievi, conteggio, contante atteso), sospesi e addebiti in camera
// da incassare, caparre dei gruppi.
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Bed, Calculator, CheckCircle, Coins, LockOpen, UserCircle, Vault } from '@phosphor-icons/react';
import { euro, TIPI_INCASSO_SOSPESO, type Caparra, type MovimentoCassa, type Sospeso, type TipoMovimentoCassa, type TipoPagamento } from '@gr/core';
import { nuovaChiave, useApp, useAzione } from '../dati/contesto';
import { CampoEuro, Testo, Segmenti } from '../ui/campi';
import { Foglio, Pulsante } from '../ui/primitivi';

const ora = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const giorno = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
const NOME_TIPO: Record<TipoPagamento, string> = { contanti: 'Contanti', carta: 'Carta', buono_pasto: 'Buono pasto', prepagata: 'Prepagata', sospeso: 'Sospeso', camera: 'Camera', bonifico: 'Bonifico' };

/** Ricarica quando cambia qualcosa nel servizio (al massimo ogni mezzo secondo). */
function useCarica<T>(f: () => Promise<T>) {
  const { db } = useApp();
  const [dati, setDati] = useState<T | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = useCallback(() => { f().then((x) => { setDati(x); setErrore(null); }).catch((e) => setErrore((e as Error).message)); }, [f]);
  useEffect(() => {
    carica();
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = db.subscribe(() => { clearTimeout(t); t = setTimeout(carica, 500); });
    return () => { clearTimeout(t); off(); };
  }, [db, carica]);
  return { dati, errore, carica };
}

const MOVIMENTI: { tipo: TipoMovimentoCassa; nome: string; testo: string; icona: React.ReactNode }[] = [
  { tipo: 'fondo', nome: 'Fondo cassa', testo: 'Il contante messo nel cassetto a inizio servizio.', icona: <Coins size={22} weight="bold" aria-hidden /> },
  { tipo: 'versamento', nome: 'Versamento', testo: 'Contante aggiunto (es. monete per il resto).', icona: <ArrowDown size={22} weight="bold" aria-hidden /> },
  { tipo: 'prelievo', nome: 'Prelievo', testo: 'Contante tolto (fornitore pagato, banca, mance).', icona: <ArrowUp size={22} weight="bold" aria-hidden /> },
  { tipo: 'conteggio', nome: 'Conteggio', testo: 'Quanto c’è davvero nel cassetto: la cassa calcola la differenza.', icona: <Calculator size={22} weight="bold" aria-hidden /> },
];

export function Cassetto({ contantiIncassati }: { contantiIncassati: number }) {
  const { db, operatore, stampaDaQui } = useApp();
  const { esegui, inCorso } = useAzione();
  const { dati: movimenti } = useCarica(useCallback(() => db.movimentiCassa(), [db]));
  const [nuovo, setNuovo] = useState<TipoMovimentoCassa | null>(null);
  const [importo, setImporto] = useState(0);
  const [causale, setCausale] = useState('');

  const somma = (t: TipoMovimentoCassa) => (movimenti ?? []).filter((m) => m.tipo === t).reduce((s, m) => s + m.importoCents, 0);
  const atteso = somma('fondo') + somma('versamento') - somma('prelievo') + contantiIncassati;
  const ultimoConteggio = (movimenti ?? []).filter((m) => m.tipo === 'conteggio').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const differenza = ultimoConteggio ? ultimoConteggio.importoCents - atteso : null;

  // Il conteggio parte dal contante atteso (aggiornato appena arrivano i movimenti), finché non lo si cambia.
  const [toccato, setToccato] = useState(false);
  useEffect(() => { if (nuovo === 'conteggio' && !toccato) setImporto(atteso); }, [nuovo, atteso, toccato]);

  const salva = () => void esegui(async () => {
    if (!nuovo) return;
    if (importo <= 0 && nuovo !== 'conteggio') throw new Error('Scrivi l’importo');
    if (nuovo === 'prelievo' && !causale.trim()) throw new Error('Scrivi la causale del prelievo');
    await db.registraMovimento(nuovo, importo, causale.trim(), nuovaChiave(), operatore ?? undefined);
    setNuovo(null); setImporto(0); setCausale('');
  }, 'Registrato');

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-4">
        <Riquadro etichetta="Fondo + versamenti" valore={euro(somma('fondo') + somma('versamento'))} />
        <Riquadro etichetta="Contanti incassati" valore={euro(contantiIncassati)} />
        <Riquadro etichetta="Prelievi" valore={euro(somma('prelievo'))} />
        <Riquadro etichetta="Contante atteso nel cassetto" valore={euro(atteso)} forte />
      </section>
      {differenza !== null && (
        <p role="status" className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm font-semibold ${differenza === 0 ? 'bg-success text-on-success' : 'bg-warning text-on-warning'}`}>
          <CheckCircle size={18} weight="fill" aria-hidden />
          Ultimo conteggio alle {ora(ultimoConteggio!.createdAt)}: {euro(ultimoConteggio!.importoCents)} · {differenza === 0 ? 'torna al centesimo' : `${differenza > 0 ? 'in più' : 'mancano'} ${euro(Math.abs(differenza))}`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {MOVIMENTI.map((m) => (
          <Pulsante key={m.tipo} taglia="md" icona={m.icona} onClick={() => { setNuovo(m.tipo); setToccato(false); setImporto(m.tipo === 'conteggio' ? atteso : 0); }}>{m.nome}</Pulsante>
        ))}
        <span className="flex-1" />
        <Pulsante taglia="md" icona={<LockOpen size={18} weight="bold" aria-hidden />} disabled={!stampaDaQui || inCorso}
          onClick={() => void esegui(() => db.apriCassetto(nuovaChiave()), 'Cassetto aperto')}>Apri cassetto</Pulsante>
      </div>
      <section aria-label="Movimenti di oggi" className="rounded-lg border border-border bg-surface">
        {!movimenti?.length ? <p className="p-6 text-center text-text-muted">Nessun movimento oggi. Inizia dal fondo cassa.</p> : (
          <ul className="divide-y divide-border">
            {movimenti.map((m: MovimentoCassa) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-12 font-mono text-sm tabular-nums text-text-muted">{ora(m.createdAt)}</span>
                <span className="flex-1"><span className="block font-semibold">{MOVIMENTI.find((x) => x.tipo === m.tipo)?.nome}</span>
                  <span className="block text-sm text-text-muted">{[m.causale, m.operatore].filter(Boolean).join(' · ')}</span></span>
                <span className={`font-semibold tabular-nums ${m.tipo === 'prelievo' ? 'text-danger' : ''}`}>{m.tipo === 'prelievo' ? '−' : ''}{euro(m.importoCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Foglio aperto={!!nuovo} onChiudi={() => setNuovo(null)} titolo={MOVIMENTI.find((x) => x.tipo === nuovo)?.nome ?? ''}>
        <p className="mb-4 text-sm text-text-muted">{MOVIMENTI.find((x) => x.tipo === nuovo)?.testo}</p>
        <div className="flex flex-col gap-4">
          <CampoEuro etichetta={nuovo === 'conteggio' ? 'Contante contato' : 'Importo'} valore={importo} onCambia={(c) => { setToccato(true); setImporto(c ?? 0); }} />
          <Testo etichetta={nuovo === 'prelievo' ? 'Causale' : 'Nota (facoltativa)'} value={causale} onChange={(e) => setCausale(e.target.value)} placeholder={nuovo === 'prelievo' ? 'es. pagato il pescivendolo' : ''} />
          <Pulsante variante="primario" taglia="lg" caricamento={inCorso} onClick={salva}>Registra</Pulsante>
        </div>
      </Foglio>
    </div>
  );
}

function Riquadro({ etichetta, valore, forte }: { etichetta: string; valore: string; forte?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${forte ? 'border-accent bg-surface-2' : 'border-border bg-surface'}`}>
      <p className="text-sm font-semibold text-text-muted">{etichetta}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${forte ? 'text-accent' : ''}`}>{valore}</p>
    </div>
  );
}

export function Sospesi() {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const { dati } = useCarica(useCallback(() => db.sospesi(), [db]));
  const [incasso, setIncasso] = useState<Sospeso | null>(null);
  const [tipo, setTipo] = useState<TipoPagamento>('contanti');
  const aperti = (dati ?? []).filter((s) => s.stato === 'aperto');
  const chiusi = (dati ?? []).filter((s) => s.stato !== 'aperto').slice(0, 30);
  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <Riquadro etichetta="Da incassare" valore={euro(aperti.reduce((s, x) => s + x.importoCents, 0))} forte />
        <Riquadro etichetta="Sospesi ai clienti" valore={String(aperti.filter((x) => x.tipo === 'sospeso').length)} />
        <Riquadro etichetta="Addebiti in camera" valore={String(aperti.filter((x) => x.tipo === 'camera').length)} />
      </section>
      <section aria-label="Da incassare" className="rounded-lg border border-border bg-surface">
        {!aperti.length ? <p className="p-6 text-center text-text-muted">Nessun conto in sospeso. Si lasciano dal conto: Altro → Sospeso o Addebito in camera.</p> : (
          <ul className="divide-y divide-border">
            {aperti.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {s.tipo === 'camera' ? <Bed size={20} weight="bold" aria-hidden className="text-text-muted" /> : <UserCircle size={20} weight="bold" aria-hidden className="text-text-muted" />}
                <span className="min-w-0 flex-1"><span className="block font-semibold">{s.descrizione ?? (s.tipo === 'camera' ? 'Camera' : 'Cliente')}</span>
                  <span className="block text-sm text-text-muted">{s.tipo === 'camera' ? 'Addebito in camera' : 'Sospeso'} · {giorno(s.createdAt)}</span></span>
                <span className="font-semibold tabular-nums">{euro(s.importoCents)}</span>
                <Pulsante taglia="md" variante="primario" onClick={() => { setIncasso(s); setTipo('contanti'); }}>Incassa</Pulsante>
              </li>
            ))}
          </ul>
        )}
      </section>
      {chiusi.length > 0 && (
        <section aria-label="Già incassati">
          <h3 className="mb-2 text-sm font-semibold text-text-muted">Già incassati</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {chiusi.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-text-muted">
                <span className="flex-1">{s.descrizione ?? s.tipo} · {giorno(s.createdAt)}</span>
                <span>{s.stato === 'annullato' ? 'annullato' : `${NOME_TIPO[s.incassatoTipo ?? 'contanti']} il ${s.incassatoAt ? giorno(s.incassatoAt) : ''}`}</span>
                <span className="tabular-nums">{euro(s.importoCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Foglio aperto={!!incasso} onChiudi={() => setIncasso(null)} titolo={`Incassa ${incasso ? euro(incasso.importoCents) : ''}`}>
        <p className="mb-4 text-sm text-text-muted">{incasso?.descrizione} · lo scontrino “non riscosso” è già uscito: qui si registra solo il pagamento.</p>
        <div role="radiogroup" aria-label="Come paga" className="mb-5 flex flex-wrap gap-2">
          {TIPI_INCASSO_SOSPESO.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
              className={`premibile h-11 rounded-pill px-4 text-[15px] font-semibold ${tipo === t ? 'bg-accent text-on-accent' : 'border border-border bg-bg'}`}>{NOME_TIPO[t]}</button>
          ))}
        </div>
        <Pulsante variante="primario" taglia="lg" className="w-full" caricamento={inCorso}
          onClick={() => void esegui(async () => { await db.incassaSospeso(incasso!.id, tipo, operatore ?? undefined); setIncasso(null); }, 'Incassato')}>Registra l’incasso</Pulsante>
      </Foglio>
    </div>
  );
}

export function Caparre() {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const { dati } = useCarica(useCallback(() => db.caparre(), [db]));
  const [nuova, setNuova] = useState(false);
  const [nome, setNome] = useState('');
  const [importo, setImporto] = useState(0);
  const [metodo, setMetodo] = useState<Caparra['metodo']>('carta');
  const [nota, setNota] = useState('');
  const aperte = (dati ?? []).filter((c) => c.stato === 'aperta');
  const altre = (dati ?? []).filter((c) => c.stato !== 'aperta').slice(0, 30);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-text-muted">Acconti dei gruppi e degli eventi. Al conto si usano da “Altro → Usa una caparra”: lo scontrino li riporta come CAPARRA.</p>
        <Pulsante variante="primario" taglia="md" icona={<Vault size={18} weight="bold" aria-hidden />} onClick={() => { setNuova(true); setNome(''); setImporto(0); setNota(''); }}>Nuova caparra</Pulsante>
      </div>
      <section aria-label="Caparre aperte" className="rounded-lg border border-border bg-surface">
        {!aperte.length ? <p className="p-6 text-center text-text-muted">Nessuna caparra aperta.</p> : (
          <ul className="divide-y divide-border">
            {aperte.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1"><span className="block font-semibold">{c.nome}</span>
                  <span className="block text-sm text-text-muted">{giorno(c.createdAt)} · {c.metodo}{c.nota ? ` · ${c.nota}` : ''}</span></span>
                <span className="font-semibold tabular-nums">{euro(c.importoCents)}</span>
                <Pulsante taglia="md" disabled={inCorso} onClick={() => void esegui(() => db.restituisciCaparra(c.id), 'Caparra restituita')}>Restituita</Pulsante>
              </li>
            ))}
          </ul>
        )}
      </section>
      {altre.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
          {altre.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-text-muted">
              <span className="flex-1">{c.nome} · {giorno(c.createdAt)}</span><span>{c.stato === 'usata' ? 'usata nel conto' : 'restituita'}</span><span className="tabular-nums">{euro(c.importoCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <Foglio aperto={nuova} onChiudi={() => setNuova(false)} titolo="Nuova caparra">
        <div className="flex flex-col gap-4">
          <Testo etichetta="Per chi" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Gruppo Esposito, sabato 20:30" autoFocus />
          <CampoEuro etichetta="Importo" valore={importo} onCambia={(c) => setImporto(c ?? 0)} />
          <Segmenti etichetta="Come l’ha pagata" valore={metodo} onCambia={setMetodo}
            opzioni={[{ valore: 'carta', testo: 'Carta' }, { valore: 'bonifico', testo: 'Bonifico' }, { valore: 'contanti', testo: 'Contanti' }, { valore: 'prepagata', testo: 'Link / prepagata' }]} />
          <Testo etichetta="Nota (facoltativa)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <Pulsante variante="primario" taglia="lg" caricamento={inCorso} onClick={() => void esegui(async () => {
            if (!nome.trim()) throw new Error('Scrivi per chi è la caparra');
            if (importo <= 0) throw new Error('Scrivi l’importo');
            await db.salvaCaparra({ nome: nome.trim(), clienteId: null, importoCents: importo, metodo, nota: nota.trim() || undefined }, operatore ?? undefined);
            setNuova(false);
          }, 'Caparra registrata')}>Registra</Pulsante>
        </div>
      </Foglio>
    </div>
  );
}
