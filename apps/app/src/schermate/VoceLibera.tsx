// Voce libera: un piatto fuori menu ("pasta al pomodoro") aggiunto al volo, senza creare un articolo.
// Le ultime voci usate restano sul dispositivo per rifarle con un tocco.
import { useEffect, useRef, useState } from 'react';
import { euro, nomePortata, type VoceLibera } from '@gr/core';
import { useDati } from '../dati/contesto';
import { Foglio, Pulsante } from '../ui/primitivi';
import { CampoEuro, Segmenti } from '../ui/campi';

const CHIAVE = 'cassa.vociLibere';
type Recente = VoceLibera & { portata: number };
const leggi = (): Recente[] => { try { return JSON.parse(localStorage.getItem(CHIAVE) ?? '[]'); } catch { return []; } };
const ricorda = (v: Recente) => {
  try {
    const l = [v, ...leggi().filter((x) => x.descrizione.toLowerCase() !== v.descrizione.toLowerCase())].slice(0, 8);
    localStorage.setItem(CHIAVE, JSON.stringify(l));
  } catch { /* memoria del browser non disponibile: pazienza */ }
};
const PORTATE = [0, 1, 2, 3, 9];

export function FoglioVoceLibera({ aperto, portataIniziale, descrizioneIniziale = '', onChiudi, onAggiungi }: {
  aperto: boolean; portataIniziale: number | null; descrizioneIniziale?: string; onChiudi: () => void;
  onAggiungi: (v: VoceLibera, extra: { portata: number; quantita: number; note?: string }) => void;
}) {
  const setup = useDati((d) => d.setup());
  const iva10 = setup.aliquote.find((a) => a.percentuale === 10) ?? setup.aliquote[0];
  const cucina = setup.centri.find((c) => /cucina/i.test(c.nome)) ?? setup.centri[0];
  const [descrizione, setDescrizione] = useState('');
  const [prezzo, setPrezzo] = useState<number | null>(null);
  const [centro, setCentro] = useState<string>(cucina?.id ?? '');
  const [iva, setIva] = useState(iva10?.id ?? '');
  const [portata, setPortata] = useState(1);
  const [quantita, setQuantita] = useState(1);
  const [note, setNote] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [recenti, setRecenti] = useState<Recente[]>([]);
  const nome = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aperto) return;
    setDescrizione(descrizioneIniziale ? descrizioneIniziale[0].toUpperCase() + descrizioneIniziale.slice(1) : ''); setPrezzo(null); setCentro(cucina?.id ?? ''); setIva(iva10?.id ?? ''); setQuantita(1); setNote(''); setErrore(null);
    setPortata(portataIniziale ?? 1); setRecenti(leggi());
    setTimeout(() => nome.current?.focus(), 250);
  }, [aperto]); // eslint-disable-line react-hooks/exhaustive-deps

  const conferma = (v?: Recente) => {
    const voce: Recente = v ?? { descrizione: descrizione.trim(), prezzoCents: prezzo ?? -1, centroId: centro || null, aliquotaIvaId: iva, portata };
    if (!voce.descrizione) return setErrore('Scrivi cosa aggiungere');
    if (voce.prezzoCents < 0) return setErrore('Metti il prezzo (anche 0,00 se è offerto)');
    ricorda(voce);
    onAggiungi(voce, { portata: voce.portata, quantita: v ? 1 : quantita, note: v ? undefined : note.trim() || undefined });
  };

  return (
    <Foglio aperto={aperto} onChiudi={onChiudi} titolo="Voce libera" piede={<>
      <div className="flex items-center gap-1 rounded-md bg-bg p-1" role="group" aria-label="Quantità">
        <button type="button" aria-label="Meno" onClick={() => setQuantita((q) => Math.max(1, q - 1))} className="premibile h-11 w-11 rounded-md bg-surface-2 text-xl font-bold">−</button>
        <output className="w-9 text-center text-lg font-bold tabular-nums" aria-label="Quantità">{quantita}</output>
        <button type="button" aria-label="Più" onClick={() => setQuantita((q) => Math.min(99, q + 1))} className="premibile h-11 w-11 rounded-md bg-surface-2 text-xl font-bold">+</button>
      </div>
      <span className="flex-1" />
      <Pulsante variante="primario" taglia="lg" onClick={() => conferma()}>
        Aggiungi{prezzo != null && prezzo >= 0 ? ` · ${euro(prezzo * quantita)}` : ''}
      </Pulsante>
    </>}>
      {recenti.length > 0 && (
        <section className="mb-5" aria-label="Usate di recente">
          <p className="mb-2 text-sm font-semibold text-text-muted">Rifai con un tocco</p>
          <div className="flex flex-wrap gap-2">
            {recenti.map((r) => (
              <button key={r.descrizione} type="button" onClick={() => conferma(r)}
                className="premibile flex h-touch items-center gap-2 rounded-pill border border-border bg-bg px-4 text-sm font-bold">
                {r.descrizione}<span className="font-medium text-text-muted tabular-nums">{euro(r.prezzoCents, false)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Cosa
          <input ref={nome} value={descrizione} maxLength={60} onChange={(e) => { setDescrizione(e.target.value); setErrore(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') conferma(); }} placeholder="es. Pasta al pomodoro"
            aria-invalid={!!errore && !descrizione.trim() || undefined}
            className="h-touch rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text outline-none placeholder:text-text-muted focus:border-focus" />
        </label>
        <CampoEuro etichetta="Prezzo" valore={prezzo} onCambia={(v) => { setPrezzo(v); setErrore(null); }} />
      </div>
      {errore && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{errore}</p>}
      <div className="mt-5 flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-muted">Dove si prepara</p>
          <Segmenti etichetta="Reparto" valore={centro} onCambia={setCentro}
            opzioni={[...setup.centri.map((c) => ({ valore: c.id, testo: c.nome })), { valore: '', testo: 'Nessuno (solo conto)' }]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-text-muted">Portata</p>
            <Segmenti etichetta="Portata" valore={String(portata)} onCambia={(v) => setPortata(Number(v))}
              opzioni={PORTATE.map((p) => ({ valore: String(p), testo: nomePortata(p).replace(' portata', '') }))} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-text-muted">IVA</p>
            <Segmenti etichetta="IVA" valore={iva} onCambia={setIva}
              opzioni={setup.aliquote.map((a) => ({ valore: a.id, testo: `${a.percentuale}%` }))} />
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-text-muted">Nota per il reparto
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="facoltativa"
            className="h-touch rounded-md border border-border-input bg-bg px-3 text-base font-normal text-text outline-none placeholder:text-text-muted focus:border-focus" />
        </label>
        <p className="text-xs text-text-muted">Non diventa un articolo del menu: resta solo su questo conto. Le ultime voci restano qui sopra per rifarle in un tocco.</p>
      </div>
    </Foglio>
  );
}
