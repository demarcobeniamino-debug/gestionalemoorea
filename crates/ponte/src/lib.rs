//! Ponte di cassa: porta byte alle stampanti in LAN. Nessuna logica di formato qui
//! (ticket e XML li prepara il pacchetto `core` in TypeScript e sono testati là).
//!
//! Regola per il fiscale: distinguere "non è partito niente" (si può riprovare)
//! da "è partito ma la risposta non è arrivata" (INCERTO: lo scontrino potrebbe essere uscito).

pub mod scoperta;
pub mod pos;

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum Errore {
    /// Connessione o invio falliti prima che la stampante ricevesse la richiesta completa.
    NonInviato(String),
    /// Richiesta inviata per intero, risposta mancante o troncata.
    Incerto(String),
    /// Risposta arrivata ma non HTTP 200.
    Http(u16, String),
}

impl std::fmt::Display for Errore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Errore::NonInviato(m) => write!(f, "NON_INVIATO: {m}"),
            Errore::Incerto(m) => write!(f, "INCERTO: {m}"),
            Errore::Http(c, m) => write!(f, "HTTP {c}: {m}"),
        }
    }
}

fn risolvi(host: &str, porta: u16) -> Result<SocketAddr, Errore> {
    (host, porta)
        .to_socket_addrs()
        .map_err(|e| Errore::NonInviato(format!("indirizzo {host}:{porta} non valido: {e}")))?
        .next()
        .ok_or_else(|| Errore::NonInviato(format!("indirizzo {host}:{porta} non risolto")))
}

/// Invia byte grezzi (ESC/POS) a una stampante di rete, di solito porta 9100.
pub fn tcp_send(host: &str, porta: u16, dati: &[u8], timeout: Duration) -> Result<(), Errore> {
    let addr = risolvi(host, porta)?;
    let mut s = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| Errore::NonInviato(format!("{host}:{porta} non risponde ({e})")))?;
    s.set_write_timeout(Some(timeout)).ok();
    s.write_all(dati).map_err(|e| Errore::NonInviato(format!("invio interrotto: {e}")))?;
    s.flush().map_err(|e| Errore::NonInviato(format!("invio interrotto: {e}")))?;
    s.shutdown(Shutdown::Write).ok();
    Ok(())
}

pub struct Url { pub host: String, pub porta: u16, pub percorso: String }

pub fn parse_url(url: &str) -> Result<Url, Errore> {
    let resto = url.strip_prefix("http://").ok_or_else(|| Errore::NonInviato(format!("solo http:// in LAN: {url}")))?;
    let (hostporta, percorso) = match resto.find('/') { Some(i) => (&resto[..i], &resto[i..]), None => (resto, "/") };
    let (host, porta) = match hostporta.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| Errore::NonInviato(format!("porta non valida: {p}")))?),
        None => (hostporta, 80),
    };
    if host.is_empty() { return Err(Errore::NonInviato("host vuoto".into())); }
    Ok(Url { host: host.to_string(), porta, percorso: percorso.to_string() })
}

/// POST di un documento XML (Epson fpmate.cgi). Restituisce il corpo della risposta.
pub fn http_post_xml(url: &str, corpo: &str, timeout: Duration) -> Result<String, Errore> {
    let u = parse_url(url)?;
    let addr = risolvi(&u.host, u.porta)?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(3).min(timeout))
        .map_err(|e| Errore::NonInviato(format!("{}:{} non risponde ({e})", u.host, u.porta)))?;
    s.set_write_timeout(Some(timeout)).ok();
    s.set_read_timeout(Some(timeout)).ok();
    let richiesta = format!(
        "POST {} HTTP/1.0\r\nHost: {}\r\nContent-Type: text/xml; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        u.percorso, u.host, corpo.as_bytes().len(), corpo
    );
    s.write_all(richiesta.as_bytes()).map_err(|e| Errore::NonInviato(format!("invio interrotto: {e}")))?;
    s.flush().map_err(|e| Errore::NonInviato(format!("invio interrotto: {e}")))?;
    // Da qui in poi la richiesta è partita per intero: ogni problema è INCERTO.
    let mut risposta = Vec::new();
    if let Err(e) = s.read_to_end(&mut risposta) {
        if risposta.is_empty() { return Err(Errore::Incerto(format!("nessuna risposta: {e}"))); }
    }
    let testo = String::from_utf8_lossy(&risposta).to_string();
    let (testata, corpo_risp) = testo.split_once("\r\n\r\n").ok_or_else(|| Errore::Incerto("risposta troncata".into()))?;
    let codice: u16 = testata.split_whitespace().nth(1).and_then(|c| c.parse().ok()).ok_or_else(|| Errore::Incerto("risposta non HTTP".into()))?;
    let corpo_risp = if testata.to_ascii_lowercase().contains("transfer-encoding: chunked") { dechunk(corpo_risp) } else { corpo_risp.to_string() };
    if codice != 200 { return Err(Errore::Http(codice, corpo_risp.chars().take(200).collect())); }
    if !corpo_risp.contains("</response>") && !corpo_risp.contains("<response") {
        return Err(Errore::Incerto("risposta senza <response>".into()));
    }
    Ok(corpo_risp)
}

