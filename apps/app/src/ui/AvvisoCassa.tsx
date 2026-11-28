// Fascia d'avviso sotto la testata: nessuna cassa accesa (le comande non escono), stampe rimaste in coda,
// problemi del registratore. Compare su ogni schermata, perché chi prende la comanda deve saperlo subito.
import { Link } from 'react-router-dom';
import { Clock, Plugs, Warning, WifiSlash } from '@phosphor-icons/react';
import { avvisiRt, ponteVivo } from '@gr/core';
import { rifiutatiNoti } from '../dati/rifiutati';
import { useApp, useDati, useOra } from '../dati/contesto';
import { puoGestire } from '../dati/ruoli';

const ora = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function AvvisoCassa() {
  const { modalita, stampaDaQui, operatore, offline } = useApp();
  const adesso = useOra(10_000);
  const { ponti, sospesi } = useDati((d) => ({ ponti: d.ponti(), sospesi: d.lavori().filter((j) => j.stato === 'sospeso').length }));
  const vivi = ponti.filter((p) => ponteVivo(p, adesso.getTime()));
  const capo = puoGestire(operatore?.ruolo) || operatore?.ruolo === 'cassiere';

  if (offline) {
    return (
      <div role="status" className="flex flex-none items-center gap-3 bg-warning px-4 py-2.5 text-sm font-semibold text-on-warning">
        <WifiSlash size={20} weight="bold" aria-hidden className="flex-none" />
        <span className="flex-1">
          Senza internet: la cassa lavora da sola (comande, stampe, conti e scontrini). I telefoni restano fermi finché torna la linea; poi la cassa rimanda tutto da sola.
          {offline.messaggio ? <span className="block font-normal">{offline.messaggio}</span> : null}
        </span>
      </div>
    );
  }

  if (modalita === 'locale' && !stampaDaQui && vivi.length === 0) {
    const ultimo = [...ponti].sort((a, b) => b.vistoAt.localeCompare(a.vistoAt))[0];
    return (
      <div role="alert" className="flex flex-none items-center gap-3 bg-danger px-4 py-2.5 text-sm font-semibold text-on-danger">
        <Plugs size={20} weight="bold" aria-hidden className="flex-none" />
        <span className="flex-1">
          Nessuna cassa accesa: comande e scontrini restano in attesa e non escono. Accendi il computer della cassa e apri l’app Cassa.
          {ultimo ? <span className="font-normal opacity-90"> Ultimo segnale: {ora(ultimo.vistoAt)}.</span> : null}
        </span>
      </div>
    );
  }

  if (sospesi > 0) {
    return (
      <div role="status" className="flex flex-none items-center gap-3 bg-warning px-4 py-2.5 text-sm font-semibold text-on-warning">
        <Clock size={20} weight="bold" aria-hidden className="flex-none" />
        <span className="flex-1">{sospesi === 1 ? '1 stampa è rimasta' : `${sospesi} stampe sono rimaste`} in coda mentre nessuna cassa stampava: non escono da sole.</span>
        {capo ? <Link to="/cassa?scheda=invii" className="premibile flex-none rounded-md bg-on-warning px-3 py-1.5 text-warning">Decidi</Link>
          : <span className="flex-none font-normal">Avvisa il responsabile.</span>}
      </div>
    );
  }

  // Problemi gravi del registratore (letti dalla cassa negli ultimi 15 minuti): carta, Z da fare, offline.
  const rt = vivi.find((p) => p.statoRt && p.statoRtAt && adesso.getTime() - new Date(p.statoRtAt).getTime() < 15 * 60_000)?.statoRt;
  const grave = rt ? avvisiRt(rt, adesso, rifiutatiNoti(rt)).find((a) => a.livello === 'errore') : undefined;
  if (grave && capo) {
    return (
      <div role="status" className="flex flex-none items-center gap-3 bg-warning px-4 py-2 text-sm font-semibold text-on-warning">
        <Warning size={20} weight="fill" aria-hidden className="flex-none" />
        <span className="flex-1">Registratore: {grave.testo}</span>
        <Link to="/cassa?scheda=invii" className="premibile flex-none rounded-md bg-on-warning px-3 py-1.5 text-warning">Dettagli</Link>
      </div>
    );
  }
  return null;
}
