import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import { ALLERGENI_ETICHETTA, nomePortata } from '@gr/core';
import { useApp, useAzione, useDati, useOra } from '../dati/contesto';
import { Icona, IconaCentro } from '../ui/primitivi';

const RITARDO_MIN = 20;

// S11: monitor di produzione (cucina o bar). Tocca una riga: pronta. Tocca la testata: tutto pronto.
export function Cucina() {
  const { db } = useApp();
  const { esegui } = useAzione();
  const ora = useOra(10000);
  const { centri, tavoli } = useDati((d) => ({ centri: d.setup().centri, tavoli: d.setup().tavoli }));
  const [centroId, setCentroId] = useState(centri[0]?.id);
  const lista = useDati((d) => d.righeDaPreparare(centroId));
  const minuti = (iso?: string) => (iso ? Math.max(0, Math.floor((ora.getTime() - new Date(iso).getTime()) / 60000)) : 0);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex h-16 flex-none items-center gap-4 border-b border-border bg-surface px-5">
        <Link to="/sala" aria-label="Torna alla sala" className="premibile grid h-10 w-10 place-items-center rounded-md bg-surface-2">{Icona.indietro}</Link>
        <div role="tablist" aria-label="Reparto" className="flex gap-1 rounded-pill bg-bg p-1">
          {centri.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === centroId} onClick={() => setCentroId(c.id)}
              className={`premibile flex h-10 items-center gap-2 rounded-pill px-4 text-[15px] font-bold ${c.id === centroId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>
              <IconaCentro nome={c.nome} />{c.nome}</button>
          ))}
        </div>
        <span className="text-base font-semibold text-text-muted">{lista.length === 1 ? '1 tavolo in attesa' : `${lista.length} tavoli in attesa`}</span>
        <div className="flex-1" />
        <time className="text-2xl font-bold tabular-nums">{ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</time>
      </header>

      {lista.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <CheckCircle size={48} weight="duotone" className="mx-auto mb-3 text-success" aria-hidden />
            <p className="text-xl font-semibold">Tutto evaso</p>
            <p className="mt-1 text-base text-text-muted">Le nuove comande compaiono qui da sole.</p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {lista.map(({ comanda, righe }) => {
            const t = tavoli.find((x) => x.id === comanda.tavoloId);
            const m = minuti(righe[0].inviataAt);
            const ritardo = m >= RITARDO_MIN;
            const nuovo = m < 1;
            const daFare = righe.filter((r) => r.stato !== 'pronta');
            const portate = [...new Set(righe.map((r) => r.portata))].sort((a, b) => a - b);
            return (
              <article key={comanda.id} aria-label={`Tavolo ${t?.numero}, ${m} minuti${ritardo ? ', in ritardo' : ''}`}
                className={`ticket-nuovo flex flex-col overflow-hidden rounded-lg bg-surface ${ritardo ? 'ring-[3px] ring-danger' : nuovo ? 'ring-[3px] ring-accent' : 'ring-1 ring-border'}`}>
                <button type="button" onClick={() => void esegui(() => db.segnaPronte(daFare.map((r) => r.id)))}
                  className={`premibile flex items-baseline justify-between px-4 py-3 text-left ${ritardo ? 'bg-danger text-on-danger' : ''}`}
                  aria-label={`Segna tutto pronto per il tavolo ${t?.numero}`}>
                  <b className="text-2xl tracking-tight">Tavolo {t?.numero}</b>
                  <span className={`text-xl font-bold tabular-nums ${nuovo && !ritardo ? 'text-accent' : ''}`}>{nuovo ? 'Nuovo' : `${m}′`}</span>
                </button>
                {comanda.allergeniTavolo.length > 0 && (
                  <div className="flex items-start gap-2 bg-allergene px-4 py-2 text-lg font-extrabold uppercase leading-6 text-on-allergene">
                    <Warning size={22} weight="fill" className="mt-0.5 flex-none" aria-hidden />
                    <span>{comanda.allergeniTavolo.map((a) => `${ALLERGENI_ETICHETTA[a.allergene]}${a.posto ? ` posto ${a.posto}` : ''}`).join(', ')}</span>
                  </div>
                )}
                {portate.map((p) => (
                  <div key={p}>
                    <div className="bg-surface-2 px-4 py-1.5 text-sm font-bold text-text-muted">{nomePortata(p)} · {comanda.operatore} · {comanda.coperti} coperti</div>
                    {righe.filter((r) => r.portata === p).map((r) => (
                      <button key={r.id} type="button" onClick={() => void esegui(() => db.segnaPronte([r.id]))} disabled={r.stato === 'pronta'}
                        className={`premibile flex min-h-12 w-full flex-col gap-0.5 border-t border-border px-4 py-2.5 text-left text-xl font-semibold ${r.stato === 'pronta' ? 'text-text-muted' : ''}`}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className={r.stato === 'pronta' ? 'line-through' : ''}>{r.quantita} × {r.descrizione}</span>
                          {r.stato === 'pronta' && <CheckCircle size={22} weight="fill" className="flex-none text-success" aria-label="pronto" />}
                        </span>
                        {[...r.varianti.map((v) => v.nome), r.posto ? `posto ${r.posto}` : '', r.note ? r.note : ''].filter(Boolean).map((x) => (
                          <span key={x} className="text-base font-medium text-text-muted">{x}</span>
                        ))}
                      </button>
                    ))}
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      )}
      <p className="px-5 pb-2 text-sm text-text-muted">Tocca una riga quando è pronta. Tocca il numero del tavolo per segnare tutto.</p>
    </div>
  );
}
