// Ruoli: chi può fare cosa. Modulo piccolo, così sala e cassa non caricano tutta la Gestione.
export const puoGestire = (ruolo?: string) => ruolo === 'responsabile' || ruolo === 'admin';
