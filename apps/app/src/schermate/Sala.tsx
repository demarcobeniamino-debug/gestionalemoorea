import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { calcolaConto, euro, type Comanda, type Tavolo } from '@gr/core';
import { useApp, useDati, useOra } from '../dati/contesto';
import { Testata } from '../ui/Testata';
import { Foglio, Pulsante } from '../ui/primitivi';

const UNITA = 120; // px per unità di griglia della piantina
const RITARDO_MIN = 20;

type Stato = 'libero' | 'occupato' | 'conto' | 'ritardo';
const STILE: Record<Stato, string> = {
  libero: 'bg-tavolo-libero border-2 border-tavolo-libero-bordo text-text',
  occupato: 'bg-tavolo-occupato text-on-tavolo',
  conto: 'bg-tavolo-conto text-on-tavolo',
  ritardo: 'bg-tavolo-ritardo text-on-tavolo',
};
const NOME_STATO: Record<Stato, string> = { libero: 'Liberi', occupato: 'Occupati', conto: 'Conto chiesto', ritardo: 'In ritardo' };

// S03 — sala con stato dei tavoli.
export function Sala() {
  const { db, operatore, toast } = useApp();
  const nav = useNavigate();
  const ora = useOra();
  const { sale, tavoli, aperte, copertoCents } = useDati((d) => ({
    sale: d.setup().sale, tavoli: d.setup().tavoli, aperte: d.comandeAperte(), copertoCents: d.setup().locale.copertoCents,
  }));
  const [salaId, setSalaId] = useState(sale[0].id);
  const [daAprire, setDaAprire] = useState<Tavolo | null>(null);
  const [coperti, setCoperti] = useState(2);

  const info = (t: Tavolo): { stato: Stato; comanda?: Comanda; minuti?: number; totale?: number } => {
    const c = aperte.find((x) => x.tavoloId === t.id);
    if (!c) return { stato: 'libero' };
    const righe = db.righe(c.id);
    const minuti = Math.floor((ora.getTime() - new Date(c.apertaAt).getTime()) / 60000);
    const inRitardo = righe.some((r) => r.stato === 'inviata' && r.inviataAt && ora.getTime() - new Date(r.inviataAt).getTime() > RITARDO_MIN * 60000);
    const totale = calcolaConto(righe, c.coperti, copertoCents).totaleCents;
    return { stato: c.stato === 'preconto' ? 'conto' : inRitardo ? 'ritardo' : 'occupato', comanda: c, minuti, totale };
  };

  const visibili = tavoli.filter((t) => t.salaId === salaId);
  const conteggi = (['libero', 'occupato', 'conto', 'ritardo'] as Stato[]).map((s) => [s, visibili.filter((t) => info(t).stato === s).length] as const);
  const copertiInSala = aperte.filter((c) => visibili.some((t) => t.id === c.tavoloId)).reduce((s, c) => s + c.coperti, 0);

  const tocca = (t: Tavolo) => {
    const i = info(t);
    if (i.comanda) nav(`/comanda/${i.comanda.id}`);
    else { setCoperti(Math.min(t.posti, 2)); setDaAprire(t); }
  };

  const apri = () => {
    if (!daAprire || !operatore) return;
    try {
      const c = db.apriTavolo(daAprire.id, coperti, operatore.nome);
      setDaAprire(null);
      nav(`/comanda/${c.id}`);
    } catch (e) { toast({ testo: (e as Error).message, tipo: 'errore' }); }
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Testata titolo="Moorea Food Club" sotto={operatore ? `Operatore ${operatore.nome}` : undefined}>
        <nav aria-label="Sale" className="flex gap-1 rounded-md bg-bg p-1">
          {sale.map((s) => (
            <button key={s.id} type="button" onClick={() => setSalaId(s.id)} aria-pressed={s.id === salaId}
              className={`h-10 rounded-sm px-4 text-sm font-semibold ${s.id === salaId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{s.nome}</button>
          ))}
        </nav>
      </Testata>

      <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-sm font-semibold text-text-muted">
        {conteggi.map(([s, n]) => (
          <span key={s} className="flex items-center gap-2">
            <i aria-hidden="true" className={`block h-3 w-3 rounded-sm ${STILE[s]}`} />{NOME_STATO[s]} {n}
          </span>
        ))}
        <span className="flex-1" />
        <span className="text-text">{copertiInSala} coperti in sala</span>
        <Link to="/cucina" className="rounded-md border border-border px-3 py-2 text-text">Monitor cucina</Link>
      </div>

      <main className="relative flex-1 overflow-auto">
        {visibili.length === 0 && <p className="p-8 text-base text-text-muted">Questa sala non ha ancora tavoli. Disegnala in Impostazioni → Sale.</p>}
        <div className="relative m-4" style={{ width: 5 * UNITA, height: 3 * UNITA }}>
          {visibili.map((t) => {
            const i = info(t);
            const tondo = t.forma === 'tondo' || t.forma === 'sgabello';
            const etichetta = i.stato === 'libero'
              ? `Tavolo ${t.numero}, libero, ${t.posti} posti`
              : `Tavolo ${t.numero}, ${NOME_STATO[i.stato].toLowerCase()}, ${i.comanda!.coperti} coperti, ${i.minuti} minuti, ${euro(i.totale!)}`;
            return (
              <button key={t.id} type="button" onClick={() => tocca(t)} aria-label={etichetta}
                className={`absolute flex flex-col items-center justify-center gap-0.5 tabular-nums transition-transform duration-fast active:scale-[.97] ${tondo ? 'rounded-pill' : 'rounded-lg'} ${STILE[i.stato]}`}
                style={{ left: t.x * UNITA, top: t.y * UNITA, width: t.larghezza * UNITA - 16, height: t.altezza * UNITA - 16 }}>
                <b className="text-xl leading-none">{t.numero}</b>
                {i.stato === 'libero'
                  ? <span className="text-xs font-semibold text-text-muted">{t.posti} posti</span>
                  : <>
                      <span className="text-xs font-semibold">{i.comanda!.coperti} cop · {i.minuti}′</span>
                      <span className="text-xs font-semibold">{i.stato === 'conto' ? 'Conto' : euro(i.totale!)}</span>
                    </>}
              </button>
            );
          })}
        </div>
      </main>

      <Foglio aperto={!!daAprire} onChiudi={() => setDaAprire(null)} titolo={`Apri tavolo ${daAprire?.numero ?? ''}`}>
        <div className="mb-6 flex items-center justify-center gap-6">
          <button type="button" aria-label="Meno coperti" onClick={() => setCoperti((c) => Math.max(1, c - 1))} className="h-16 w-16 rounded-md bg-surface text-xl">−</button>
          <output aria-live="polite" className="w-24 text-center text-display font-bold tabular-nums">{coperti}<span className="sr-only"> coperti</span></output>
          <button type="button" aria-label="Più coperti" onClick={() => setCoperti((c) => Math.min(40, c + 1))} className="h-16 w-16 rounded-md bg-surface text-xl">+</button>
        </div>
        <Pulsante variante="primario" taglia="xl" className="w-full" onClick={apri}>Apri e prendi la comanda</Pulsante>
      </Foglio>
    </div>
  );
}
