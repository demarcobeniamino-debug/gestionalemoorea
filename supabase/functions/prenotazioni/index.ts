// Sincronizzazione con Moorea Table Flow (Lovable).
// Chiamata dalla cassa/palmari ogni minuto con l'utente collegato (JWT): le regole di accesso del
// database restano quelle del locale. Fa due cose:
//   1. legge da Table Flow le prenotazioni cambiate dopo l'ultimo cursore e le importa;
//   2. invia a Table Flow gli stati decisi in cassa (seduto, comanda presa, completata, no-show).
// Segreti: GESTIONALE_SYNC_SECRET (lo stesso impostato su Lovable), TABLE_FLOW_URL (facoltativo).
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = (Deno.env.get('TABLE_FLOW_URL') ?? 'https://bookings.mooreafoodclub.it').replace(/\/$/, '');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ errore: 'Usa POST' }, 405);

  const segreto = Deno.env.get('GESTIONALE_SYNC_SECRET');
  if (!segreto) return json({ errore: 'NON_CONFIGURATO', messaggio: 'Manca la chiave del collegamento con Table Flow.' }, 503);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: locale, error: eLoc } = await sb.from('locali').select('id').limit(1).maybeSingle();
  if (eLoc || !locale) return json({ errore: 'NON_AUTORIZZATO' }, 403);

  const auth = { Authorization: `Bearer ${segreto}` };
  const esito = { importate: 0, inviate: 0, errori: [] as string[] };

  // ---- 1. Table Flow → cassa
  const { data: integ } = await sb.from('integrazioni').select('id, config').eq('locale_id', locale.id).eq('tipo', 'table_flow').maybeSingle();
  let cursore: string | null = (integ?.config as { cursore?: string } | null)?.cursore ?? null;
  try {
    for (let giro = 0; giro < 10; giro++) {
      const url = `${BASE}/api/public/gestionale/prenotazioni${cursore ? `?dopo=${encodeURIComponent(cursore)}` : ''}`;
      const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Table Flow ha risposto ${r.status}${r.status === 401 ? ' (chiave diversa da quella su Lovable)' : r.status === 503 ? ' (chiave non ancora impostata su Lovable)' : ''}`);
      const d = (await r.json()) as { prenotazioni: unknown[]; cursore: string | null; altre: boolean };
      if (d.prenotazioni.length) {
        const { data: n, error } = await sb.rpc('importa_prenotazioni', { p_locale: locale.id, p_righe: d.prenotazioni });
        if (error) throw new Error(`importazione: ${error.message}`);
        esito.importate += Number(n ?? 0);
      }
      cursore = d.cursore ?? cursore;
      if (!d.altre) break;
    }
    const config = { ...((integ?.config as object) ?? {}), cursore };
    if (integ) await sb.from('integrazioni').update({ config, ultimo_sync_at: new Date().toISOString() }).eq('id', integ.id);
    else await sb.from('integrazioni').insert({ locale_id: locale.id, tipo: 'table_flow', config, ultimo_sync_at: new Date().toISOString() });
  } catch (e) {
    esito.errori.push(`lettura: ${(e as Error).message}`);
  }

  // ---- 2. cassa → Table Flow
  const { data: uscite, error: eUsc } = await sb.rpc('prendi_uscite', { p_locale: locale.id, p_max: 50 });
  if (eUsc) esito.errori.push(`coda: ${eUsc.message}`);
  for (const u of (uscite ?? []) as { id: string; ext_id: string; azione: string }[]) {
    try {
      const r = await fetch(`${BASE}/api/public/gestionale/stato`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.ext_id, azione: u.azione }),
        signal: AbortSignal.timeout(15000),
      });
      // 404: la prenotazione non c'è più su Table Flow; inutile riprovare.
      if (r.ok || r.status === 404) {
        await sb.from('prenotazioni_uscita').update({ inviata_at: new Date().toISOString(), errore: r.ok ? null : 'non trovata su Table Flow' }).eq('id', u.id);
        esito.inviate += 1;
      } else {
        await sb.from('prenotazioni_uscita').update({ errore: `HTTP ${r.status}`, presa_at: null }).eq('id', u.id);
      }
    } catch (e) {
      await sb.from('prenotazioni_uscita').update({ errore: (e as Error).message, presa_at: null }).eq('id', u.id);
    }
  }

  return json(esito, esito.errori.length ? 207 : 200);
});
