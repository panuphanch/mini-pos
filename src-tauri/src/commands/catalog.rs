use crate::db::{customers, products};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn search_products(
    state: State<'_, AppState>,
    q: String,
    limit: Option<i64>,
) -> Result<Vec<products::ProductLite>, String> {
    products::search(&state.db, &q, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_customers(
    state: State<'_, AppState>,
    q: String,
    limit: Option<i64>,
) -> Result<Vec<customers::CustomerLite>, String> {
    customers::search(&state.db, &q, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}
