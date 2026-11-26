// Cassa e statistiche: incasso, coperti, chi vende cosa, scontrini del giorno, annullo e chiusura fiscale.
// Solo per i responsabili.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowCounterClockwise, Receipt, Vault } from '@phosphor-icons/react';
import { euro, riepilogo, totaliChiusura, type DatiPeriodo, type Documento, type TipoPagamento } from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Pulsante, Spinner } from '../ui/primitivi';
import { Segmenti } from '../ui/campi';
import { puoGestire } from './gestione/Layout';

const PAGAMENTI: Record<TipoPagamento, string> = {
  contanti: 'Contanti', carta: 'Carta', buono_pasto: 'Buoni pasto', prepagata: 'Prepagata', sospeso: 'Sospeso', camera: 'Addebito camera',
};
const PERIODI = [{ valore: '1', testo: 'Oggi' }, { valore: '7', testo: '7 giorni' }, { valore: '30', testo: '30 giorni' }];
/** Asse fisso delle ore di servizio (11 → 2 di notte), più eventuali ore fuori orario con incassi. */
const oreServizio = (perOra: { ora: number; incassoCents: number }[]) => {
  const ore = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2];
  for (const x of perOra) if (!ore.includes(x.ora) && x.incassoCents) ore.push(x.ora);
  return ore.map((o) => ({ ora: o, incassoCents: perOra.find((x) => x.ora === o)?.incassoCents ?? 0 }));
};
const ora = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function Cassa() {
  const { db, operatore } = useApp();
  const setup = useDati((d) => d.setup());
  const [versione, setVersione] = useState(0);
  useEffect(() => {
    // Ricarica a ogni cambiamento (scontrino emesso, annullo confermato dalla cassa…), al massimo ogni mezzo secondo.
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = db.subscribe(() => { clearTimeout(t); t = setTimeout(() => setVersione((v) => v + 1), 500); });
    return () => { clearTimeout(t); off(); };
  }, [db]);
  const [giorni, setGiorni] = useState(1);
  const [dati, setDati] = useState<DatiPeriodo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [annulla, setAnnulla] = useState<Documento | null>(null);
  const [chiusura, setChiusura] = useState(false);

  const carica = useCallback(async () => {
    try { setErrore(null); setDati(await db.datiPeriodo(giorni)); }
    catch (e) { setErrore((e as Error).message); }
  }, [db, giorni]);
  useEffect(() => { void carica(); }, [carica, versione]);

  const r = useMemo(() => (dati ? riepilogo(dati, setup) : null), [dati, setup]);

  if (!puoGestire(operatore?.ruolo)) {
    return (
      <main className="grid h-full place-items-center bg-bg p-6 text-text">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-bold">Solo per i responsabili</h1>
          <p className="mb-6 text-text-muted">Incassi, annulli e chiusura di cassa sono riservati a chi ha il ruolo di responsabile.</p>
          <Link to="/sala" className="premibile inline-flex h-touch items-center rounded-md bg-surface-2 px-5 font-semibold">Torna alla sala</Link>
        </div>
      </main>
    );
  }

  const scontrini = (dati?.documenti ?? [])
    .filter((d) => d.tipo === 'documento_commerciale' && (d.stato === 'emesso' || d.stato === 'annullato'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nomeTavolo = (comandaId: string) => {
    const c = dati?.comande.find((x) => x.id === comandaId);
    const t = setup.tavoli.find((x) => x.id === c?.tavoloId); return t ? `Tavolo ${t.numero}` : 'Banco';
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata titolo="Cassa e statistiche" sotto={giorni === 1 ? 'Giornata di servizio in corso' : `Ultimi ${giorni} giorni`} indietro="/sala" />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full max-w-sm"><Segmenti etichetta="Periodo" valore={String(giorni)} onCambia={(v) => setGiorni(Number(v))} opzioni={PERIODI} /></div>
            <span className="flex-1" />
            {giorni === 1 && (
              <Pulsante variante="primario" taglia="md" icona={<Vault size={18} weight="bold" aria-hidden="true" />} onClick={() => setChiusura(true)} disabled={!r}>
                Chiusura fiscale
              </Pulsante>
            )}
          </div>

          {errore && <p role="alert" className="rounded-lg border border-danger px-4 py-3">{errore} <button type="button" className="ml-2 underline" onClick={() => void carica()}>Riprova</button></p>}
          {!r ? <div className="grid h-40 place-items-center"><Spinner /></div> : (<>
            <section aria-label="Numeri principali" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
              <Kpi etichetta="Incasso" valore={euro(r.incassoCents)} grande />
              <Kpi etichetta="Coperti" valore={String(r.coperti)} nota={r.coperti ? `${euro(r.aCopertoCents)} a coperto` : undefined} />
              <Kpi etichetta="Conti chiusi" valore={String(r.conti)} nota={r.conti ? `${euro(r.contoMedioCents)} di media` : undefined} />
              <Kpi etichetta="Ancora aperti" valore={euro(r.aperti.valoreCents)} nota={`${r.aperti.tavoli} tavoli · ${r.aperti.coperti} coperti`} />
            </section>

            <div className="grid gap-6 lg:grid-cols-3">
              <Pannello titolo="Pagamenti">
                {Object.keys(r.perPagamento).length === 0 ? <Niente /> : (
                  <Barre righe={Object.entries(r.perPagamento).map(([k, v]) => ({ nome: PAGAMENTI[k as TipoPagamento] ?? k, valore: v ?? 0 }))} />
                )}
                <dl className="mt-4 grid grid-cols-2 gap-y-1 border-t border-border pt-3 text-sm">
                  <dt className="text-text-muted">Sconti fatti</dt><dd className="text-right tabular-nums">{euro(r.scontiCents)}</dd>
                  <dt className="text-text-muted">Scontrini annullati</dt><dd className="text-right tabular-nums">{r.annullati} · {euro(r.annullatiCents)}</dd>
                  <dt className="text-text-muted">Piatti stornati</dt><dd className="text-right tabular-nums">{r.storni.quantita} · {euro(r.storni.importoCents)}</dd>
                </dl>
              </Pannello>
              <Pannello titolo="Per sala">
                {r.perSala.length === 0 ? <Niente /> : <Barre righe={r.perSala.map((s) => ({ nome: s.nome, valore: s.incassoCents, nota: `${s.coperti} cop.` }))} />}
              </Pannello>
              <Pannello titolo="Per cameriere">
                {r.perOperatore.length === 0 ? <Niente /> : <Barre righe={r.perOperatore.map((s) => ({ nome: s.nome, valore: s.incassoCents, nota: `${s.conti} ${s.conti === 1 ? 'conto' : 'conti'}` }))} />}
              </Pannello>
            </div>

            <Pannello titolo={giorni === 1 ? 'Incasso per ora' : 'Incasso per giorno'}>
              <Colonne punti={giorni === 1
                ? oreServizio(r.perOra).map((x) => ({ etichetta: `${x.ora}`, valore: x.incassoCents }))
                : r.perGiorno.map((x) => ({ etichetta: x.giorno.slice(8) + '/' + x.giorno.slice(5, 7), valore: x.incassoCents }))} />
            </Pannello>

            <div className="grid gap-6 lg:grid-cols-2">
              <Pannello titolo="Piatti più venduti">
                {r.piatti.length === 0 ? <Niente /> : (
                  <ol className="divide-y divide-border text-sm">
                    {r.piatti.slice(0, 12).map((p, i) => (
                      <li key={p.articoloId} className="flex items-center gap-3 py-2">
                        <span className="w-5 text-right font-mono text-text-muted">{i + 1}</span>
                        <span className="flex-1 truncate"><span className="font-semibold">{p.descrizione}</span> <span className="text-text-muted">· {p.categoria}</span></span>
                        <span className="tabular-nums text-text-muted">×{p.quantita}</span>
                        <span className="w-20 text-right font-semibold tabular-nums">{euro(p.importoCents)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Pannello>
              <Pannello titolo="Per categoria">
                {r.perCategoria.length === 0 ? <Niente /> : <Barre righe={r.perCategoria.map((c) => ({ nome: c.nome, valore: c.importoCents, colore: c.colore, nota: `×${c.quantita}` }))} />}
              </Pannello>
            </div>

            <Pannello titolo={`Scontrini${giorni === 1 ? ' di oggi' : ''}`}>
              {scontrini.length === 0 ? <Niente testo="Nessuno scontrino emesso." /> : (
                <ul className="divide-y divide-border">
                  {scontrini.slice(0, 200).map((d) => (
                    <li key={d.id} className={`flex items-center gap-3 py-2.5 ${d.stato === 'annullato' ? 'opacity-50' : ''}`}>
                      <Receipt size={20} weight="duotone" aria-hidden="true" className="flex-none text-text-muted" />
                      <span className="flex-1">
                        <span className="block font-semibold">
                          {d.rtDocNumero ? `N. ${d.rtZNumero ?? '–'}-${String(d.rtDocNumero).padStart(4, '0')}` : 'Scontrino'} · {nomeTavolo(d.comandaId)}
                        </span>
                        <span className="block text-sm text-text-muted">
                          {giorni === 1 ? ora(d.createdAt) : new Date(d.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{d.pagamenti.map((p) => PAGAMENTI[p.tipo]).join(' + ')}
                          {d.scontoCents ? ` · sconto ${euro(d.scontoCents)}` : ''}
                          {d.stato === 'annullato' ? ' · annullato' : ''}
                        </span>
                      </span>
                      <span className={`font-semibold tabular-nums ${d.stato === 'annullato' ? 'line-through' : ''}`}>{euro(d.totaleCents)}</span>
                      {d.stato === 'emesso' && giorni === 1 && (
                        <Pulsante taglia="md" icona={<ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />} onClick={() => setAnnulla(d)}>Annulla</Pulsante>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Pannello>
          </>)}
        </div>
      </main>
      {annulla && <FoglioAnnullo documento={annulla} tavolo={nomeTavolo(annulla.comandaId)} onChiudi={() => { setAnnulla(null); void carica(); }} />}
      {chiusura && r && <FoglioChiusura totali={totaliChiusura(r)} incasso={r.incassoCents} aperti={r.aperti.tavoli} onChiudi={() => { setChiusura(false); void carica(); }} />}
    </div>
  );
}

function FoglioAnnullo({ documento, tavolo, onChiudi }: { documento: Documento; tavolo: string; onChiudi: () => void }) {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const [chiave] = useState(nuovaChiave);
  const vai = async () => {
    const ok = await esegui(() => db.annullaDocumento(documento.id, chiave, operatore ?? undefined), 'Annullo inviato alla cassa');
    if (ok) onChiudi();
  };
  return (
    <Foglio aperto onChiudi={onChiudi} titolo="Annullare lo scontrino?" piede={<>
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>No</Pulsante>
      <Pulsante variante="pericolo" taglia="md" caricamento={inCorso} onClick={() => void vai()}>Sì, annulla {euro(documento.totaleCents)}</Pulsante>
    </>}>
      <p className="text-base">Scontrino del <strong>{tavolo}</strong> delle {ora(documento.createdAt)}, {euro(documento.totaleCents)}.</p>
      <p className="mt-3 text-sm text-text-muted">
        La cassa fiscale stampa un documento di annullo collegato allo scontrino. Si fa solo nella stessa giornata, prima della chiusura.
        Se il cliente deve pagare di nuovo, riapri il conto dalla sala.
      </p>
    </Foglio>
  );
}

function FoglioChiusura({ totali, incasso, aperti, onChiudi }: { totali: object; incasso: number; aperti: number; onChiudi: () => void }) {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const [chiave] = useState(nuovaChiave);
  const vai = async () => {
    const ok = await esegui(() => db.chiusuraFiscale(totali, chiave, operatore ?? undefined), 'Chiusura inviata alla cassa');
    if (ok) onChiudi();
  };
  return (
    <Foglio aperto onChiudi={onChiudi} titolo="Chiusura fiscale (Z)" piede={<>
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Non ora</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void vai()}>Chiudi la giornata</Pulsante>
    </>}>
      <p className="text-base">Incasso della giornata: <strong className="tabular-nums">{euro(incasso)}</strong>.</p>
      {aperti > 0 && (
        <p role="alert" className="mt-3 rounded-md border border-warning px-3 py-2 text-sm">
          Ci sono ancora <strong>{aperti} tavoli aperti</strong>. Dopo la chiusura i loro scontrini finiranno nella giornata di domani.
        </p>
      )}
      <p className="mt-3 text-sm text-text-muted">
        La cassa fiscale stampa lo Z e invia i corrispettivi all'Agenzia delle Entrate. Si fa una volta al giorno, a fine servizio. Non si può annullare.
      </p>
    </Foglio>
  );
}

function Kpi({ etichetta, valore, nota, grande }: { etichetta: string; valore: string; nota?: string; grande?: boolean }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-sm font-semibold text-text-muted">{etichetta}</p>
      <p className={`mt-1 font-bold tabular-nums tracking-tight ${grande ? 'text-3xl text-accent' : 'text-2xl'}`}>{valore}</p>
      {nota && <p className="mt-0.5 text-sm text-text-muted">{nota}</p>}
    </div>
  );
}

function Pannello({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-base font-bold">{titolo}</h2>
      {children}
    </section>
  );
}

const Niente = ({ testo = 'Ancora niente in questo periodo.' }: { testo?: string }) => <p className="py-4 text-sm text-text-muted">{testo}</p>;

function Barre({ righe }: { righe: { nome: string; valore: number; nota?: string; colore?: string }[] }) {
  const max = Math.max(1, ...righe.map((x) => x.valore));
  const ordinate = [...righe].sort((a, b) => b.valore - a.valore);
  return (
    <ul className="flex flex-col gap-2.5">
      {ordinate.map((x) => (
        <li key={x.nome}>
          <div className="mb-1 flex items-baseline gap-2 text-sm">
            <span className="flex-1 truncate font-semibold">{x.nome}</span>
            {x.nota && <span className="text-text-muted">{x.nota}</span>}
            <span className="tabular-nums">{euro(x.valore)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(x.valore / max) * 100}%`, ...(x.colore ? { backgroundColor: x.colore } : {}) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Colonne({ punti }: { punti: { etichetta: string; valore: number }[] }) {
  if (!punti.some((p) => p.valore > 0)) return <Niente />;
  const max = Math.max(1, ...punti.map((p) => p.valore));
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Grafico degli incassi">
      {punti.map((p) => (
        <div key={p.etichetta} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${p.etichetta}: ${euro(p.valore)}`}>
          <div className="w-full rounded-t-sm bg-accent" style={{ height: `${Math.max(p.valore ? 2 : 0, (p.valore / max) * 100)}%` }} />
          <span className="text-[11px] tabular-nums text-text-muted">{p.etichetta}</span>
        </div>
      ))}
    </div>
  );
}
