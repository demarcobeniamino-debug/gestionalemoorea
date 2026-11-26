// Stampanti: ricerca automatica in rete, riconoscimento del modello (il "driver"),
// reparti, set di caratteri e stampe di prova.
import { useState } from 'react';
import { CheckCircle, MagnifyingGlass, Plus, Printer, Receipt, WifiHigh } from '@phosphor-icons/react';
import {
  CODE_PAGE, anteprima, byteProvaCaratteri, profiloDa, renderEscPos, soloStampanti, ticketProva, urlFpMate, xmlStampaNonFiscale,
  type Profilo, type StampanteRiga, type Tabelle, type Trovata,
} from '@gr/core';
import { useApp } from '../../dati/contesto';
import { cercaStampanti, cercaStampantiDemo, creaTrasporto, inTauri } from '../../dati/trasporto';
import { Foglio, Pulsante, Spinner, useConferma } from '../../ui/primitivi';
import { CampoNumero, Interruttore, Segmenti, Seleziona, Testo } from '../../ui/campi';
import { Sezione, useSalva, useTabelle } from './Layout';

const I = { size: 18, weight: 'bold' as const, 'aria-hidden': true };
const CARTE = [{ valore: '48', testo: '80 mm' }, { valore: '42', testo: '76 mm' }, { valore: '32', testo: '58 mm' }];
const ipValido = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
const etichettaTipo = (s: Pick<StampanteRiga, 'tipo' | 'per_preconto'>) =>
  s.tipo === 'comande_escpos' ? (s.per_preconto ? 'Comande e preconti' : 'Comande') : 'Registratore telematico';
const reparti = (t: Tabelle, id: string) => t.centri_produzione.filter((c) => c.stampante_id === id).map((c) => c.nome);

/** Stampe di prova: dalla cassa escono davvero; nella demo finiscono nella carta simulata. */
function useProva() {
  const { modalita, simulato, toast } = useApp();
  const possibile = inTauri() || modalita === 'demo';
  const prova = async (s: StampanteRiga, cosa: 'normale' | 'caratteri', t: Tabelle) => {
    const trasporto = simulato ?? creaTrasporto().trasporto;
    try {
      if (s.tipo === 'comande_escpos') {
        const dati = cosa === 'caratteri' ? byteProvaCaratteri(s.colonne)
          : renderEscPos(ticketProva({ nome: s.nome, host: s.host, porta: s.porta, colonne: s.colonne, reparti: reparti(t, s.id) }), { colonne: s.colonne, codePage: s.codepage });
        await trasporto.inviaTcp(s.host, s.porta, dati, 5000);
      } else if (s.tipo === 'rt_epson_xml') {
        await trasporto.postXml(urlFpMate({ host: s.host }), xmlStampaNonFiscale(['PROVA STAMPA (non fiscale)', s.nome, `${s.host}`, new Date().toLocaleString('it-IT')]), 10000);
      } else throw new Error('Questo registratore non è ancora gestito dalla cassa.');
      toast({ tipo: 'ok', testo: modalita === 'demo' && !inTauri() ? `Demo: prova inviata a ${s.nome}` : `Prova inviata a ${s.nome}: controlla la carta` });
    } catch (e) {
      toast({ tipo: 'errore', testo: `${s.nome} non risponde (${s.host}): è accesa e nella stessa rete? ${(e as Error).message}` });
    }
  };
  return { possibile, prova };
}

