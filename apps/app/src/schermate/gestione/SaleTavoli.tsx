// Sale e tavoli: la pianta si disegna trascinando i tavoli sulla griglia.
import { useEffect, useRef, useState, type PointerEvent as PE } from 'react';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import type { FormaTavolo, SalaRiga, TavoloRiga } from '@gr/core';
import { useApp } from '../../dati/contesto';
import { Foglio, Pulsante, useConferma } from '../../ui/primitivi';
import { CampoNumero, Segmenti, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle, Vuoto } from './Layout';

const FORME: { valore: FormaTavolo; testo: string }[] = [
  { valore: 'quadrato', testo: 'Quadrato' }, { valore: 'tondo', testo: 'Tondo' },
  { valore: 'rettangolo', testo: 'Lungo' }, { valore: 'sgabello', testo: 'Sgabello' },
];
const piu = <Plus size={18} weight="bold" aria-hidden="true" />;

/** Tavolo eliminato: resta nello storico dei conti ma libera il suo numero. */
export const datiTavoloEliminato = (t: TavoloRiga) => ({ id: t.id, attivo: false, numero: `${t.numero} · eliminato ${t.id.slice(0, 4)}` });

export function SaleTavoli() {
  const t = useTabelle();
  const { db } = useApp();
  const { archivio, esegui } = useSalva();
  const sale = [...t.sale].sort((a, b) => a.ordine - b.ordine);
  const [salaId, setSalaId] = useState(sale[0]?.id);
  const [editorSala, setEditorSala] = useState<SalaRiga | 'nuova' | null>(null);
  const [tavolo, setTavolo] = useState<TavoloRiga | null>(null);
  useEffect(() => { if (!sale.some((s) => s.id === salaId)) setSalaId(sale[0]?.id); }, [sale, salaId]);

  const sala = sale.find((s) => s.id === salaId);
  const tavoli = t.tavoli.filter((x) => x.sala_id === salaId && x.attivo);
  const occupato = (id: string) => !!db.comandaDelTavolo(id);

  const prossimoNumero = () => {
    const usati = new Set(t.tavoli.filter((x) => x.attivo).map((x) => x.numero));
    const max = Math.max(0, ...[...usati].map(Number).filter(Number.isFinite));
    let n = max + 1; while (usati.has(String(n))) n++;
    return String(n);
  };
  const primaCellaLibera = () => {
    for (let y = 0; y < 50; y++) for (let x = 0; x < 8; x++) {
      if (!tavoli.some((v) => x >= v.x && x < v.x + v.larghezza && y >= v.y && y < v.y + v.altezza)) return { x, y };
    }
    return { x: 0, y: 0 };
  };
  const aggiungi = () => esegui(async () => {
    const nuovo = await archivio.salva('tavoli', { sala_id: salaId, numero: prossimoNumero(), forma: 'quadrato', ...primaCellaLibera(), larghezza: 1, altezza: 1, posti: 4, attivo: true });
    setTavolo(nuovo);
  });

  return (
    <Sezione titolo="Sale e tavoli" sotto="Trascina i tavoli per disegnare la pianta. Tocca un tavolo per cambiarlo."
      azioni={<>
        <Pulsante taglia="md" icona={piu} onClick={() => setEditorSala('nuova')}>Nuova sala</Pulsante>
        {sala && <Pulsante variante="primario" taglia="md" icona={piu} onClick={() => void aggiungi()}>Aggiungi tavolo</Pulsante>}
      </>}>
      {!sale.length ? <Vuoto titolo="Nessuna sala" testo="Crea la prima sala (Interno, Dehors, Pergotenda…) e poi aggiungi i tavoli." azione={<Pulsante onClick={() => setEditorSala('nuova')}>Nuova sala</Pulsante>} /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Sale" className="flex gap-1 rounded-pill bg-surface p-1">
              {sale.map((s) => (
                <button key={s.id} role="tab" type="button" aria-selected={s.id === salaId} onClick={() => setSalaId(s.id)}
                  className={`premibile h-9 rounded-pill px-4 text-sm font-semibold ${s.id === salaId ? 'bg-accent text-on-accent' : 'text-text-muted'}`}>{s.nome}</button>
              ))}
            </div>
            {sala && <button type="button" onClick={() => setEditorSala(sala)} className="premibile flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-text-muted hover:bg-surface"><PencilSimple size={16} weight="bold" aria-hidden="true" />Rinomina</button>}
            <span className="ml-auto text-sm text-text-muted">{tavoli.length} tavoli · {tavoli.reduce((n, x) => n + x.posti, 0)} posti</span>
          </div>
          <Pianta tavoli={tavoli} occupato={occupato} onApri={setTavolo}
            onSposta={(x, pos) => void esegui(() => archivio.salva('tavoli', { id: x.id, ...pos }))} />
        </>
      )}
      {editorSala && <EditorSala key={editorSala === 'nuova' ? 'n' : editorSala.id} sala={editorSala === 'nuova' ? null : editorSala}
        nTavoli={editorSala === 'nuova' ? 0 : t.tavoli.filter((x) => x.sala_id === editorSala.id && x.attivo).length}
        onCreata={(id) => setSalaId(id)} onChiudi={() => setEditorSala(null)} ordine={Math.max(0, ...sale.map((s) => s.ordine)) + 1} />}
      {tavolo && <EditorTavolo key={tavolo.id} tavolo={tavolo} occupato={occupato(tavolo.id)} onChiudi={() => setTavolo(null)} />}
    </Sezione>
  );
}

