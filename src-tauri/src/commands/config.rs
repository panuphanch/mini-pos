use crate::config::AppConfig;
use crate::state::AppState;
use std::fs;
use tauri::State;

#[tauri::command]
pub async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config().await)
}

#[tauri::command]
pub async fn save_config(state: State<'_, AppState>, config: AppConfig) -> Result<String, String> {
    if config.printer_ip.is_empty() {
        return Err("Printer IP cannot be empty".to_string());
    }
    if config.paper_width != 58 && config.paper_width != 80 {
        return Err("Paper width must be 58 or 80 mm".to_string());
    }
    // spreadsheet_id may be empty until the user fills it in Settings.

    fs::create_dir_all(&state.app_data_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    let config_path = state.app_data_dir.join("config.json");
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    state.set_config(config).await;
    Ok("Config saved successfully".to_string())
}
