// Gestione → Clienti: anagrafica condivisa tra i locali, con allergie, preferenze, dati per la fattura e storico.
import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { nomeCliente, type Cliente } from '@gr/core';
import { Pulsante, Spinner } from '../../ui/primitivi';
import { Cerca } from '../../ui/campi';
import { Sezione, Vuoto } from './Layout';
import { EditorCliente, RigaCliente, Storico, useCercaClienti } from '../Clienti';

export function ClientiGestione() {
  const [cerca, setCerca] = useState('');
  const [aperto, setAperto] = useState<{ c: Cliente | null } | null>(null);
  const [scelto, setScelto] = useState<Cliente | null>(null);
  const { lista, ricarica } = useCercaClienti(cerca);
  return (
    <Sezione titolo="Clienti" sotto="Rubrica degli ospiti: allergie, preferenze, visite e dati per la fattura"
      azioni={<Pulsante variante="primario" taglia="md" icona={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setAperto({ c: null })}>Nuovo cliente</Pulsante>}>
      <div className="mb-4 max-w-md"><Cerca valore={cerca} onCambia={setCerca} segnaposto="Nome, telefono, email, P.IVA" /></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {lista === null ? <div className="grid h-40 place-items-center"><Spinner /></div>
          : lista.length === 0 ? <Vuoto titolo={cerca ? 'Nessun risultato' : 'Ancora nessun cliente'} testo={cerca ? `Nessun cliente per “${cerca}”.` : 'Si aggiungono qui o dal tavolo, con il pulsante “Cliente”.'} />
          : (
            <ul className="divide-y divide-border self-start overflow-hidden rounded-lg border border-border bg-surface">
              {lista.map((c) => (
                <li key={c.id} className={scelto?.id === c.id ? 'bg-surface-2' : ''}>
                  <RigaCliente c={c} onClick={() => setScelto(c)} />
                </li>
              ))}
            </ul>
          )}
        <aside className="self-start rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-0">
          {scelto ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold">{nomeCliente(scelto)}</h3>
                  <p className="text-sm text-text-muted">{[scelto.telefono, scelto.email].filter(Boolean).join(' · ') || 'Nessun contatto'}</p>
                </div>
                <Pulsante taglia="md" onClick={() => setAperto({ c: scelto })}>Modifica</Pulsante>
              </div>
              {scelto.preferenze && <p className="text-sm"><span className="font-semibold text-text-muted">Preferenze: </span>{scelto.preferenze}</p>}
              <Storico key={scelto.id} clienteId={scelto.id} />
            </div>
          ) : <p className="py-6 text-center text-sm text-text-muted">Scegli un cliente per vedere visite, spesa e piatti preferiti.</p>}
        </aside>
      </div>
      <EditorCliente aperto={!!aperto} cliente={aperto?.c ?? null} onChiudi={() => setAperto(null)}
        onSalvato={(c) => { setAperto(null); setScelto(c); ricarica(); }} />
    </Sezione>
  );
}
