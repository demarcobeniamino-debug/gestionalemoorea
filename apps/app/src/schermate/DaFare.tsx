import { Link, useParams } from 'react-router-dom';

// Segnaposto delle schermate delle fasi successive, con lo scopo preso dalla mappa recon.
const SCHERMATE: Record<string, [string, string, string]> = {
  S17: ['Prenotazioni', 'Cerca e filtra le prenotazioni per data, stato e provenienza.', 'Fase 1'],
  S18: ['Planning prenotazioni', 'Tavoli per fascia oraria, con le prenotazioni trascinabili.', 'Fase 1'],
  S20: ['Clienti', 'Anagrafica con preferenze, allergie e dati per la fattura.', 'Fase 2'],
  S23: ['Chiusura giornaliera', 'Riepilogo incassi e chiusura fiscale sull’Epson.', 'Fase 1'],
  S25: ['Statistiche', 'Incassi per giorno, sala, operatore e articolo.', 'Fase 1'],
  S27: ['Articoli', 'Piatti, prezzi, IVA, allergeni e varianti.', 'Fase 1'],
  S29: ['Stampanti e reparti', 'IP delle Matchpower e dell’Epson, centri di produzione, test di stampa.', 'Fase 1'],
  S32: ['Magazzino', 'Giacenze, carichi e food cost.', 'Fase 3'],
};

export function DaFare() {
  const { id = '' } = useParams();
  const s = SCHERMATE[id];
  return (
    <main className="mx-auto max-w-xl p-8 text-text">
      <p className="mb-2 text-sm font-semibold text-text-muted">{id} · {s?.[2] ?? 'più avanti'}</p>
      <h1 className="mb-2 text-xl font-bold">{s?.[0] ?? 'Schermata in arrivo'}</h1>
      <p className="mb-6 text-base text-text-muted">{s?.[1] ?? 'Questa schermata è nella mappa ma non è ancora costruita.'}</p>
      <Link to="/sala" className="underline">Torna alla sala</Link>
    </main>
  );
}
