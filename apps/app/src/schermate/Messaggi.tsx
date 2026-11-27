// Messaggi ai reparti: testo libero o frasi pronte, a cucina, bar o tutti. Escono in stampa e sul monitor.
import { useEffect, useState } from 'react';
import { ChatCircleText } from '@phosphor-icons/react';
import type { Comanda } from '@gr/core';
import { nuovaChiave, useApp, useAzione, useDati } from '../dati/contesto';
import { Foglio, IconaCentro, Pulsante } from '../ui/primitivi';

const FRASI_TAVOLO = ['Rallentate', 'Accelerate, hanno fretta', 'Manca un piatto', 'Piatto tornato indietro', 'Ospite allergico: chiamatemi', 'Tavolo in pausa'];
const FRASI = ['Pausa 5 minuti', 'Servizio in ritardo', 'Venite al pass', 'Arriva un gruppo numeroso', 'Finita la mise en place?', 'Chiamatemi'];

export function FoglioMessaggio({ aperto, comanda, onChiudi }: { aperto: boolean; comanda?: Comanda; onChiudi: () => void }) {
  const { db, operatore } = useApp();
  const { esegui, inCorso } = useAzione();
  const { centri, tavoli } = useDati((d) => ({ centri: d.setup().centri, tavoli: d.setup().tavoli }));
  const [scelti, setScelti] = useState<string[]>([]);
  const [testo, setTesto] = useState('');
  useEffect(() => { if (aperto) { setScelti(centri.map((c) => c.id)); setTesto(''); } }, [aperto]); // eslint-disable-line react-hooks/exhaustive-deps
  const tavolo = comanda ? tavoli.find((t) => t.id === comanda.tavoloId)?.numero : undefined;

  const invia = (t = testo) => void esegui(async () => {
    await db.inviaMessaggio({ centriIds: scelti, tipo: 'messaggio', testo: t, comandaId: comanda?.id }, nuovaChiave(), operatore ?? undefined);
    onChiudi();
  }, `Messaggio inviato a ${centri.filter((c) => scelti.includes(c.id)).map((c) => c.nome).join(' e ')}`);

  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo={tavolo ? `Messaggio · Tavolo ${tavolo}` : 'Messaggio ai reparti'} piede={<>
      <span className="flex-1" />
      <Pulsante onClick={onChiudi} taglia="md">Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} disabled={!testo.trim() || !scelti.length} onClick={() => invia()}
        icona={<ChatCircleText size={18} weight="bold" aria-hidden />}>Invia</Pulsante>
    </>}>
      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-semibold text-text-muted">A chi</legend>
        <div className="flex flex-wrap gap-2">
          {centri.map((c) => {
            const on = scelti.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setScelti((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                className={`premibile flex h-touch items-center gap-2 rounded-pill px-5 text-base font-bold ${on ? 'bg-accent text-on-accent' : 'border border-border bg-bg text-text-muted'}`}>
                <IconaCentro nome={c.nome} />{c.nome}
              </button>
            );
          })}
        </div>
      </fieldset>
      <p className="mb-2 text-sm font-semibold text-text-muted">Frasi pronte: un tocco e parte</p>
      <div className="mb-5 grid grid-cols-2 gap-2">
        {(comanda ? FRASI_TAVOLO : FRASI).map((f) => (
          <button key={f} type="button" disabled={!scelti.length || inCorso} onClick={() => invia(f)}
            className="premibile min-h-touch rounded-md border border-border bg-bg px-3 py-2 text-left text-[15px] font-semibold disabled:opacity-40">{f}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Oppure scrivi
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={3} maxLength={200}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && testo.trim()) { e.preventDefault(); invia(); } }}
          placeholder={tavolo ? `es. Tavolo ${tavolo}: il secondo senza sale` : 'es. Tra 10 minuti arriva il tavolo da 12'}
          className="rounded-md border border-border-input bg-bg px-3 py-2.5 text-base font-normal text-text outline-none placeholder:text-text-muted focus:border-focus" />
      </label>
    </Foglio>
  );
}
