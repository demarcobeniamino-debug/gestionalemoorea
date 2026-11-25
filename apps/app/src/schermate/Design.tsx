import { useState } from 'react';
import { Icona, Pulsante, Tastierino } from '../ui/primitivi';

// /design — i primitivi in isolamento, per il controllo del design system.
export function Design() {
  const [tema, setTema] = useState<'servizio' | 'ufficio'>('servizio');
  const [tasti, setTasti] = useState('');
  return (
    <div data-tema={tema} className="min-h-full bg-bg p-6 text-text">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-xl font-bold">Design system</h1>
        <Pulsante taglia="md" onClick={() => setTema(tema === 'servizio' ? 'ufficio' : 'servizio')}>Tema: {tema}</Pulsante>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Pulsanti</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Pulsante variante="primario">Primario</Pulsante>
          <Pulsante variante="conferma" icona={Icona.stampa}>Invia 2ª</Pulsante>
          <Pulsante variante="pericolo">Storna</Pulsante>
          <Pulsante>Secondario</Pulsante>
          <Pulsante variante="fantasma">Fantasma</Pulsante>
          <Pulsante variante="conferma" caricamento>In stampa</Pulsante>
          <Pulsante disabled>Disabilitato</Pulsante>
          <Pulsante variante="conferma" taglia="xl" icona={Icona.scontrino}>Incassa e stampa scontrino</Pulsante>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Tavoli</h2>
        <div className="flex flex-wrap gap-4">
          {[
            ['bg-tavolo-libero border-2 border-tavolo-libero-bordo text-text', '2', '4 posti'],
            ['bg-tavolo-occupato text-on-tavolo', '7', '4 cop · 52′'],
            ['bg-tavolo-prenotato text-on-tavolo', '3', '21:15'],
            ['bg-tavolo-conto text-on-tavolo', '4', 'Conto'],
            ['bg-tavolo-ritardo text-on-tavolo', '6', '2ª · 24′'],
          ].map(([cls, n, s]) => (
            <div key={n} className={`flex h-24 w-28 flex-col items-center justify-center rounded-lg ${cls}`}><b className="text-xl">{n}</b><span className="text-xs font-semibold">{s}</span></div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Avvisi</h2>
        <div className="flex max-w-xl flex-col gap-2">
          <div className="flex items-center gap-2 rounded-md bg-allergene px-4 py-2 text-sm font-bold text-on-allergene">{Icona.avviso}ALLERGIA FRUTTA A GUSCIO · posto 2</div>
          <div className="rounded-md bg-danger p-3 text-sm font-bold text-on-danger">Lo scontrino potrebbe essere già uscito.</div>
          <div className="rounded-md bg-success p-3 text-sm font-bold text-on-success">Inviata a Cucina e Bar</div>
        </div>
      </section>

      <section className="mb-8 max-w-sm">
        <h2 className="mb-3 text-lg font-semibold">Tastierino</h2>
        <output className="mb-2 block h-8 text-xl tabular-nums">{tasti || '—'}</output>
        <Tastierino onTasto={(t) => setTasti((x) => (x + t).slice(-8))} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Campo</h2>
        <label className="flex max-w-sm flex-col gap-1 text-sm font-semibold text-text-muted">Nota per la cucina
          <input className="h-touch rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text" placeholder="es. niente noci" />
        </label>
      </section>
    </div>
  );
}
