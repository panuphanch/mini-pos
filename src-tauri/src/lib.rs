mod commands;
mod config;
mod db;
mod printer;
mod sheets;
mod state;
mod sync;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let app_data_dir = handle.path().app_data_dir()
                    .expect("resolve app_data_dir");
                std::fs::create_dir_all(&app_data_dir).ok();
                let db_path = app_data_dir.join("pos.sqlite");
                let pool = db::pool::init_pool(&db_path).await
                    .expect("init sqlite pool");
                let state = AppState::new(app_data_dir, pool).await;
                handle.manage(state);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::printer::test_printer,
            commands::printer::check_printer_status,
            commands::printer::print_receipt,
            commands::sync::test_sheets_connection,
            commands::sync::sync_week,
            commands::sync::apply_sync,
            commands::catalog::search_products,
            commands::catalog::search_customers,
            commands::orders::list_orders,
            commands::orders::get_order,
            commands::orders::print_order,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
