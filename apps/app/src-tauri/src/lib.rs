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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![tcp_send, http_post_xml])
        .run(tauri::generate_context!())
        .expect("errore all'avvio dell'app di cassa");
}
