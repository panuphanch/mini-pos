use crate::config::AppConfig;
use crate::sheets::auth::AuthClient;
use crate::sheets::client::{HttpSheetsClient, SheetsClient};
use anyhow::Result;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub db: SqlitePool,
    pub app_data_dir: PathBuf,
    sheets: RwLock<Option<Arc<dyn SheetsClient>>>,
}

impl AppState {
    pub async fn new(app_data_dir: PathBuf, db: SqlitePool) -> Self {
        Self { db, app_data_dir, sheets: RwLock::new(None) }
    }

    /// Build (or rebuild) a SheetsClient for the given service-account path.
    pub async fn ensure_sheets_client(&self, cfg: &AppConfig) -> Result<Arc<dyn SheetsClient>> {
        let mut guard = self.sheets.write().await;
        if let Some(c) = guard.as_ref() {
            return Ok(c.clone());
        }
        let sa_path = self.app_data_dir.join(&cfg.service_account_path);
        let auth = Arc::new(AuthClient::from_file(&sa_path)?);
        let client: Arc<dyn SheetsClient> = Arc::new(HttpSheetsClient::new(auth));
        *guard = Some(client.clone());
        Ok(client)
    }

    pub async fn invalidate_sheets_client(&self) {
        *self.sheets.write().await = None;
    }
}