fn dechunk(s: &str) -> String {
    let mut out = String::new();
    let mut resto = s;
    while let Some((linea, dopo)) = resto.split_once("\r\n") {
        let n = usize::from_str_radix(linea.trim(), 16).unwrap_or(0);
        if n == 0 || dopo.len() < n { break; }
        out.push_str(&dopo[..n]);
        resto = dopo[n..].trim_start_matches("\r\n");
    }
    out
}

#[cfg(test)]
mod test {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn stampa_comanda_su_9100() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let h = thread::spawn(move || { let (mut c, _) = l.accept().unwrap(); let mut b = Vec::new(); c.read_to_end(&mut b).unwrap(); b });
        tcp_send("127.0.0.1", porta, &[0x1b, 0x40, b'o', b'k', 0x1d, 0x56, 0x42, 0], Duration::from_secs(2)).unwrap();
        assert_eq!(h.join().unwrap(), vec![0x1b, 0x40, b'o', b'k', 0x1d, 0x56, 0x42, 0]);
    }

    #[test]
    fn stampante_spenta_non_inviato() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        drop(l);
        let e = tcp_send("127.0.0.1", porta, b"x", Duration::from_millis(500)).unwrap_err();
        assert!(matches!(e, Errore::NonInviato(_)), "{e}");
    }

    fn epson_finto(risposta: &'static str) -> (u16, thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let h = thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            c.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
            let mut buf = vec![0u8; 65536]; let mut tot = Vec::new();
            loop { match c.read(&mut buf) { Ok(0) => break, Ok(n) => { tot.extend_from_slice(&buf[..n]); if String::from_utf8_lossy(&tot).contains("</s:Envelope>") { break; } } Err(_) => break } }
            if !risposta.is_empty() { c.write_all(risposta.as_bytes()).unwrap(); }
            String::from_utf8_lossy(&tot).to_string()
        });
        (porta, h)
    }

    #[test]
    fn scontrino_epson_ok() {
        let (porta, h) = epson_finto("HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\n<response success=\"true\" code=\"\" status=\"2\"><addInfo><fiscalReceiptNumber>12</fiscalReceiptNumber></addInfo></response>");
        let url = format!("http://127.0.0.1:{porta}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000");
        let r = http_post_xml(&url, "<s:Envelope><s:Body><printerFiscalReceipt/></s:Body></s:Envelope>", Duration::from_secs(2)).unwrap();
        assert!(r.contains("<fiscalReceiptNumber>12</fiscalReceiptNumber>"));
        let ricevuto = h.join().unwrap();
        assert!(ricevuto.starts_with("POST /cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000 HTTP/1.0"));
        assert!(ricevuto.contains("Content-Type: text/xml; charset=utf-8"));
    }

    #[test]
    fn risposta_persa_incerto() {
        let (porta, h) = epson_finto("");
        let url = format!("http://127.0.0.1:{porta}/cgi-bin/fpmate.cgi");
        let e = http_post_xml(&url, "<s:Envelope></s:Envelope>", Duration::from_millis(800)).unwrap_err();
        assert!(matches!(e, Errore::Incerto(_)), "{e}");
        h.join().unwrap();
    }

    #[test]
    fn rt_spento_non_inviato() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        drop(l);
        let e = http_post_xml(&format!("http://127.0.0.1:{porta}/x"), "x", Duration::from_millis(500)).unwrap_err();
        assert!(matches!(e, Errore::NonInviato(_)), "{e}");
    }

    #[test]
    fn url() {
        let u = parse_url("http://192.168.1.110/cgi-bin/fpmate.cgi?devid=local_printer").unwrap();
        assert_eq!((u.host.as_str(), u.porta, u.percorso.as_str()), ("192.168.1.110", 80, "/cgi-bin/fpmate.cgi?devid=local_printer"));
        assert!(parse_url("https://x").is_err());
    }
}
