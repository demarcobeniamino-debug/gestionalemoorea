// Comande, preconti e stampe non fiscali che non sono uscite: la cassa riprova da sola ogni 10 secondi,
// ma chi è in sala deve saperlo subito e poterle mandare su un'altra stampante.
import { useState } from 'react';
import { ArrowClockwise, Printer } from '@phosphor-icons/react';
import type { PrintJob } from '@gr/core';
import { useApp, useAzione, useDati } from '../dati/contesto';
import { Foglio, Pulsante } from './primitivi';

const NON_FISCALI = new Set<PrintJob['tipo']>(['comanda', 'preconto', 'non_fiscale']);
const NOME: Partial<Record<PrintJob['tipo'], string>> = { comanda: 'Comanda', preconto: 'Preconto', non_fiscale: 'Stampa' };
const ora = (iso: string) => new Date(iso.replace(/(Z)\d+$/, '$1')).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function useStampeNonUscite() {
  return useDati((d) => d.lavori().filter((j) => j.stato === 'errore' && NON_FISCALI.has(j.tipo)));
}

export function FoglioStampeNonUscite({ aperto, onChiudi }: { aperto: boolean; onChiudi: () => void }) {
  const { db } = useApp();
  const { esegui, inCorso } = useAzione();
  const lavori = useStampeNonUscite();
  const stampanti = useDati((d) => d.setup().stampanti.filter((s) => s.tipo === 'comande_escpos'));
  const [altra, setAltra] = useState<Record<string, string>>({});
  const nome = (id: string) => stampanti.find((s) => s.id === id)?.nome ?? 'Stampante';
  const tutte = (stampanteId?: string) => void esegui(async () => { for (const j of lavori) await db.rimandaLavoro(j.id, stampanteId); }, 'Rimandate in stampa');

  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo="Stampe non uscite"
      piede={lavori.length > 1 ? <Pulsante variante="primario" taglia="md" disabled={inCorso} onClick={() => tutte()} className="w-full">Riprova tutte adesso</Pulsante> : undefined}>
      {lavori.length === 0 ? <p className="py-6 text-center text-text-muted">Tutto stampato.</p> : (
        <>
          <p className="mb-3 text-sm text-text-muted">La cassa riprova da sola ogni 10 secondi. Se la stampante è guasta, mandale su un’altra: escono subito lì.</p>
          <ul className="flex flex-col gap-3">
            {lavori.map((j) => (
              <li key={j.id} className="rounded-lg border border-border bg-bg p-3">
                <p className="font-semibold">{NOME[j.tipo]}{j.ticket?.titolo ? ` · ${j.ticket.titolo}` : ''} <span className="font-normal text-text-muted">· {ora(j.createdAt)} · {nome(j.stampanteId)}</span></p>
                {j.errore && <p className="mt-0.5 text-sm text-danger">{j.errore}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pulsante taglia="md" disabled={inCorso} onClick={() => void esegui(() => db.rimandaLavoro(j.id), 'Rimandata')}>
                    <ArrowClockwise size={18} aria-hidden />Riprova
                  </Pulsante>
                  {stampanti.length > 1 && (
                    <>
                      <select aria-label="Altra stampante" className="h-touch rounded-md border border-border-input bg-surface px-3 text-sm"
                        value={altra[j.id] ?? ''} onChange={(e) => setAltra({ ...altra, [j.id]: e.target.value })}>
                        <option value="">Altra stampante…</option>
                        {stampanti.filter((s) => s.id !== j.stampanteId).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                      </select>
                      <Pulsante taglia="md" variante="primario" disabled={inCorso || !altra[j.id]} onClick={() => void esegui(() => db.rimandaLavoro(j.id, altra[j.id]), `Mandata su ${nome(altra[j.id])}`)}>
                        <Printer size={18} aria-hidden />Stampa lì
                      </Pulsante>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Foglio>
  );
}
