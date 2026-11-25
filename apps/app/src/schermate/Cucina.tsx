import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ALLERGENI_ETICHETTA, nomePortata } from '@gr/core';
import { useApp, useDati, useOra } from '../dati/contesto';

const RITARDO_MIN = 20;

// S11 — monitor di produzione (cucina o bar). Tocca riga = pronta, tocca testata = tutto pronto.
export function Cucina() {
  const { db } = useApp();
  const ora = useOra(10000);
  const { centri, tavoli } = useDati((d) => ({ centri: d.setup().centri, tavoli: d.setup().tavoli }));
  const [centroId, setCentroId] = useState(centri[0].id);
  const lista = useDati((d) => d.righeDaPreparare(centroId));

  const minuti = (iso?: string) => (iso ? Math.floor((ora.getTime() - new Date(iso).getTime()) / 60000) : 0);

  return (
    <div className="flex h-full flex-col bg-bg text-text" data-tema="servizio">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-5">
        <Link to="/sala" className="text-sm font-semibold text-text-muted underline">Sala</Link>
        <div role="tablist" aria-label="Centro di produzione" className="flex gap-1 rounded-md bg-bg p-1">
          {centri.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === centroId} onClick={() => setCentroId(c.id)}
              className={`h-10 rounded-sm px-4 text-sm font-bold ${c.id === centroId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{c.nome}</button>
          ))}
        </div>
        <span className="text-base font-semibold text-text-muted">{lista.length} in attesa</span>
        <div className="flex-1" />
        <time className="text-2xl font-bold tabular-nums">{ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</time>
      </header>

      {lista.length === 0 ? (
        <p className="grid flex-1 place-items-center text-xl text-text-muted">Nessuna comanda in attesa.</p>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-4">
          {lista.map(({ comanda, righe }) => {
            const t = tavoli.find((x) => x.id === comanda.tavoloId);
            const m = minuti(righe[0].inviataAt);
            const ritardo = m >= RITARDO_MIN;
            const nuovo = m < 1;
            const daFare = righe.filter((r) => r.stato !== 'pronta');
            const portate = [...new Set(righe.map((r) => r.portata))].sort((a, b) => a - b);
            return (
              <article key={comanda.id} aria-label={`Tavolo ${t?.numero}, ${m} minuti${ritardo ? ', in ritardo' : ''}`}
                className={`flex flex-col overflow-hidden rounded-lg bg-surface ${ritardo ? 'outline outline-[3px] outline-danger' : nuovo ? 'outline outline-[3px] outline-accent' : ''}`}>
                <button type="button" onClick={() => db.segnaPronte(daFare.map((r) => r.id))}
                  className={`flex items-baseline justify-between px-4 py-3 text-left ${ritardo ? 'bg-danger text-on-danger' : ''}`}
                  aria-label={`Segna tutto pronto per il tavolo ${t?.numero}`}>
                  <b className="text-2xl">Tav. {t?.numero}</b>
                  <span className="text-xl font-bold tabular-nums">{nuovo ? 'NUOVO' : `${m}′`}</span>
                </button>
                {comanda.allergeniTavolo.length > 0 && (
                  <div className="bg-allergene px-4 py-2 text-lg font-extrabold text-on-allergene">
                    ⚠ {comanda.allergeniTavolo.map((a) => `${ALLERGENI_ETICHETTA[a.allergene].toUpperCase()}${a.posto ? ` · posto ${a.posto}` : ''}`).join(' · ')}
                  </div>
                )}
                {portate.map((p) => (
                  <div key={p}>
                    <div className="bg-surface-2 px-4 py-1.5 text-sm font-bold text-text-muted">{nomePortata(p).toUpperCase()} · {comanda.operatore} · {comanda.coperti} cop</div>
                    {righe.filter((r) => r.portata === p).map((r) => (
                      <button key={r.id} type="button" onClick={() => db.segnaPronte([r.id])} disabled={r.stato === 'pronta'}
                        className={`flex min-h-12 w-full flex-col gap-0.5 border-t border-border px-4 py-2.5 text-left text-xl font-semibold ${r.stato === 'pronta' ? 'text-text-muted line-through' : ''}`}>
                        <span>{r.quantita} × {r.descrizione}{r.stato === 'pronta' && <span className="ml-2 text-base text-success no-underline">✓ pronto</span>}</span>
                        {[...r.varianti.map((v) => v.nome), r.posto ? `posto ${r.posto}` : '', r.note ? `* ${r.note}` : ''].filter(Boolean).map((x) => (
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
      <p className="px-5 pb-2 text-sm text-text-muted">Tocca una riga = pronta · tocca la testata = tutto pronto</p>
    </div>
  );
}
