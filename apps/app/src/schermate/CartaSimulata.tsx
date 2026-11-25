import { useState } from 'react';
import { anteprima, type PrintJob } from '@gr/core';
import { useApp, useDati } from '../dati/contesto';
import { Icona } from '../ui/primitivi';

// Solo nel browser: mostra cosa sarebbe uscito dalle stampanti e permette di simulare i guasti.
export function CartaSimulata() {
  const { simulato } = useApp();
  const { lavori, stampanti } = useDati((d) => ({ lavori: d.lavori(), stampanti: d.setup().stampanti }));
  const [aperto, setAperto] = useState(false);
  const [, forza] = useState(0);
  if (!simulato) return null;
  const host = (id: string) => stampanti.find((s) => s.id === id)!.host;
  const guasto = (id: string, tipo?: 'offline' | 'incerto') => {
    if (tipo) simulato.guasti[host(id)] = tipo; else delete simulato.guasti[host(id)];
    forza((n) => n + 1);
  };
  const ultimi = [...lavori].reverse().slice(0, 12);

  return (
    <>
      <button type="button" onClick={() => setAperto(true)}
        className="fixed bottom-24 left-3 z-30 flex h-12 items-center gap-2 rounded-pill bg-surface-2 px-4 text-sm font-semibold text-text shadow-pop md:bottom-4"
        aria-label="Apri la carta simulata">
        {Icona.carta}Carta ({lavori.length})
      </button>
      {aperto && (
        <div className="fixed inset-0 z-50 flex bg-black/60" onClick={() => setAperto(false)}>
          <div className="ml-auto flex h-full w-full max-w-[460px] flex-col bg-bg text-text shadow-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Carta simulata">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-lg font-bold">Carta simulata</h2>
              <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi" className="grid h-10 w-10 place-items-center rounded-md hover:bg-surface">{Icona.chiudi}</button>
            </div>
            <div className="border-b border-border px-4 py-3 text-sm">
              <p className="mb-2 text-text-muted">Nell’app di cassa questi ticket escono davvero dalle Matchpower e dall’Epson. Qui puoi simulare un guasto:</p>
              <div className="flex flex-wrap gap-2">
                {stampanti.map((s) => {
                  const g = simulato.guasti[s.host];
                  return (
                    <button key={s.id} type="button" onClick={() => guasto(s.id, !g ? 'offline' : g === 'offline' && s.tipo !== 'comande_escpos' ? 'incerto' : undefined)}
                      className={`h-10 rounded-sm px-3 font-semibold ${g ? 'bg-danger text-on-danger' : 'border border-border bg-surface'}`}>
                      {s.nome}: {g === 'offline' ? 'spenta' : g === 'incerto' ? 'risposta persa' : 'ok'}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto bg-surface-2 p-4">
              {ultimi.length === 0 && <p className="text-text-muted">Ancora niente in stampa.</p>}
              {ultimi.map((j) => <Foglietto key={j.id} job={j} nome={stampanti.find((s) => s.id === j.stampanteId)!.nome} colonne={stampanti.find((s) => s.id === j.stampanteId)!.colonne} />)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Foglietto({ job, nome, colonne }: { job: PrintJob; nome: string; colonne: number }) {
  const stato = { in_coda: 'in coda', preso: 'in stampa', stampato: 'stampato', errore: 'errore', da_verificare: 'da verificare' }[job.stato];
  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex justify-between text-xs font-semibold text-text-muted">
        <span>{nome}</span><span className={job.stato === 'stampato' ? 'text-success' : job.stato === 'in_coda' ? '' : 'text-danger'}>{stato}{job.errore ? ` · ${job.errore}` : ''}</span>
      </figcaption>
      {job.ticket ? (
        <pre className="m-0 overflow-x-auto bg-carta p-3 font-mono text-[11px] leading-4 text-inchiostro shadow-card">
          {anteprima(job.ticket, colonne).map((r, i) => (
            <div key={i} className={`${r.stile.grassetto ? 'font-bold' : ''} ${r.stile.inverso ? 'bg-inchiostro text-carta' : ''} ${r.stile.grande ? 'text-[20px] leading-7' : r.stile.doppiaAltezza ? 'origin-left scale-y-[1.6] py-0.5' : ''} ${r.stile.allinea === 'centro' ? 'text-center' : ''}`}>{r.testo || ' '}</div>
          ))}
          <div className="mt-2 text-center tracking-widest">- - - taglio - - -</div>
        </pre>
      ) : (
        <div className="bg-carta p-3 font-mono text-[11px] leading-4 text-inchiostro shadow-card">
          <div className="text-center font-bold">DOCUMENTO COMMERCIALE</div>
          <div className="text-center">(formato dell’Epson RT)</div>
          {[...(job.xml ?? '').matchAll(/<printRecItem[^>]*description="([^"]*)" quantity="([^"]*)" unitPrice="([^"]*)"/g)].map((m, i) => (
            <div key={i} className="flex justify-between"><span>{m[2]} x {m[1]}</span><span>{m[3]}</span></div>
          ))}
          {[...(job.xml ?? '').matchAll(/<printRecTotal[^>]*description="([^"]*)" payment="([^"]*)"/g)].map((m, i) => (
            <div key={i} className="mt-1 flex justify-between font-bold"><span>{m[1]}</span><span>{m[2]}</span></div>
          ))}
        </div>
      )}
    </figure>
  );
}

