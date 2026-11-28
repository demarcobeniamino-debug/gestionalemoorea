//! POS bancari in LAN con il "Protocollo 17" (ECR17), lo standard italiano per mandare l'importo al POS.
//! La cassa apre la connessione, manda la richiesta incorniciata (STX … ETX LRC, preparata in TypeScript),
//! il POS conferma (ACK), il cliente paga, il POS manda l'esito sulla stessa connessione e la cassa conferma.
//! Regola: se la richiesta è partita e l'esito non arriva, è INCERTO (il cliente potrebbe aver pagato).

use crate::Errore;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const STX: u8 = 0x02;
const ETX: u8 = 0x03;
const SOH: u8 = 0x01;
const EOT: u8 = 0x04;
const ACK: u8 = 0x06;
const NAK: u8 = 0x15;

/// Scambio completo: richiesta → ACK → (messaggi di avanzamento ignorati) → esito → ACK della cassa.
/// Restituisce il messaggio applicativo dell'esito (senza STX/ETX/LRC).
pub fn scambio(host: &str, porta: u16, richiesta: &[u8], conferma: &[u8], attesa: Duration) -> Result<Vec<u8>, Errore> {
    let addr = (host, porta)
        .to_socket_addrs()
        .map_err(|e| Errore::NonInviato(format!("indirizzo {host}:{porta} non valido: {e}")))?
        .next()
        .ok_or_else(|| Errore::NonInviato(format!("indirizzo {host}:{porta} non risolto")))?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| Errore::NonInviato(format!("il POS {host}:{porta} non risponde ({e})")))?;
    s.set_write_timeout(Some(Duration::from_secs(5))).ok();
    s.set_read_timeout(Some(Duration::from_millis(500))).ok();
    s.write_all(richiesta).map_err(|e| Errore::NonInviato(format!("invio al POS interrotto: {e}")))?;
    s.flush().ok();

    let fine = Instant::now() + attesa;
    let mut buf: Vec<u8> = Vec::new();
    let mut confermato = false;
    let mut pezzo = [0u8; 512];
    loop {
        // Consuma tutto quello che si riconosce nel buffer.
        loop {
            match buf.first() {
                None => break,
                Some(&ACK) if buf.len() >= 3 => { confermato = true; buf.drain(..3); }
                Some(&NAK) if buf.len() >= 3 => {
                    return Err(if confermato { Errore::Incerto("il POS ha rifiutato la conferma".into()) } else { Errore::NonInviato("NAK: il POS ha rifiutato la richiesta".into()) });
                }
                Some(&SOH) => match buf.iter().position(|&b| b == EOT) { Some(i) => { buf.drain(..=i); } None => break },
                Some(&STX) => match buf.iter().position(|&b| b == ETX) {
                    Some(i) if buf.len() > i + 1 => {
                        let msg = buf[1..i].to_vec();
                        let _ = s.write_all(conferma);
                        let _ = s.flush();
                        return Ok(msg);
                    }
                    _ => break,
                },
                Some(&ACK) | Some(&NAK) => break, // aspetta gli altri due byte
                Some(_) => { buf.remove(0); }
            }
        }
        if Instant::now() >= fine {
            return Err(if confermato { Errore::Incerto("nessun esito dal POS nel tempo previsto".into()) } else { Errore::NonInviato("il POS non ha confermato la richiesta".into()) });
        }
        match s.read(&mut pezzo) {
            Ok(0) => return Err(if confermato { Errore::Incerto("il POS ha chiuso la connessione prima dell'esito".into()) } else { Errore::NonInviato("il POS ha chiuso la connessione".into()) }),
            Ok(n) => buf.extend_from_slice(&pezzo[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(if confermato { Errore::Incerto(format!("connessione con il POS persa: {e}")) } else { Errore::NonInviato(format!("connessione con il POS persa: {e}")) }),
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn pagamento_con_avanzamento_e_esito() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let srv = thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut b = [0u8; 256];
            let n = c.read(&mut b).unwrap();
            assert_eq!(b[0], STX);
            c.write_all(&[ACK, ETX, 0x7A]).unwrap();
            c.write_all(&[SOH]).unwrap(); c.write_all(b"INSERIRE CARTA      ").unwrap(); c.write_all(&[EOT]).unwrap();
            c.write_all(&[STX]).unwrap(); c.write_all(b"311974030E00").unwrap(); c.write_all(&[ETX, 0x11]).unwrap();
            let mut a = [0u8; 3];
            c.read_exact(&mut a).unwrap();
            assert_eq!(a, [ACK, ETX, 0x7A]);
            n
        });
        let r = scambio("127.0.0.1", porta, &[STX, b'X', ETX, 0], &[ACK, ETX, 0x7A], Duration::from_secs(5)).unwrap();
        assert_eq!(r, b"311974030E00");
        assert!(srv.join().unwrap() > 0);
    }

    #[test]
    fn senza_esito_dopo_ack_e_incerto() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let srv = thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut b = [0u8; 64];
            let _ = c.read(&mut b);
            c.write_all(&[ACK, ETX, 0x7A]).unwrap();
            thread::sleep(Duration::from_millis(1500));
        });
        let e = scambio("127.0.0.1", porta, &[STX, b'X', ETX, 0], &[ACK, ETX, 0x7A], Duration::from_millis(800)).unwrap_err();
        assert!(matches!(e, Errore::Incerto(_)));
        srv.join().unwrap();
    }

    #[test]
    fn nak_prima_dell_ack_non_e_partito() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let srv = thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut b = [0u8; 64];
            let _ = c.read(&mut b);
            c.write_all(&[NAK, ETX, 0x69]).unwrap();
        });
        let e = scambio("127.0.0.1", porta, &[STX, b'X', ETX, 0], &[ACK, ETX, 0x7A], Duration::from_secs(2)).unwrap_err();
        assert!(matches!(e, Errore::NonInviato(_)));
        srv.join().unwrap();
    }
}
