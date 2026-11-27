// Registro di cassa: invio scontrini all'RT, situazione chiusure (Z), situazione fatture.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Clock, FileText, Printer, Receipt, Vault, Warning, XCircle } from '@phosphor-icons/react';
import { euro, type ChiusuraFiscale, type DatiPeriodo, type Documento, type Fattura, type PrintJob, type StatoLavoro } from '@gr/core';
import { useApp, useAzione, useDati } from '../dati/contesto';
import { Foglio, Pulsante, Spinner } from '../ui/primitivi';

const STATO: Record<StatoLavoro | 'sconosciuto', { testo: string; classe: string; icona: React.ReactNode }> = {
  in_coda: { testo: 'In coda', classe: 'border border-warning text-warning', icona: <Clock size={14} weight="bold" aria-hidden /> },
  preso: { testo: 'In stampa', classe: 'border border-accent text-accent', icona: <Printer size={14} weight="bold" aria-hidden /> },
  stampato: { testo: 'Stampato', classe: 'bg-success text-on-success', icona: <CheckCircle size={14} weight="fill" aria-hidden /> },
  errore: { testo: 'Errore', classe: 'bg-danger text-on-danger', icona: <XCircle size={14} weight="fill" aria-hidden /> },
  da_verificare: { testo: 'Da verificare', classe: 'bg-warning text-on-warning', icona: <Warning size={14} weight="fill" aria-hidden /> },
  sconosciuto: { testo: 'Registrata', classe: 'bg-surface-2 text-text-muted', icona: null },
};
const NOME_LAVORO: Partial<Record<PrintJob['tipo'], string>> = { documento_commerciale: 'Scontrino', annullo: 'Annullo', chiusura_fiscale: 'Chiusura Z' };
const FISCALI = new Set(['documento_commerciale', 'annullo', 'chiusura_fiscale']);
// Le date dei lavori in memoria hanno un contatore in coda per l'ordinamento: lo si toglie prima di leggerle.
const data = (iso: string) => new Date(iso.replace(/(Z)\d+$/, '$1'));
const ora = (iso: string) => data(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export const Badge = ({ stato }: { stato: StatoLavoro | 'sconosciuto' }) => (
  <span className={`inline-flex flex-none items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-bold ${STATO[stato].classe}`}>{STATO[stato].icona}{STATO[stato].testo}</span>
);

/** Quanti invii all'RT chiedono attenzione (per il pallino sulla scheda). */
export function useInviiDaGuardare() {
  return useDati((d) => d.lavori().filter((j) => FISCALI.has(j.tipo) && (j.stato === 'errore' || j.stato === 'da_verificare')).length);
}

export function InvioScontrini({ dati, nomeTavolo, responsabile }: { dati: DatiPeriodo | null; nomeTavolo: (comandaId: string) => string; responsabile: boolean }) {
  const { setup, lavori } = useDati((d) => ({ setup: d.setup(), lavori: d.lavori() }));
  const [verifica, setVerifica] = useState<PrintJob | null>(null);
  const rt = setup.stampanti.find((s) => s.tipo === 'rt_epson_xml');
  const fiscali = lavori.filter((j) => FISCALI.has(j.tipo)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const conta = (s: StatoLavoro) => fiscali.filter((j) => j.stato === s).length;
  const doc = (j: PrintJob): Documento | undefined => (j.documentoId ? dati?.documenti.find((d) => d.id === j.documentoId) : undefined);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <Receipt size={32} weight="duotone" aria-hidden className="text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{rt ? `${rt.nome} · ${rt.modello ?? 'Epson RT'}` : 'Nessun registratore telematico configurato'}</p>
          <p className="text-sm text-text-muted">{rt ? `${rt.host}${rt.matricolaRt ? ` · matricola ${rt.matricolaRt}` : ''} · protocollo Epson FPMate (XML su HTTP)` : <Link to="/gestione/stampanti" className="underline">Configuralo in Gestione → Stampanti</Link>}</p>
        </div>
        <dl className="flex gap-5 text-center">
          {(['in_coda', 'preso', 'da_verificare', 'errore', 'stampato'] as StatoLavoro[]).map((s) => (
            <div key={s}><dt className="text-xs text-text-muted">{STATO[s].testo}</dt><dd className={`text-xl font-bold tabular-nums ${conta(s) && (s === 'errore' || s === 'da_verificare') ? 'text-danger' : ''}`}>{conta(s)}</dd></div>
          ))}
        </dl>
      </section>

      {fiscali.some((j) => j.stato === 'da_verificare') && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-warning px-4 py-3 text-sm">
          <Warning size={18} weight="fill" aria-hidden className="mt-px flex-none text-warning" />
          <span><strong>Da verificare</strong> vuol dire che l’Epson non ha risposto in tempo: lo scontrino potrebbe essere uscito. Guarda la carta (o il giornale elettronico) e dì alla cassa com’è andata. Finché non lo fai, quel conto resta bloccato per non stampare due volte.</span>
        </p>
      )}

      {fiscali.length === 0 ? <p className="py-8 text-center text-text-muted">Nessun invio all’RT nelle ultime ore.</p> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {fiscali.map((j) => {
            const d = doc(j);
            return (
              <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-12 flex-none font-mono text-sm tabular-nums text-text-muted">{ora(j.createdAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{NOME_LAVORO[j.tipo] ?? j.tipo}{d ? ` · ${nomeTavolo(d.comandaId)}` : ''}{d?.quota ? ` · quota ${d.quota.indice}/${d.quota.di}` : ''}</span>
                  <span className="block text-sm text-text-muted">
                    {d?.rtDocNumero ? `N. ${d.rtZNumero ?? '–'}-${String(d.rtDocNumero).padStart(4, '0')} · ` : ''}
                    {j.tentativi > 1 ? `${j.tentativi} tentativi · ` : ''}{j.errore ?? (j.stato === 'stampato' ? 'confermato dall’RT' : '')}
                  </span>
                </span>
                {d && <span className="font-semibold tabular-nums">{euro(d.totaleCents)}</span>}
                <Badge stato={j.stato} />
                {j.stato === 'da_verificare' && responsabile && <Pulsante taglia="md" variante="primario" onClick={() => setVerifica(j)}>Verifica</Pulsante>}
                {j.stato === 'errore' && d?.comandaId && j.tipo === 'documento_commerciale' && (
                  <Link to={`/conto/${d.comandaId}`} className="premibile inline-flex h-touch items-center rounded-md bg-surface-2 px-4 text-sm font-semibold">Rifai dal conto</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-text-muted">I corrispettivi li trasmette l’RT da solo all’Agenzia delle Entrate dopo ogni chiusura Z: la cassa non deve inviare niente a parte.</p>
      {verifica && <FoglioVerifica job={verifica} documento={doc(verifica)} onChiudi={() => setVerifica(null)} />}
    </div>
  );
}

function FoglioVerifica({ job, documento, onChiudi }: { job: PrintJob; documento?: Documento; onChiudi: () => void }) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const [z, setZ] = useState('');
  const [n, setN] = useState('');
  const uscito = () => void esegui(async () => {
    await db.esitoLavoro(job.id, { ok: true, zNumero: z ? Number(z) : undefined, docNumero: n ? Number(n) : undefined, errore: 'Verificato a mano: uscito' });
    onChiudi();
  }, 'Segnato come uscito');
  const nonUscito = () => void esegui(async () => {
    await db.esitoLavoro(job.id, { ok: false, errore: 'Verificato a mano: non uscito' });
    onChiudi();
  }, 'Segnato come non uscito: si può rifare dal conto');
  return (
    <Foglio aperto onChiudi={onChiudi} titolo={`${NOME_LAVORO[job.tipo] ?? 'Lavoro'} da verificare`}>
      <p className="mb-4 text-[15px]">{documento ? <>Importo <strong className="tabular-nums">{euro(documento.totaleCents)}</strong>, inviato alle {ora(job.createdAt)}. </> : null}Guarda l’ultimo scontrino sulla carta dell’Epson.</p>
      {job.tipo !== 'chiusura_fiscale' && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Numero Z (facoltativo)
            <input inputMode="numeric" value={z} onChange={(e) => setZ(e.target.value.replace(/\D/g, ''))} className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none focus:border-focus" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Numero documento
            <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none focus:border-focus" />
          </label>
          <p className="col-span-2 text-xs text-text-muted">Sono stampati in fondo allo scontrino (es. “DOC. N. 0041-0007”): servono per poterlo annullare in seguito.</p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Pulsante variante="conferma" taglia="lg" caricamento={inCorso} onClick={uscito}>Sì, è uscito</Pulsante>
        <Pulsante variante="pericolo" taglia="lg" caricamento={inCorso} onClick={nonUscito}>No, non è uscito</Pulsante>
      </div>
    </Foglio>
  );
}

export function SituazioneChiusure() {
  const { db } = useApp();
  const [lista, setLista] = useState<ChiusuraFiscale[] | null>(null);
  const versione = useDati((d) => d.lavori().filter((j) => j.tipo === 'chiusura_fiscale').map((j) => j.stato).join());
  useEffect(() => { db.chiusure(60).then(setLista).catch(() => setLista([])); }, [db, versione]);
  if (!lista) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  if (!lista.length) return <p className="py-10 text-center text-text-muted">Nessuna chiusura negli ultimi 60 giorni. Si fa dalla scheda Riepilogo, a fine servizio.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {lista.map((c) => {
          const t = c.totali as { incasso_cents?: number; scontrini?: number; annullati?: number; coperti?: number };
          return (
            <li key={c.createdAt} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Vault size={24} weight="duotone" aria-hidden className="flex-none text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{new Date(c.giorno).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}{c.zNumero ? ` · Z n. ${c.zNumero}` : ''}</span>
                <span className="block text-sm text-text-muted">
                  {[t.scontrini != null && `${t.scontrini} ${t.scontrini === 1 ? 'scontrino' : 'scontrini'}`, t.annullati ? `${t.annullati} annullati` : null, t.coperti != null && `${t.coperti} coperti`, `fatta alle ${ora(c.createdAt)}`].filter(Boolean).join(' · ')}
                  {c.errore ? ` · ${c.errore}` : ''}
                </span>
              </span>
              {t.incasso_cents != null && <span className="font-semibold tabular-nums">{euro(t.incasso_cents)}</span>}
              <Badge stato={c.stato} />
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-text-muted">Lo Z “Stampato” vuol dire che l’Epson ha chiuso la giornata: da lì è lei a inviare i corrispettivi all’Agenzia delle Entrate. Se resta “Errore” o “Da verificare”, rifai la chiusura dal Riepilogo dopo aver controllato la carta.</p>
    </div>
  );
}

export function SituazioneFatture() {
  const { db } = useApp();
  const [lista, setLista] = useState<Fattura[] | null>(null);
  const carica = useCallback(() => db.fatture(366).then(setLista).catch(() => setLista([])), [db]);
  useEffect(() => { void carica(); }, [carica]);
  if (!lista) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  const somma = (f: Fattura[]) => f.reduce((t, x) => t + x.totaleCents, 0);
  const gruppi = [
    { titolo: 'Da inviare allo SDI', l: lista.filter((f) => f.stato === 'da_inviare'), tono: 'text-warning' },
    { titolo: 'Inviate', l: lista.filter((f) => f.stato === 'inviata'), tono: 'text-success' },
    { titolo: 'Scartate', l: lista.filter((f) => f.stato === 'scartata'), tono: 'text-danger' },
  ];
  const mese = new Date().toISOString().slice(0, 7);
  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        {gruppi.map((g) => (
          <div key={g.titolo} className="bg-surface px-4 py-4">
            <p className="text-sm font-semibold text-text-muted">{g.titolo}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${g.l.length ? g.tono : ''}`}>{g.l.length}</p>
            <p className="text-sm text-text-muted tabular-nums">{euro(somma(g.l))}</p>
          </div>
        ))}
        <div className="bg-surface px-4 py-4">
          <p className="text-sm font-semibold text-text-muted">Questo mese</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{lista.filter((f) => f.data.startsWith(mese) && f.stato !== 'annullata').length}</p>
          <p className="text-sm text-text-muted tabular-nums">{euro(somma(lista.filter((f) => f.data.startsWith(mese) && f.stato !== 'annullata')))}</p>
        </div>
      </section>
      {gruppi[0].l.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {gruppi[0].l.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <FileText size={22} weight="duotone" aria-hidden className="text-text-muted" />
              <span className="flex-1"><span className="block font-semibold">N. {f.numero}/{f.anno} · {f.intestatario}</span>
                <span className="block text-sm text-text-muted">{new Date(f.data).toLocaleDateString('it-IT')} · da inviare entro il {new Date(new Date(f.data).getTime() + 12 * 864e5).toLocaleDateString('it-IT')}</span></span>
              <span className="font-semibold tabular-nums">{euro(f.totaleCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/gestione/fatture" className="premibile self-start rounded-md bg-surface-2 px-4 py-3 text-sm font-semibold">Tutte le fatture, XML e dati fiscali →</Link>
    </div>
  );
}
