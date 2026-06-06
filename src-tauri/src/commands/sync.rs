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

// Per-tab ignore lists: let the cashier hide a bad menu column header or a
// garbage/duplicate order row so it never syncs. `ignore = false` undoes it.

#[tauri::command]
pub async fn ignore_sync_menu(
    state: State<'_, AppState>,
    tab: String,
    alias: String,
    ignore: bool,
) -> Result<(), String> {
    let r = if ignore {
        crate::db::sync_ignore::ignore_menu(&state.db, &tab, &alias).await
    } else {
        crate::db::sync_ignore::unignore_menu(&state.db, &tab, &alias).await
    };
    r.map_err(|e| format!("Ignore menu failed: {}", e))
}

#[tauri::command]
pub async fn ignore_sync_row(
    state: State<'_, AppState>,
    tab: String,
    source_row: i64,
    ignore: bool,
) -> Result<(), String> {
    let r = if ignore {
        crate::db::sync_ignore::ignore_row(&state.db, &tab, source_row).await
    } else {
        crate::db::sync_ignore::unignore_row(&state.db, &tab, source_row).await
    };
    r.map_err(|e| format!("Ignore row failed: {}", e))
}
