// Prova manuale della ricerca: finte stampanti su 127.0.0.x (serve Linux e i permessi per la porta 80).
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
fn main() {
    let esc = TcpListener::bind("127.0.0.7:9100").unwrap();
    thread::spawn(move || for c in esc.incoming() { let mut c = c.unwrap(); thread::spawn(move || {
        let mut b = [0u8; 3];
        while c.read_exact(&mut b).is_ok() {
            match b { [0x10, 0x04, 0x01] => { c.write_all(&[0x16]).ok(); }
                      [0x1d, 0x49, 66] => { c.write_all(b"_MATCHPOWER\0").ok(); }
                      _ => {} }
        }
    }); });
    let rt = TcpListener::bind("127.0.0.9:80").unwrap();
    thread::spawn(move || for c in rt.incoming() { let mut c = c.unwrap(); thread::spawn(move || {
        let mut b = [0u8; 512]; let n = c.read(&mut b).unwrap_or(0);
        let r = String::from_utf8_lossy(&b[..n]);
        let corpo = if r.contains("fpmate") { "ok" } else { "<html><title>EPSON FP-81 II RT</title></html>" };
        c.write_all(format!("HTTP/1.0 200 OK\r\n\r\n{corpo}").as_bytes()).ok();
    }); });
    let t0 = std::time::Instant::now();
    let (rete, v) = ponte::scoperta::cerca(Some("127.0.0")).unwrap();
    println!("rete {rete} in {:?}", t0.elapsed());
    for t in v { println!("{:?}", t); }
}
