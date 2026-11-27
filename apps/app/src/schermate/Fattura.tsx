// Fattura elettronica da uno scontrino: scelta del cliente, controlli, numero dal server, XML da inviare allo SDI.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, DownloadSimple, Plus, Printer, Warning } from '@phosphor-icons/react';
import {
  calcolaFattura, controllaCedente, controllaIntestatario, euro, nomeCliente, nomeFileFattura, progressivoInvio, xmlFattura,
  type Cliente, type DatiFiscali, type Documento, type Fattura, type RigaTicket, type Ticket,
} from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Foglio, Pulsante, Spinner } from '../ui/primitivi';
import { EditorCliente, RigaCliente, useCercaClienti } from './Clienti';

export function scaricaFile(nome: string, contenuto: string, tipo = 'application/xml') {
  const url = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nome del file come lo vuole lo SDI: IT + codice del trasmittente + progressivo d'invio scritto nell'XML. */
export const nomeFile = (f: Fattura, ced?: Partial<DatiFiscali>) => {
  const prog = /<ProgressivoInvio>([^<]+)</.exec(f.xml)?.[1];
  return ced?.piva && prog ? nomeFileFattura(ced as DatiFiscali, prog) : `fattura-${f.anno}-${f.numero}.xml`;
};

function ticketCortesia(f: Fattura, ced: Partial<DatiFiscali>, cliente: Cliente): Ticket {
  const r: RigaTicket[] = [
    { k: 'testo', testo: ced.ragioneSociale ?? '', allinea: 'centro', grassetto: true },
    { k: 'testo', testo: `P.IVA ${ced.piva ?? ''}`, allinea: 'centro' },
    { k: 'separatore' },
    { k: 'testo', testo: `FATTURA N. ${f.numero}/${f.anno}`, grassetto: true, doppiaAltezza: true },
    { k: 'testo', testo: `del ${new Date(f.data).toLocaleDateString('it-IT')}` },
    { k: 'separatore' },
    { k: 'testo', testo: nomeCliente(cliente), grassetto: true },
    ...(cliente.piva ? [{ k: 'testo' as const, testo: `P.IVA ${cliente.piva}` }] : []),
    ...(cliente.codiceFiscale ? [{ k: 'testo' as const, testo: `C.F. ${cliente.codiceFiscale}` }] : []),
    { k: 'separatore' },
    { k: 'coppia', sx: 'Imponibile', dx: euro(f.imponibileCents, false) },
    { k: 'coppia', sx: 'IVA', dx: euro(f.ivaCents, false) },
    { k: 'coppia', sx: 'TOTALE EUR', dx: euro(f.totaleCents, false), grassetto: true, doppiaAltezza: true },
    { k: 'separatore' },
    { k: 'testo', testo: 'COPIA DI CORTESIA', allinea: 'centro', grassetto: true },
    { k: 'testo', testo: "L'originale è la fattura elettronica trasmessa allo SDI e disponibile nella sua area riservata dell'Agenzia delle Entrate.", allinea: 'centro' },
  ];
  return { titolo: `Fattura ${f.numero}/${f.anno}`, righe: r, taglio: true };
}

/** Fattura su uno scontrino, o riepilogativa su più scontrini dello stesso cliente (es. fine mese). */
export function FoglioFattura({ documento, clienteIdIniziale, tavolo, onChiudi }: {
  documento: Documento | Documento[]; clienteIdIniziale?: string; tavolo?: string; onChiudi: () => void;
}) {
  const docs = Array.isArray(documento) ? documento : [documento];
  const righeDocs = useMemo(() => docs.flatMap((d) => d.righe), [documento]); // eslint-disable-line react-hooks/exhaustive-deps
  const scontoDocs = docs.reduce((s, d) => s + d.scontoCents, 0);
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const setup = useDati((d) => d.setup());
  const ced = setup.locale.fiscali ?? {};
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cerca, setCerca] = useState('');
  const [editor, setEditor] = useState<{ c: Cliente | null } | null>(null);
  const [fattura, setFattura] = useState<Fattura | null>(null);
  const { lista } = useCercaClienti(cerca, !cliente);
  useEffect(() => { if (clienteIdIniziale) db.cliente(clienteIdIniziale).then((c) => c && setCliente(c)).catch(() => undefined); }, [clienteIdIniziale, db]);

  const calcolo = useMemo(() => calcolaFattura(righeDocs, scontoDocs, setup.aliquote), [righeDocs, scontoDocs, setup.aliquote]);
  const mancaCedente = controllaCedente(ced);
  const mancaCliente = cliente ? controllaIntestatario(cliente) : [];
  const numeri = docs.filter((d) => d.rtDocNumero).map((d) => `n. ${d.rtZNumero}-${String(d.rtDocNumero).padStart(4, '0')} del ${new Date(d.createdAt).toLocaleDateString('it-IT')}`);
  const riferimento = numeri.length ? `${numeri.length > 1 ? 'documenti commerciali' : 'documento commerciale'} ${numeri.join(', ')}`.slice(0, 1000) : undefined;
  const pagamento = docs.every((d) => d.pagamenti.every((p) => p.tipo === 'contanti')) ? 'MP01' : 'MP08';

  const emetti = () => void esegui(async () => {
    if (!cliente) throw new Error('Scegli il cliente');
    const oggi = new Date();
    const dataIso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
    const progressivo = progressivoInvio();
    const xml = xmlFattura({ cedente: ced as DatiFiscali, cliente, data: dataIso, calcolo, progressivo, riferimento, pagamento });
    const f = await db.emettiFattura({ clienteId: cliente.id, documentoId: docs.length === 1 ? docs[0].id : undefined, comandaId: docs.length === 1 ? docs[0].comandaId || undefined : undefined, data: dataIso, calcolo, xml, progressivo, intestatario: nomeCliente(cliente) }, nuovaChiave(), operatore ?? undefined);
    setFattura(f);
  }, 'Fattura creata');

  if (fattura && cliente) return (
    <Foglio aperto onChiudi={onChiudi} titolo={`Fattura n. ${fattura.numero}/${fattura.anno}`} piede={<>
      <span className="flex-1" /><Pulsante variante="primario" taglia="md" onClick={onChiudi}>Fatto</Pulsante>
    </>}>
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <CheckCircle size={48} weight="duotone" aria-hidden className="text-success" />
        <p className="text-lg font-bold">{nomeCliente(cliente)} · {euro(fattura.totaleCents)}</p>
        <p className="max-w-md text-sm text-text-muted">Il file XML va trasmesso allo SDI entro 12 giorni: caricalo su “Fatture e Corrispettivi” dell'Agenzia delle Entrate o giralo al commercialista. Poi segnala come inviata in Gestione → Fatture.</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Pulsante taglia="lg" icona={<DownloadSimple size={20} weight="bold" aria-hidden />} onClick={() => scaricaFile(nomeFile(fattura, ced), fattura.xml)}>Scarica XML</Pulsante>
        <Pulsante taglia="lg" icona={<Printer size={20} weight="bold" aria-hidden />}
          onClick={() => void esegui(() => db.stampaNonFiscale(ticketCortesia(fattura, ced, cliente), nuovaChiave()), 'Copia di cortesia in stampa')}>Copia di cortesia</Pulsante>
      </div>
    </Foglio>
  );

  return (<>
    <Foglio aperto={!editor} onChiudi={onChiudi} titolo={`Fattura${tavolo ? ` · ${tavolo}` : ''}`} piede={<>
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} disabled={!cliente || mancaCliente.length > 0 || mancaCedente.length > 0} onClick={emetti}>
        Crea fattura · {euro(calcolo.totaleCents)}
      </Pulsante>
    </>}>
      {mancaCedente.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-warning px-3 py-2.5 text-sm">
          <Warning size={18} weight="fill" aria-hidden className="mt-px flex-none text-warning" />
          <span>Prima completa i dati del locale: {mancaCedente.join(', ')}. <Link to="/gestione/fatture" className="font-semibold underline">Vai ai dati fiscali</Link></span>
        </div>
      )}
      <dl className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-md bg-border text-center">
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">Imponibile</dt><dd className="text-base font-bold tabular-nums">{euro(calcolo.imponibileCents)}</dd></div>
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">IVA</dt><dd className="text-base font-bold tabular-nums">{euro(calcolo.ivaCents)}</dd></div>
        <div className="bg-bg px-2 py-2.5"><dt className="text-xs text-text-muted">Totale</dt><dd className="text-base font-bold tabular-nums">{euro(calcolo.totaleCents)}</dd></div>
      </dl>
      {cliente ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-border">
            <RigaCliente c={cliente} onClick={() => setEditor({ c: cliente })} destra={<span className="text-sm font-semibold text-accent">Modifica</span>} />
          </div>
          {mancaCliente.length > 0
            ? <p role="alert" className="text-sm font-semibold text-warning">Mancano: {mancaCliente.join(', ')}. Tocca il cliente per completare.</p>
            : <p className="text-sm text-text-muted">Destinatario: {cliente.codiceSdi ? `codice ${cliente.codiceSdi}` : cliente.pec ? `PEC ${cliente.pec}` : 'cassetto fiscale (0000000)'}</p>}
          <button type="button" onClick={() => setCliente(null)} className="self-start text-sm font-semibold text-text-muted underline">Cambia cliente</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca per nome, P.IVA, codice fiscale" aria-label="Cerca cliente" autoFocus
              className="h-touch min-w-0 flex-1 rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none placeholder:text-text-muted focus:border-focus" />
            <Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditor({ c: null })}>Nuovo</Pulsante>
          </div>
          {lista === null ? <div className="grid h-20 place-items-center"><Spinner /></div>
            : lista.length === 0 ? <p className="py-4 text-center text-sm text-text-muted">{cerca ? 'Nessun cliente trovato: crealo con “Nuovo”.' : 'Nessun cliente in anagrafica.'}</p>
            : <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {lista.map((c) => <li key={c.id}><RigaCliente c={c} onClick={() => setCliente(c)} /></li>)}
              </ul>}
        </div>
      )}
    </Foglio>
    <EditorCliente aperto={!!editor} cliente={editor?.c ?? null} perFattura onChiudi={() => setEditor(null)} onSalvato={(c) => { setCliente(c); setEditor(null); }} />
  </>);
}
