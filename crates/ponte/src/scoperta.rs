//! Ricerca delle stampanti nella rete del locale.
//!
//! Prova ogni indirizzo della rete della cassa (es. 192.168.1.1–254) su due porte:
//! - 9100: stampanti termiche ESC/POS (Matchpower, Epson TM, Xprinter…). Se risponde,
//!   chiede lo stato (DLE EOT 1) e, se è davvero ESC/POS, marca e modello (GS I 66/67).
//!   Sono comandi di sola lettura: non stampano nulla.
//! - 80: pagine web dei registratori telematici (Epson FP-81/FP-90 con fpmate.cgi, RCH…).
//!
//! Nessun driver da installare: la cassa parla direttamente con le stampanti.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum Genere {
    /// Termica non fiscale ESC/POS (risponde allo stato).
    EscPos,
    /// Porta 9100 aperta ma non ha risposto ai comandi ESC/POS (di solito è comunque una stampante).
    Porta9100,
    /// Registratore telematico Epson (fpmate.cgi).
    EpsonRt,
    /// Registratore telematico RCH.
    RchRt,
    /// Un altro dispositivo con pagina web (router, NAS, stampanti da ufficio…).
    Web,
}

#[derive(Debug, Clone)]
pub struct Trovata {
    pub ip: String,
    pub porta: u16,
    pub genere: Genere,
    pub marca: Option<String>,
    pub modello: Option<String>,
    /// Titolo o intestazione della pagina web, se c'è.
    pub dettaglio: Option<String>,
}

/// Rete /24 della cassa (es. "192.168.1"), dall'indirizzo usato per uscire verso la LAN.
/// Non invia pacchetti: "connect" su UDP sceglie solo l'interfaccia.
pub fn rete_locale() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?; // indirizzo di documentazione: non raggiunto davvero
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => {
            let o = ip.octets();
            Some(format!("{}.{}.{}", o[0], o[1], o[2]))
        }
        _ => None,
    }
}

fn parse_rete(rete: &str) -> Option<[u8; 3]> {
    // "192.168.1", "192.168.1." o "192.168.1.0": contano le prime tre parti.
    let parti: Vec<&str> = rete.trim().split('.').filter(|x| !x.is_empty()).collect();
    if parti.len() != 3 && !(parti.len() == 4 && parti[3] == "0") { return None; }
    let p: Vec<u8> = parti[..3].iter().filter_map(|x| x.parse().ok()).collect();
    if p.len() == 3 { Some([p[0], p[1], p[2]]) } else { None }
}

fn aperta(ip: Ipv4Addr, porta: u16, attesa: Duration) -> Option<TcpStream> {
    TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(ip), porta), attesa).ok()
}

/// Legge fino al byte 0 (risposte GS I) o allo scadere del tempo.
fn leggi_fino_a_zero(s: &mut TcpStream) -> Vec<u8> {
    let mut out = Vec::new();
    let mut b = [0u8; 1];
    while out.len() < 64 {
        match s.read(&mut b) {
            Ok(1) if b[0] == 0 => break,
            Ok(1) => out.push(b[0]),
            _ => break,
        }
    }
    out
}

