use std::time::Duration;

/// ESC/POS verso una stampante comande (Matchpower: cucina, bar, preconto).
#[tauri::command]
async fn tcp_send(host: String, port: u16, data: Vec<u8>, timeout_ms: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ponte::tcp_send(&host, port, &data, Duration::from_millis(timeout_ms)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("NON_INVIATO: {e}"))?
}

/// XML fiscale verso l'Epson RT. Gli errori iniziano con NON_INVIATO, INCERTO o HTTP:
/// l'interfaccia tratta INCERTO come "scontrino da verificare" e non riprova da sola.
#[tauri::command]
async fn http_post_xml(url: String, body: String, timeout_ms: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ponte::http_post_xml(&url, &body, Duration::from_millis(timeout_ms)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("INCERTO: {e}"))?
}

#[derive(serde::Serialize)]
struct Trovata { ip: String, porta: u16, genere: &'static str, marca: Option<String>, modello: Option<String>, dettaglio: Option<String> }

#[derive(serde::Serialize)]
struct EsitoRicerca { rete: String, trovate: Vec<Trovata> }

/// Cerca le stampanti nella rete del locale (porta 9100 ESC/POS e pagine web dei registratori).
#[tauri::command]
async fn cerca_stampanti(rete: Option<String>) -> Result<EsitoRicerca, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rete, v) = ponte::scoperta::cerca(rete.as_deref())?;
        Ok(EsitoRicerca {
            rete,
            trovate: v.into_iter().map(|t| Trovata {
                genere: match t.genere {
                    ponte::scoperta::Genere::EscPos => "escpos",
                    ponte::scoperta::Genere::Porta9100 => "porta9100",
                    ponte::scoperta::Genere::EpsonRt => "epson_rt",
                    ponte::scoperta::Genere::RchRt => "rch_rt",
                    ponte::scoperta::Genere::Web => "web",
                },
                ip: t.ip, porta: t.porta, marca: t.marca, modello: t.modello, dettaglio: t.dettaglio,
            }).collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Aggiornamenti automatici (solo Mac e Windows): l'app chiede prima di installare.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .invoke_handler(tauri::generate_handler![tcp_send, http_post_xml, cerca_stampanti])
        .run(tauri::generate_context!())
        .expect("errore all'avvio dell'app di cassa");
}
