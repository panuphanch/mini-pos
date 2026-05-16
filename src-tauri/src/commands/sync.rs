use crate::config::AppConfig;
use crate::state::AppState;
use crate::sync::engine;
use crate::sync::types::{SyncMappings, SyncPreview, SyncResult};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsTabInfo {
    pub name: String,
}

#[tauri::command]
pub async fn test_sheets_connection(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<Vec<SheetsTabInfo>, String> {
    if config.spreadsheet_id.is_empty() {
        return Err("Spreadsheet ID is empty".to_string());
    }
    state.invalidate_sheets_client().await;
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    let tabs = client.list_tabs(&config.spreadsheet_id).await
        .map_err(|e| format!("Sheets API error: {}", e))?;
    Ok(tabs.into_iter().map(|name| SheetsTabInfo { name }).collect())
}

#[tauri::command]
pub async fn sync_week(
    state: State<'_, AppState>,
    config: AppConfig,
    tab: String,
) -> Result<SyncPreview, String> {
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    engine::preview_sync(&state.db, client.as_ref(), &config.spreadsheet_id, &tab).await
        .map_err(|e| format!("Sync preview failed: {}", e))
}

#[tauri::command]
pub async fn apply_sync(
    state: State<'_, AppState>,
    config: AppConfig,
    tab: String,
    mappings: SyncMappings,
) -> Result<SyncResult, String> {
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    engine::apply_sync(&state.db, client.as_ref(), &config.spreadsheet_id, &tab, mappings).await
        .map_err(|e| format!("Apply sync failed: {}", e))
}
