import { useEffect, useState } from 'react';
import { inTauri } from '../dati/trasporto';
import { Foglio, Pulsante } from './primitivi';

type Stato = { versione: string; note?: string; installa: (onProgresso: (p: number) => void) => Promise<void> };

/** All'avvio della cassa (Mac/Windows) cerca una versione nuova e chiede prima di installarla. */
export function Aggiornamento() {
  const [nuova, setNuova] = useState<Stato | null>(null);
  const [aperto, setAperto] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri()) return;
    let annullato = false;
    (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const u = await check();
        if (!u || annullato) return;
        setNuova({
          versione: u.version,
          note: u.body ?? undefined,
          installa: async (onProgresso) => {
            let totale = 0, scaricati = 0;
            await u.downloadAndInstall((ev) => {
              if (ev.event === 'Started') totale = ev.data.contentLength ?? 0;
              if (ev.event === 'Progress') { scaricati += ev.data.chunkLength; if (totale) onProgresso(Math.round((scaricati / totale) * 100)); }
            });
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        });
        setAperto(true);
      } catch { /* senza rete o senza aggiornamenti: si lavora con la versione attuale */ }
    })();
    return () => { annullato = true; };
  }, []);

  if (!nuova) return null;
  const inCorso = progresso !== null && !errore;

  return (
    <Foglio aperto={aperto} onChiudi={() => { if (!inCorso) setAperto(false); }} titolo={`Nuova versione ${nuova.versione}`}>
      <p className="text-text-muted">
        È disponibile un aggiornamento della cassa. L'installazione richiede circa un minuto e poi l'app si riapre da sola.
        Non aggiornare durante il servizio.
      </p>
      {nuova.note && <p className="mt-3 whitespace-pre-line text-sm text-text-muted">{nuova.note}</p>}
      {inCorso && (
        <div className="mt-4" role="status">
          <div className="h-2 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progresso}%` }} />
          </div>
          <p className="mt-2 text-sm text-text-muted">Scarico l'aggiornamento… {progresso}%</p>
        </div>
      )}
      {errore && <p className="mt-3 text-sm text-danger" role="alert">{errore}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Pulsante onClick={() => setAperto(false)} disabled={inCorso}>Più tardi</Pulsante>
        <Pulsante variante="primario" caricamento={inCorso}
          onClick={async () => {
            setErrore(null); setProgresso(0);
            try { await nuova.installa(setProgresso); }
            catch (e) { setErrore(`Aggiornamento non riuscito: ${String(e)}. Riprova più tardi.`); setProgresso(null); }
          }}>
          Aggiorna ora
        </Pulsante>
      </div>
    </Foglio>
  );
}
