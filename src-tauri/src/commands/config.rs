use crate::config::AppConfig;
use std::fs;
use tauri::Manager;

/// Load config from app data directory. Returns default if file doesn't exist.
#[tauri::command]
pub fn load_config(app_handle: tauri::AppHandle) -> Result<AppConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let content =
            fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
        let config: AppConfig =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        Ok(config)
    } else {
        let default_config = AppConfig::default();
        // Write default config so it exists for next time
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
        Ok(default_config)
    }
}

/// Save config to app data directory.
#[tauri::command]
pub fn save_config(app_handle: tauri::AppHandle, config: AppConfig) -> Result<String, String> {
    // Validate
    if config.printer_ip.is_empty() {
        return Err("Printer IP cannot be empty".to_string());
    }
    if config.paper_width != 58 && config.paper_width != 80 {
        return Err("Paper width must be 58 or 80 mm".to_string());
    }
    if config.api_url.is_empty() {
        return Err("API URL cannot be empty".to_string());
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;

    let config_path = app_data_dir.join("config.json");
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok("Config saved successfully".to_string())
}
