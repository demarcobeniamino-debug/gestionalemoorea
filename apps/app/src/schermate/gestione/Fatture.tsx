// Gestione → Fatture: elenco con stato verso lo SDI, download XML, e dati fiscali del locale.
import { useCallback, useEffect, useState } from 'react';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { controllaCedente, euro, type DatiFiscali, type Fattura, type StatoFattura } from '@gr/core';
import { useApp, useAzione, useDati } from '../../dati/contesto';
import { Pulsante, Spinner } from '../../ui/primitivi';
import { Segmenti, Seleziona, Testo } from '../../ui/campi';
import { Sezione, Vuoto } from './Layout';
import { nomeFile, scaricaFile } from '../Fattura';

const STATI: Record<StatoFattura, { testo: string; classe: string }> = {
  da_inviare: { testo: 'Da inviare', classe: 'border border-warning text-warning' },
  inviata: { testo: 'Inviata', classe: 'bg-success text-on-success' },
  scartata: { testo: 'Scartata', classe: 'bg-danger text-on-danger' },
  annullata: { testo: 'Annullata', classe: 'bg-surface-2 text-text-muted' },
};

const REGIMI = [
  { valore: 'RF01', testo: 'RF01 · Ordinario' },
  { valore: 'RF19', testo: 'RF19 · Forfettario' },
  { valore: 'RF02', testo: 'RF02 · Contribuenti minimi' },
];

