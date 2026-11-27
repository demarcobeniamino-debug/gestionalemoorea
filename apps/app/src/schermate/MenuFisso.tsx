// Menu fisso in comanda: per ogni gruppo si scelgono i piatti (es. 1 antipasto, 1 primo, 1 dolce).
// Il menu va sul conto con il suo prezzo; i piatti vanno in cucina, ognuno nella sua portata, a prezzo zero.
import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { euro, menuFisso, nomePortata, type Articolo } from '@gr/core';
import { useApp, useAzione, useDati } from '../dati/contesto';
import { Foglio, Pulsante } from '../ui/primitivi';

export function FoglioMenuFisso({ articolo, comandaId, onChiudi }: { articolo: Articolo | null; comandaId: string; onChiudi: () => void }) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const setup = useDati((d) => d.setup());
  const [scelte, setScelte] = useState<{ articoloId: string; gruppo: number }[]>([]);
  const m = articolo ? menuFisso(setup, articolo.id) : undefined;
  const chiudi = () => { setScelte([]); onChiudi(); };
  if (!articolo || !m) return null;
  const tocca = (gruppo: number, articoloId: string, max: number) => {
    const qui = scelte.filter((x) => x.gruppo === gruppo);
    const presente = qui.some((x) => x.articoloId === articoloId);
    if (presente) return setScelte(scelte.filter((x) => !(x.gruppo === gruppo && x.articoloId === articoloId)));
    // Scelta singola: toccare un altro piatto sostituisce il precedente.
    if (max === 1) return setScelte([...scelte.filter((x) => x.gruppo !== gruppo), { articoloId, gruppo }]);
    if (qui.length >= max) return;
    setScelte([...scelte, { articoloId, gruppo }]);
  };
  const completo = m.gruppi.every((g, i) => scelte.filter((x) => x.gruppo === i).length === g.scelte);
  return (
    <Foglio aperto onChiudi={chiudi} titolo={`${articolo.nome} · ${euro(articolo.prezzoCents)}`}>
      <div className="flex flex-col gap-5">
        {m.gruppi.map((g, i) => {
          const n = scelte.filter((x) => x.gruppo === i).length;
          return (
            <section key={i}>
              <h3 className="mb-2 flex items-baseline justify-between text-base font-semibold">
                <span>{g.nome} <span className="text-sm font-normal text-text-muted">· {nomePortata(g.portata)}</span></span>
                <span className={`text-sm ${n === g.scelte ? 'text-success' : 'text-text-muted'}`}>{n}/{g.scelte}</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.articoliIds.map((id) => {
                  const a = setup.articoli.find((x) => x.id === id);
                  if (!a) return null;
                  const on = scelte.some((x) => x.gruppo === i && x.articoloId === id);
                  return (
                    <button key={id} type="button" aria-pressed={on} disabled={a.esaurito} onClick={() => tocca(i, id, g.scelte)}
                      className={`premibile flex min-h-[64px] items-center gap-2 rounded-md border p-3 text-left text-[15px] font-semibold disabled:opacity-40 ${on ? 'border-accent bg-accent text-on-accent' : 'border-border bg-bg'}`}>
                      {on && <Check size={18} weight="bold" aria-hidden className="flex-none" />}<span>{a.nome}{a.esaurito ? ' · esaurito' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <Pulsante variante="primario" taglia="lg" disabled={!completo} caricamento={inCorso}
          onClick={() => void esegui(async () => { await db.aggiungiMenu(comandaId, articolo.id, scelte); chiudi(); }, `${articolo.nome} aggiunto`)}>
          {completo ? `Aggiungi ${articolo.nome}` : 'Scegli i piatti di ogni gruppo'}
        </Pulsante>
      </div>
    </Foglio>
  );
}
