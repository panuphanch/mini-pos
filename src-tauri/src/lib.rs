mod commands;
mod config;
mod printer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::printer::print_receipt,
            commands::printer::test_printer,
            commands::printer::check_printer_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