/// Testo leggibile da una risposta GS I (che comincia con "_").
fn testo_id(v: &[u8]) -> Option<String> {
    let t: String = v.iter().skip_while(|&&c| c == b'_').filter(|c| c.is_ascii_graphic() || **c == b' ').map(|&c| c as char).collect();
    let t = t.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

fn prova_escpos(ip: Ipv4Addr, attesa: Duration) -> Option<Trovata> {
    let mut s = aperta(ip, 9100, attesa)?;
    s.set_read_timeout(Some(Duration::from_millis(700))).ok();
    s.set_write_timeout(Some(Duration::from_millis(700))).ok();
    let mut t = Trovata { ip: ip.to_string(), porta: 9100, genere: Genere::Porta9100, marca: None, modello: None, dettaglio: None };
    // DLE EOT 1: stato della stampante. Il byte di risposta ha il bit 1 e il bit 4 a 1, il 0 e il 7 a 0.
    if s.write_all(&[0x10, 0x04, 0x01]).is_err() { return Some(t); }
    let mut b = [0u8; 1];
    if matches!(s.read(&mut b), Ok(1)) && b[0] & 0x93 == 0x12 {
        t.genere = Genere::EscPos;
        // GS I 66 = marca, GS I 67 = modello (Epson e molte compatibili; le altre non rispondono).
        if s.write_all(&[0x1d, 0x49, 66]).is_ok() { t.marca = testo_id(&leggi_fino_a_zero(&mut s)); }
        if s.write_all(&[0x1d, 0x49, 67]).is_ok() { t.modello = testo_id(&leggi_fino_a_zero(&mut s)); }
    }
    Some(t)
}

fn http_get(ip: Ipv4Addr, percorso: &str, attesa: Duration) -> Option<(u16, String)> {
    let mut s = aperta(ip, 80, attesa)?;
    s.set_read_timeout(Some(Duration::from_millis(1200))).ok();
    s.set_write_timeout(Some(Duration::from_millis(800))).ok();
    let req = format!("GET {percorso} HTTP/1.0\r\nHost: {ip}\r\nConnection: close\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let mut pezzo = [0u8; 2048];
    while buf.len() < 16 * 1024 {
        match s.read(&mut pezzo) { Ok(0) | Err(_) => break, Ok(n) => buf.extend_from_slice(&pezzo[..n]) }
    }
    let testo = String::from_utf8_lossy(&buf).to_string();
    let codice = testo.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    Some((codice, testo))
}

fn titolo_html(t: &str) -> Option<String> {
    let basso = t.to_lowercase();
    let i = basso.find("<title>")? + 7;
    let f = basso[i..].find("</title>")? + i;
    let s = t[i..f].trim();
    if s.is_empty() { None } else { Some(s.chars().take(60).collect()) }
}

fn prova_web(ip: Ipv4Addr, attesa: Duration) -> Option<Trovata> {
    let (_, home) = http_get(ip, "/", attesa)?;
    let mut t = Trovata { ip: ip.to_string(), porta: 80, genere: Genere::Web, marca: None, modello: None, dettaglio: titolo_html(&home) };
    let basso = home.to_lowercase();
    // L'Epson RT espone fpmate.cgi: se il percorso esiste (non 404) è un registratore Epson.
    let fpmate = http_get(ip, "/cgi-bin/fpmate.cgi", attesa).map(|(c, _)| c != 404 && c != 0).unwrap_or(false);
    if fpmate || basso.contains("fpmate") || basso.contains("fp-81") || basso.contains("fp-90") {
        t.genere = Genere::EpsonRt;
        t.marca = Some("EPSON".into());
        for m in ["FP-81", "FP-90"] { if home.to_uppercase().contains(m) { t.modello = Some(m.into()); } }
    } else if basso.contains("rch") && (basso.contains("print!f") || basso.contains("printf") || basso.contains("cassa")) {
        t.genere = Genere::RchRt;
        t.marca = Some("RCH".into());
    } else if basso.contains("epson") {
        t.marca = Some("EPSON".into());
    }
    Some(t)
}

/// Cerca le stampanti nella rete indicata (es. "192.168.1") o in quella della cassa.
pub fn cerca(rete: Option<&str>) -> Result<(String, Vec<Trovata>), String> {
    let rete = match rete.filter(|r| !r.trim().is_empty()) {
        Some(r) => r.to_string(),
        None => rete_locale().ok_or("Non trovo la rete della cassa: è collegata al Wi‑Fi o al cavo?")?,
    };
    let base = parse_rete(&rete).ok_or_else(|| format!("Rete non valida: {rete} (scrivi per esempio 192.168.1)"))?;
    let attesa = Duration::from_millis(350);
    let (tx, rx) = mpsc::channel::<u8>();
    let rx = Arc::new(Mutex::new(rx));
    let trovate = Arc::new(Mutex::new(Vec::new()));
    for n in 1..=254u8 { tx.send(n).ok(); }
    drop(tx);
    let lavoratori: Vec<_> = (0..48).map(|_| {
        let rx = Arc::clone(&rx);
        let trovate = Arc::clone(&trovate);
        thread::spawn(move || loop {
            let n = match rx.lock().ok().and_then(|r| r.recv().ok()) { Some(n) => n, None => break };
            let ip = Ipv4Addr::new(base[0], base[1], base[2], n);
            if let Some(t) = prova_escpos(ip, attesa) { trovate.lock().unwrap().push(t); }
            if let Some(t) = prova_web(ip, attesa) { trovate.lock().unwrap().push(t); }
        })
    }).collect();
    for l in lavoratori { l.join().ok(); }
    let mut v = Arc::try_unwrap(trovate).map(|m| m.into_inner().unwrap()).unwrap_or_default();
    v.sort_by_key(|t| (t.ip.split('.').last().and_then(|x| x.parse::<u8>().ok()).unwrap_or(0), t.porta));
    Ok((format!("{}.{}.{}", base[0], base[1], base[2]), v))
}

#[cfg(test)]
mod test {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn rete_scritta_a_mano() {
        assert_eq!(parse_rete("192.168.1"), Some([192, 168, 1]));
        assert_eq!(parse_rete("192.168.1.0"), Some([192, 168, 1]));
        assert_eq!(parse_rete("10.0.0."), Some([10, 0, 0]));
        assert_eq!(parse_rete("10.0.0"), Some([10, 0, 0]));
        assert_eq!(parse_rete("192.168.1.50"), None);
        assert_eq!(parse_rete("ciao"), None);
    }

    #[test]
    fn titolo_e_id() {
        assert_eq!(titolo_html("<html><TITLE> EPSON FP-81 II </TITLE>").as_deref(), Some("EPSON FP-81 II"));
        assert_eq!(testo_id(b"_EPSON").as_deref(), Some("EPSON"));
        assert_eq!(testo_id(b"_TM-T20II").as_deref(), Some("TM-T20II"));
    }

    /// Una finta stampante ESC/POS: risponde allo stato e a marca/modello.
    #[test]
    fn riconosce_una_escpos() {
        // Usa una porta qualsiasi e chiama direttamente la logica di lettura.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = l.local_addr().unwrap().port();
        let h = thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut b = [0u8; 3];
            c.read_exact(&mut b).unwrap(); assert_eq!(b, [0x10, 0x04, 0x01]); c.write_all(&[0x16]).unwrap();
            c.read_exact(&mut b).unwrap(); assert_eq!(b, [0x1d, 0x49, 66]); c.write_all(b"_EPSON\0").unwrap();
            c.read_exact(&mut b).unwrap(); assert_eq!(b, [0x1d, 0x49, 67]); c.write_all(b"_TM-T20III\0").unwrap();
        });
        let mut s = TcpStream::connect(("127.0.0.1", porta)).unwrap();
        s.set_read_timeout(Some(Duration::from_millis(700))).unwrap();
        s.write_all(&[0x10, 0x04, 0x01]).unwrap();
        let mut b = [0u8; 1];
        s.read_exact(&mut b).unwrap();
        assert_eq!(b[0] & 0x93, 0x12);
        s.write_all(&[0x1d, 0x49, 66]).unwrap();
        assert_eq!(testo_id(&leggi_fino_a_zero(&mut s)).as_deref(), Some("EPSON"));
        s.write_all(&[0x1d, 0x49, 67]).unwrap();
        assert_eq!(testo_id(&leggi_fino_a_zero(&mut s)).as_deref(), Some("TM-T20III"));
        h.join().unwrap();
    }
}