export function Stampanti() {
  const t = useTabelle();
  const { modalita } = useApp();
  const { archivio, esegui } = useSalva();
  const { possibile, prova } = useProva();
  const [ricerca, setRicerca] = useState<'ferma' | 'cerca' | { rete: string; trovate: Trovata[] } | { errore: string }>('ferma');
  const [rete, setRete] = useState('');
  const [altraRete, setAltraRete] = useState(false);
  const [editor, setEditor] = useState<StampanteRiga | Partial<StampanteRiga> | null>(null);
  const [provando, setProvando] = useState<string | null>(null);
  const puoCercare = inTauri() || modalita === 'demo';

  const cerca = async () => {
    setRicerca('cerca');
    try { setRicerca(inTauri() ? await cercaStampanti(rete.trim() || undefined) : await cercaStampantiDemo()); }
    catch (e) { setRicerca({ errore: String((e as Error)?.message ?? e) }); }
  };
  const comande = t.stampanti.filter((s) => s.tipo === 'comande_escpos');
  const lista = [...t.stampanti].sort((a, b) => Number(a.tipo !== 'comande_escpos') - Number(b.tipo !== 'comande_escpos') || a.nome.localeCompare(b.nome));

  return (
    <Sezione titolo="Stampanti" sotto="Comande in cucina e al bar, preconti e registratore telematico"
      azioni={<>
        <Pulsante taglia="md" icona={<Plus {...I} />} onClick={() => setEditor({ tipo: 'comande_escpos', porta: 9100, colonne: 48, codepage: 19, attiva: true, per_preconto: false })}>Aggiungi a mano</Pulsante>
        <Pulsante variante="primario" taglia="md" icona={ricerca === 'cerca' ? undefined : <MagnifyingGlass {...I} />} caricamento={ricerca === 'cerca'}
          disabled={!puoCercare} onClick={() => void cerca()}>Cerca in rete</Pulsante>
      </>}>

      {!puoCercare && (
        <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
          La ricerca in rete e le stampe di prova si fanno dalla <strong className="text-text">cassa installata</strong>: il browser non può vedere le stampanti del locale.
          Da qui puoi comunque cambiare nomi, indirizzi e reparti.
        </p>
      )}

      {ricerca !== 'ferma' && (
        <Ricerca stato={ricerca} t={t} rete={rete} setRete={setRete} altraRete={altraRete} setAltraRete={setAltraRete}
          onCerca={() => void cerca()} onChiudi={() => setRicerca('ferma')}
          onUsa={(x, p, s) => void esegui(async () => {
            if (s) await archivio.salva('stampanti', { id: s.id, host: x.ip, porta: p.porta, modello: p.modello, ...(s.tipo === p.tipo ? {} : { tipo: p.tipo }) });
            else setEditor({ tipo: p.tipo, host: x.ip, porta: p.porta, colonne: p.colonne, codepage: p.codePage, modello: p.modello, attiva: true, per_preconto: false, matricola_rt: p.tipo === 'comande_escpos' ? null : '' });
          }, s ? `${s.nome} ora usa ${x.ip}` : undefined)} />
      )}

      <ul className="mb-8 grid gap-3 md:grid-cols-2">
        {lista.map((s) => {
          const rep = reparti(t, s.id);
          return (
            <li key={s.id} className={`flex flex-col rounded-lg border border-border bg-surface ${s.attiva ? '' : 'opacity-60'}`}>
              <button type="button" onClick={() => setEditor(s)} className="flex flex-1 items-start gap-3 rounded-t-lg p-4 text-left transition-colors duration-fast hover:bg-surface-2">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-md bg-surface-2 text-text-muted">{s.tipo === 'comande_escpos' ? <Printer size={22} weight="bold" aria-hidden="true" /> : <Receipt size={22} weight="bold" aria-hidden="true" />}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-semibold">{s.nome}{!s.attiva && ' · spenta'}</span>
                  <span className="text-sm text-text-muted">{etichettaTipo(s)}{rep.length ? ` · ${rep.join(', ')}` : ''}</span>
                  <span className="mt-1 font-mono text-sm tabular-nums">{s.host}:{s.porta}</span>
                  {s.modello && <span className="text-xs text-text-muted">{s.modello}</span>}
                </span>
              </button>
              <div className="flex gap-2 border-t border-border px-4 py-2">
                <Pulsante taglia="md" variante="fantasma" className="-ml-2" disabled={!possibile || !s.attiva || provando === s.id}
                  caricamento={provando === s.id}
                  onClick={async () => { setProvando(s.id); await prova(s, 'normale', t); setProvando(null); }}>Stampa di prova</Pulsante>
              </div>
            </li>
          );
        })}
      </ul>

      <h3 className="mb-1 text-lg font-semibold">Dove escono le comande</h3>
      <p className="mb-3 text-sm text-text-muted">Ogni reparto stampa sulla sua stampante. I piatti vanno nel reparto della loro categoria.</p>
      <div className="mb-8 divide-y divide-border rounded-lg border border-border bg-surface">
        {t.centri_produzione.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_minmax(0,14rem)] items-center gap-3 px-4 py-3">
            <span className="font-semibold">{c.nome}</span>
            <select aria-label={`Stampante del reparto ${c.nome}`} value={c.stampante_id ?? ''}
              onChange={(e) => void esegui(() => archivio.salva('centri_produzione', { id: c.id, stampante_id: e.target.value || null }), `${c.nome} aggiornato`)}
              className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none focus:border-focus">
              <option value="">Non stampa</option>
              {comande.map((s) => <option key={s.id} value={s.id}>{s.nome} · {s.host}</option>)}
            </select>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_minmax(0,14rem)] items-center gap-3 px-4 py-3">
          <span className="font-semibold">Preconti</span>
          <select aria-label="Stampante dei preconti" value={comande.find((s) => s.per_preconto)?.id ?? ''}
            onChange={(e) => void esegui(async () => {
              for (const s of comande) if (s.per_preconto !== (s.id === e.target.value)) await archivio.salva('stampanti', { id: s.id, per_preconto: s.id === e.target.value });
            }, 'Stampante dei preconti aggiornata')}
            className="h-touch rounded-md border border-border-input bg-bg px-3 text-base text-text outline-none focus:border-focus">
            <option value="">Nessuna</option>
            {comande.map((s) => <option key={s.id} value={s.id}>{s.nome} · {s.host}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border px-4 py-3 text-sm text-text-muted">
        <p className="mb-1 font-semibold text-text">Driver</p>
        Non serve installare driver su Windows o sul Mac: la cassa parla direttamente con le stampanti in rete (ESC/POS sulla porta 9100
        per le termiche, XML per l’Epson RT). La ricerca riconosce il tipo e imposta da sola protocollo, porta e carta.
        Se gli accenti escono sbagliati, apri la stampante e usa “Prova caratteri”.
      </div>

      {editor && <EditorStampante key={(editor as StampanteRiga).id ?? 'nuova'} iniziale={editor} onChiudi={() => setEditor(null)} />}
    </Sezione>
  );
}

function Ricerca({ stato, t, rete, setRete, altraRete, setAltraRete, onCerca, onChiudi, onUsa }: {
  stato: 'cerca' | { rete: string; trovate: Trovata[] } | { errore: string }; t: Tabelle;
  rete: string; setRete: (r: string) => void; altraRete: boolean; setAltraRete: (v: boolean) => void;
  onCerca: () => void; onChiudi: () => void; onUsa: (x: Trovata, p: Profilo, s: StampanteRiga | null) => void;
}) {
  const altri = typeof stato === 'object' && 'trovate' in stato ? stato.trovate.length - soloStampanti(stato.trovate).length : 0;
  return (
    <section aria-label="Risultati della ricerca" aria-live="polite" className="mb-6 rounded-lg border border-accent bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <WifiHigh size={20} weight="bold" aria-hidden="true" className="text-accent" />
        <h3 className="flex-1 text-base font-semibold">
          {stato === 'cerca' ? 'Cerco le stampanti nella rete del locale…'
            : 'errore' in stato ? 'Ricerca non riuscita'
            : `Rete ${stato.rete}.x · ${soloStampanti(stato.trovate).length} stampanti trovate`}
        </h3>
        {stato !== 'cerca' && <button type="button" onClick={onChiudi} className="premibile h-9 rounded-md px-3 text-sm font-semibold text-text-muted hover:bg-surface-2">Chiudi</button>}
      </div>

      {stato === 'cerca' ? (
        <div className="flex items-center gap-3 text-sm text-text-muted"><Spinner />Provo tutti gli indirizzi: ci vogliono circa 10 secondi.</div>
      ) : 'errore' in stato ? (
        <p className="text-sm text-danger">{stato.errore}</p>
      ) : !soloStampanti(stato.trovate).length ? (
        <p className="text-sm text-text-muted">Nessuna stampante risponde. Controlla che siano accese e collegate allo stesso router della cassa, poi riprova.</p>
      ) : (
        <ul className="divide-y divide-border">
          {soloStampanti(stato.trovate).map((x) => {
            const p = profiloDa(x)!;
            const gia = t.stampanti.find((s) => s.host === x.ip && s.porta === p.porta);
            const compatibili = t.stampanti.filter((s) => (p.tipo === 'comande_escpos') === (s.tipo === 'comande_escpos'));
            return (
              <li key={`${x.ip}:${x.porta}`} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{p.descrizione}</span>
                  <span className="font-mono text-sm tabular-nums text-text-muted">{x.ip}:{p.porta}</span>
                </span>
                {gia ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-success"><CheckCircle size={18} weight="fill" aria-hidden="true" />È “{gia.nome}”</span>
                ) : !p.supportata ? (
                  <span className="text-sm text-text-muted">Non ancora gestita</span>
                ) : (
                  <select aria-label={`Usa ${x.ip} come`} value="" onChange={(e) => {
                    const v = e.target.value; if (!v) return;
                    onUsa(x, p, v === 'nuova' ? null : t.stampanti.find((s) => s.id === v) ?? null);
                  }} className="h-touch rounded-md border border-accent bg-bg px-3 text-base font-semibold text-accent outline-none focus:border-focus">
                    <option value="">Usa come…</option>
                    {compatibili.map((s) => <option key={s.id} value={s.id}>{s.nome} (ora {s.host})</option>)}
                    <option value="nuova">Nuova stampante…</option>
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {stato !== 'cerca' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
          {altri > 0 && <span className="mr-auto text-text-muted">Altri {altri} dispositivi in rete (router, computer…) non sono stampanti.</span>}
          {altraRete ? (
            <>
              <Testo etichetta="Rete da cercare" value={rete} onChange={(e) => setRete(e.target.value)} placeholder="192.168.1" className="w-44" />
              <Pulsante taglia="md" onClick={onCerca}>Cerca</Pulsante>
            </>
          ) : (
            <button type="button" onClick={() => setAltraRete(true)} className="premibile h-9 rounded-md px-2 font-semibold text-text-muted underline-offset-2 hover:underline">Cerca in un’altra rete</button>
          )}
        </div>
      )}
    </section>
  );
}

function EditorStampante({ iniziale, onChiudi }: { iniziale: StampanteRiga | Partial<StampanteRiga>; onChiudi: () => void }) {
  const t = useTabelle();
  const { archivio, esegui, inCorso } = useSalva();
  const { chiedi, ui } = useConferma();
  const { possibile, prova } = useProva();
  const esistente = 'id' in iniziale && iniziale.id ? (iniziale as StampanteRiga) : null;
  const [nome, setNome] = useState(iniziale.nome ?? '');
  const [tipo, setTipo] = useState<'comande_escpos' | 'rt_epson_xml'>(iniziale.tipo === 'rt_epson_xml' ? 'rt_epson_xml' : 'comande_escpos');
  const [host, setHost] = useState(iniziale.host ?? '');
  const [porta, setPorta] = useState<number | null>(iniziale.porta ?? 9100);
  const [colonne, setColonne] = useState(String(iniziale.colonne ?? 48));
  const [codepage, setCodepage] = useState(String(iniziale.codepage ?? 19));
  const [matricola, setMatricola] = useState(iniziale.matricola_rt ?? '');
  const [attiva, setAttiva] = useState(iniziale.attiva ?? true);
  const [errIp, setErrIp] = useState<string | null>(null);
  const [inProva, setInProva] = useState<string | null>(null);

  const bozza = (): StampanteRiga => ({
    id: esistente?.id ?? 'bozza', locale_id: t.locale.id, nome: nome.trim() || 'Stampante', tipo, host: host.trim(), porta: porta ?? (tipo === 'comande_escpos' ? 9100 : 80),
    colonne: Number(colonne) as 32 | 42 | 48, codepage: Number(codepage), matricola_rt: tipo === 'comande_escpos' ? null : matricola.trim(),
    per_preconto: iniziale.per_preconto ?? false, attiva, modello: iniziale.modello ?? null,
  });
  const anteprimaRighe = anteprima(ticketProva({ nome: nome || 'Stampante', host: host || '—', porta: porta ?? 9100, colonne: Number(colonne), reparti: esistente ? reparti(t, esistente.id) : [] }), Number(colonne));

  const salva = () => esegui(async () => {
    if (!nome.trim()) throw new Error('Dai un nome alla stampante (es. Cucina).');
    if (!ipValido(host.trim())) { setErrIp('Scrivi un indirizzo come 192.168.1.50'); throw new Error('Indirizzo non valido.'); }
    const { id: _, ...dati } = bozza();
    await archivio.salva('stampanti', { ...(esistente ? { id: esistente.id } : {}), ...dati });
    onChiudi();
  }, esistente ? 'Stampante aggiornata' : 'Stampante aggiunta');

  const provaCon = async (cosa: 'normale' | 'caratteri') => {
    if (!ipValido(host.trim())) { setErrIp('Scrivi un indirizzo come 192.168.1.50'); return; }
    setInProva(cosa); await prova(bozza(), cosa, t); setInProva(null);
  };

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={esistente ? esistente.nome : 'Nuova stampante'} piede={<>
      {esistente && <Pulsante variante="fantasma" taglia="md" onClick={() => chiedi(`Eliminare “${esistente.nome}”? I reparti che la usano non stamperanno più finché non scegli un’altra stampante.`,
        () => void esegui(async () => { await archivio.elimina('stampanti', { id: esistente.id }); onChiudi(); }, 'Stampante eliminata'), 'Elimina')}>Elimina</Pulsante>}
      <span className="flex-1" />
      <Pulsante taglia="md" onClick={onChiudi}>Annulla</Pulsante>
      <Pulsante variante="primario" taglia="md" caricamento={inCorso} onClick={() => void salva()}>Salva</Pulsante>
    </>}>
      <div className="flex flex-col gap-4">
        {iniziale.modello && <p className="-mt-1 text-sm text-text-muted">Riconosciuta: <strong className="text-text">{iniziale.modello}</strong></p>}
        <Testo etichetta="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Cucina, Bar, Preconto, Cassa RT" autoFocus={!esistente} />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-muted">Tipo</p>
          <Segmenti etichetta="Tipo" valore={tipo} onCambia={(v) => { setTipo(v); setPorta(v === 'comande_escpos' ? 9100 : 80); }}
            opzioni={[{ valore: 'comande_escpos', testo: 'Comande (non fiscale)' }, { valore: 'rt_epson_xml', testo: 'Registratore Epson RT' }]} />
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Testo etichetta="Indirizzo IP" value={host} onChange={(e) => { setHost(e.target.value); setErrIp(null); }} errore={errIp} inputMode="decimal" placeholder="192.168.1.50" className="font-mono" />
          <CampoNumero etichetta="Porta" valore={porta} onCambia={setPorta} min={1} />
        </div>
        {tipo === 'comande_escpos' ? (
          <>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-text-muted">Larghezza carta</p>
              <Segmenti etichetta="Larghezza carta" valore={colonne} opzioni={CARTE} onCambia={setColonne} />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Seleziona etichetta="Set di caratteri" value={codepage} onChange={(e) => setCodepage(e.target.value)}
                opzioni={CODE_PAGE.map((c, i) => ({ valore: String(c.n), testo: `${String.fromCharCode(65 + i)}) ${c.nome}` }))} />
              <Pulsante taglia="md" disabled={!possibile} caricamento={inProva === 'caratteri'} onClick={() => void provaCon('caratteri')}>Prova caratteri</Pulsante>
            </div>
            <p className="-mt-2 text-xs text-text-muted">“Prova caratteri” stampa la stessa riga con le lettere A, B, C, D: scegli qui la lettera che esce con gli accenti giusti.</p>
          </>
        ) : (
          <Testo etichetta="Matricola del registratore" value={matricola} onChange={(e) => setMatricola(e.target.value)} placeholder="Es. 99MEY012345" aiuto="Sull’etichetta dell’RT o sullo scontrino. Serve per annulli e resi." />
        )}
        <Interruttore etichetta="Attiva" descrizione="Se la spegni, i lavori per questa stampante restano in coda." attivo={attiva} onCambia={setAttiva} />

        {tipo === 'comande_escpos' && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-text-muted">Anteprima della prova</p>
            <div className="overflow-x-auto rounded-md bg-carta px-3 py-3 font-mono text-[12px] leading-[1.35] text-inchiostro">
              {anteprimaRighe.map((r, i) => <div key={i} className={`whitespace-pre ${r.stile.grassetto || r.stile.grande ? 'font-bold' : ''} ${r.stile.allinea === 'centro' ? 'text-center' : ''}`}>{r.testo || ' '}</div>)}
            </div>
          </div>
        )}
        <Pulsante taglia="md" disabled={!possibile} caricamento={inProva === 'normale'} onClick={() => void provaCon('normale')}>
          {tipo === 'comande_escpos' ? 'Stampa di prova' : 'Prova non fiscale'}
        </Pulsante>
      </div>
      {ui}
    </Foglio>
  );
}