export function FattureGestione() {
  const { db } = useApp();
  const { esegui } = useAzione();
  const setup = useDati((d) => d.setup());
  const [giorni, setGiorni] = useState('90');
  const [lista, setLista] = useState<Fattura[] | null>(null);
  const carica = useCallback(() => db.fatture(Number(giorni)).then(setLista).catch(() => setLista([])), [db, giorni]);
  useEffect(() => { void carica(); }, [carica]);
  const daInviare = (lista ?? []).filter((f) => f.stato === 'da_inviare');
  const ced = setup.locale.fiscali;

  return (
    <Sezione titolo="Fatture" sotto="Fatture elettroniche emesse dalla cassa e dati fiscali del locale">
      <DatiFiscaliLocale />
      <div className="mt-8 mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold">Emesse</h3>
        {daInviare.length > 0 && <span className="rounded-pill border border-warning px-3 py-0.5 text-sm font-bold text-warning">{daInviare.length} da inviare allo SDI</span>}
        <span className="flex-1" />
        <div className="w-full max-w-xs"><Segmenti etichetta="Periodo" valore={giorni} onCambia={setGiorni} opzioni={[{ valore: '30', testo: '30 giorni' }, { valore: '90', testo: '90 giorni' }, { valore: '366', testo: 'Un anno' }]} /></div>
      </div>
      {lista === null ? <div className="grid h-32 place-items-center"><Spinner /></div>
        : lista.length === 0 ? <Vuoto titolo="Nessuna fattura" testo="Si creano dalla Cassa: “Fattura” accanto allo scontrino." />
        : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {lista.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText size={24} weight="duotone" aria-hidden className="flex-none text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">N. {f.numero}/{f.anno} · {f.intestatario || 'Cliente'}</span>
                  <span className="block text-sm text-text-muted">{new Date(f.data).toLocaleDateString('it-IT')} · imponibile {euro(f.imponibileCents)} + IVA {euro(f.ivaCents)}</span>
                </span>
                <span className="font-semibold tabular-nums">{euro(f.totaleCents)}</span>
                <span className={`rounded-pill px-2.5 py-0.5 text-xs font-bold ${STATI[f.stato].classe}`}>{STATI[f.stato].testo}</span>
                <Pulsante taglia="md" icona={<DownloadSimple size={16} weight="bold" aria-hidden />} onClick={() => scaricaFile(nomeFile(f, ced), f.xml)}>XML</Pulsante>
                <select aria-label={`Stato della fattura ${f.numero}`} value={f.stato}
                  onChange={(e) => void esegui(async () => { await db.impostaStatoFattura(f.id, e.target.value as StatoFattura); await carica(); }, 'Stato aggiornato')}
                  className="h-touch rounded-md border border-border-input bg-bg px-2 text-sm text-text">
                  {Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v.testo}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      <p className="mt-3 text-sm text-text-muted">L'invio allo SDI si fa caricando l'XML su “Fatture e Corrispettivi” dell'Agenzia delle Entrate, o tramite il commercialista. L'invio automatico richiede un intermediario accreditato: si può aggiungere più avanti.</p>
    </Sezione>
  );
}

function DatiFiscaliLocale() {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const f = useDati((d) => d.setup().locale.fiscali) ?? {};
  const [v, setV] = useState<Partial<DatiFiscali>>({});
  useEffect(() => { setV({ regime: 'RF01', ...f, ragioneSociale: /da completare/i.test(f.ragioneSociale ?? '') ? '' : f.ragioneSociale, piva: /\d{11}/.test(f.piva ?? '') ? f.piva : '' }); }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof DatiFiscali, x: string) => setV((p) => ({ ...p, [k]: x }));
  const mancano = controllaCedente(v);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        <h3 className="text-lg font-bold">Dati fiscali del locale</h3>
        {mancano.length ? <span className="text-sm font-semibold text-warning">Da completare per fatturare</span> : <span className="text-sm font-semibold text-success">Completi</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Testo className="lg:col-span-2" etichetta="Ragione sociale" value={v.ragioneSociale ?? ''} onChange={(e) => set('ragioneSociale', e.target.value)} placeholder="es. Moorea S.r.l." />
        <Seleziona etichetta="Regime fiscale" value={v.regime ?? 'RF01'} onChange={(e) => set('regime', e.target.value)} opzioni={REGIMI} />
        <Testo etichetta="Partita IVA" inputMode="numeric" value={v.piva ?? ''} onChange={(e) => set('piva', e.target.value.replace(/\D/g, '').slice(0, 11))} />
        <Testo etichetta="Codice fiscale (se diverso)" value={v.codiceFiscale ?? ''} onChange={(e) => set('codiceFiscale', e.target.value.toUpperCase().slice(0, 16))} />
        <Testo etichetta="Telefono" value={v.telefono ?? ''} onChange={(e) => set('telefono', e.target.value)} />
        <Testo className="lg:col-span-2" etichetta="Via" value={v.via ?? ''} onChange={(e) => set('via', e.target.value)} placeholder="es. Lungomare Amendola" />
        <Testo etichetta="Civico" value={v.civico ?? ''} onChange={(e) => set('civico', e.target.value)} />
        <Testo etichetta="CAP" inputMode="numeric" value={v.cap ?? ''} onChange={(e) => set('cap', e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="84010" />
        <Testo etichetta="Comune" value={v.comune ?? ''} onChange={(e) => set('comune', e.target.value)} placeholder="Maiori" />
        <Testo etichetta="Provincia" value={v.provincia ?? ''} onChange={(e) => set('provincia', e.target.value.toUpperCase().slice(0, 2))} placeholder="SA" />
        <Testo etichetta="REA: ufficio" value={v.rea?.ufficio ?? ''} onChange={(e) => setV((p) => ({ ...p, rea: { ufficio: e.target.value.toUpperCase().slice(0, 2), numero: p.rea?.numero ?? '' } }))} placeholder="SA (facoltativo)" />
        <Testo etichetta="REA: numero" value={v.rea?.numero ?? ''} onChange={(e) => setV((p) => ({ ...p, rea: { ufficio: p.rea?.ufficio ?? '', numero: e.target.value } }))} />
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {mancano.length > 0 && <p className="mr-auto text-sm text-text-muted">Mancano: {mancano.join(', ')}</p>}
        <Pulsante variante="primario" taglia="md" caricamento={inCorso} disabled={mancano.length > 0}
          onClick={() => void esegui(() => db.salvaDatiFiscali({ regime: 'RF01', ...v } as DatiFiscali), 'Dati fiscali salvati')}>Salva dati fiscali</Pulsante>
      </div>
    </section>
  );
}