function Pianta({ tavoli, occupato, onApri, onSposta }: {
  tavoli: TavoloRiga[]; occupato: (id: string) => boolean; onApri: (t: TavoloRiga) => void;
  onSposta: (t: TavoloRiga, pos: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; sx: number; sy: number; mosso: boolean } | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const colonne = Math.max(8, ...tavoli.map((t) => t.x + t.larghezza + 1));
  const righe = Math.max(5, ...tavoli.map((t) => t.y + t.altezza + 1));
  const u = Math.max(56, Math.floor(w / colonne));

  const giu = (e: PE<HTMLButtonElement>, t: TavoloRiga) => {
    if (drag) return; // un dito alla volta
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: t.id, dx: 0, dy: 0, sx: e.clientX, sy: e.clientY, mosso: false });
  };
  const muovi = (e: PE<HTMLButtonElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    setDrag({ ...drag, dx, dy, mosso: drag.mosso || Math.hypot(dx, dy) > 6 });
  };
  const su = (t: TavoloRiga) => {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (!d.mosso) return onApri(t);
    const x = Math.max(0, Math.round(t.x + d.dx / u)), y = Math.max(0, Math.round(t.y + d.dy / u));
    if (x !== t.x || y !== t.y) onSposta(t, { x, y });
  };

  return (
    <div ref={ref} className="overflow-auto rounded-lg border border-border bg-surface">
      {!tavoli.length ? <p className="px-6 py-16 text-center text-text-muted">Questa sala è vuota: tocca “Aggiungi tavolo”.</p> : (
        <div className="relative touch-none select-none" style={{
          width: colonne * u, height: righe * u,
          backgroundImage: 'radial-gradient(circle, var(--c-border) 1.5px, transparent 1.5px)', backgroundSize: `${u}px ${u}px`, backgroundPosition: `${-u / 2}px ${-u / 2}px`,
        }}>
          {tavoli.map((t) => {
            const d = drag?.id === t.id ? drag : null;
            const tondo = t.forma === 'tondo' || t.forma === 'sgabello';
            return (
              <button key={t.id} type="button" aria-label={`Tavolo ${t.numero}, ${t.posti} posti${occupato(t.id) ? ', occupato' : ''}. Tocca per modificare, trascina per spostare.`}
                onPointerDown={(e) => giu(e, t)} onPointerMove={muovi} onPointerUp={() => su(t)} onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  const m: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                  if (m[e.key]) { e.preventDefault(); onSposta(t, { x: Math.max(0, t.x + m[e.key][0]), y: Math.max(0, t.y + m[e.key][1]) }); }
                }}
                className={`absolute flex flex-col items-center justify-center border-2 font-bold ${d ? 'z-10 cursor-grabbing shadow-pop' : 'cursor-grab transition-[left,top] duration-base ease-out'} ${occupato(t.id) ? 'border-transparent bg-tavolo-occupato text-on-tavolo' : 'border-tavolo-libero-bordo bg-tavolo-libero text-text'} ${tondo ? 'rounded-pill' : 'rounded-md'}`}
                style={{
                  left: t.x * u + 4, top: t.y * u + 4, width: t.larghezza * u - 8, height: t.altezza * u - 8,
                  transform: d ? `translate(${d.dx}px, ${d.dy}px) scale(1.04)` : undefined,
                }}>
                <span className="text-lg leading-none">{t.numero}</span>
                <span className="mt-1 text-xs font-semibold opacity-80">{t.posti} p.</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditorSala({ sala, nTavoli, ordine, onCreata, onChiudi }: { sala: SalaRiga | null; nTavoli: number; ordine: number; onCreata: (id: string) => void; onChiudi: () => void }) {
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const [nome, setNome] = useState(sala?.nome ?? '');
  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Manca il nome della sala.');
    const s = await archivio.salva('sale', { ...(sala ? { id: sala.id } : { ordine }), nome: nome.trim() });
    if (!sala) onCreata(s.id);
    onChiudi();
  }, sala ? 'Sala rinominata' : 'Sala creata');
  return (
    <Foglio aperto onChiudi={onChiudi} titolo={sala ? `Sala ${sala.nome}` : 'Nuova sala'}>
      <div className="flex flex-col gap-4">
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Es. Dehors" />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {sala && (nTavoli > 0
            ? <p className="text-sm text-text-muted">Per eliminarla, togli prima i suoi {nTavoli} tavoli.</p>
            : <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare la sala “${sala.nome}”?`, () => void esegui(async () => { await archivio.elimina('sale', { id: sala.id }); onChiudi(); }, 'Sala eliminata'), 'Elimina')}>Elimina sala</Pulsante>)}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}

function EditorTavolo({ tavolo, occupato, onChiudi }: { tavolo: TavoloRiga; occupato: boolean; onChiudi: () => void }) {
  const t = useTabelle();
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const [numero, setNumero] = useState(tavolo.numero);
  const [forma, setForma] = useState<FormaTavolo>(tavolo.forma);
  const [posti, setPosti] = useState<number | null>(tavolo.posti);
  const [larghezza, setLarghezza] = useState<number | null>(tavolo.larghezza);
  const [salaId, setSalaId] = useState(tavolo.sala_id);
  const salva = () => esegui(async () => {
    if (!numero.trim()) throw new Error('Manca il numero del tavolo.');
    if (!posti || posti < 1) throw new Error('I posti devono essere almeno 1.');
    const lungo = forma === 'rettangolo';
    await archivio.salva('tavoli', { id: tavolo.id, numero: numero.trim(), forma, posti, sala_id: salaId, larghezza: lungo ? Math.max(2, Math.round(larghezza ?? 2)) : 1, altezza: 1 });
    onChiudi();
  }, 'Tavolo salvato');

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={`Tavolo ${tavolo.numero}`}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Testo etichetta="Numero o nome" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="12, B3, Bancone" />
          <CampoNumero etichetta="Posti" valore={posti} onCambia={setPosti} min={1} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-muted">Forma</p>
          <Segmenti etichetta="Forma" valore={forma} opzioni={FORME} onCambia={setForma} />
        </div>
        {forma === 'rettangolo' && <CampoNumero etichetta="Lunghezza" valore={larghezza} onCambia={setLarghezza} unita="caselle" min={2} aiuto="Quante caselle occupa sulla pianta" />}
        {t.sale.length > 1 && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-text-muted">Sala</p>
            <Segmenti etichetta="Sala" valore={salaId} opzioni={t.sale.map((s) => ({ valore: s.id, testo: s.nome }))} onCambia={setSalaId} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {occupato
            ? <p className="text-sm text-text-muted">È aperto: si può eliminare quando il conto è chiuso.</p>
            : <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare il tavolo ${tavolo.numero}? I conti passati restano nello storico.`, () => void esegui(async () => { await archivio.salva('tavoli', datiTavoloEliminato(tavolo)); onChiudi(); }, 'Tavolo eliminato'), 'Elimina')}>Elimina tavolo</Pulsante>}
          <span className="flex-1" />
          <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
        </div>
      </div>
      {ui}
    </Foglio>
  );
}
