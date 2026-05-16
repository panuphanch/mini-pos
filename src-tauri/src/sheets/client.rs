use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
pub struct ValueRange {
    #[serde(default)]
    pub values: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sheet {
    pub properties: SheetProperties,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetProperties {
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Spreadsheet {
    pub sheets: Vec<Sheet>,
}

#[async_trait]
pub trait SheetsClient: Send + Sync {
    async fn list_tabs(&self, spreadsheet_id: &str) -> Result<Vec<String>>;
    async fn get_values(&self, spreadsheet_id: &str, range: &str) -> Result<ValueRange>;
}

pub struct HttpSheetsClient {
    auth: Arc<super::auth::AuthClient>,
    http: reqwest::Client,
}

impl HttpSheetsClient {
    pub fn new(auth: Arc<super::auth::AuthClient>) -> Self {
        Self { auth, http: reqwest::Client::new() }
    }
}

#[async_trait]
impl SheetsClient for HttpSheetsClient {
    async fn list_tabs(&self, spreadsheet_id: &str) -> Result<Vec<String>> {
        let token = self.auth.access_token().await?;
        let url = format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}?fields=sheets.properties",
            urlencoding::encode(spreadsheet_id)
        );
        let res = self.http.get(&url).bearer_auth(token).send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("Sheets API {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        let s: Spreadsheet = res.json().await?;
        Ok(s.sheets.into_iter().map(|sh| sh.properties.title).collect())
    }

    async fn get_values(&self, spreadsheet_id: &str, range: &str) -> Result<ValueRange> {
        let token = self.auth.access_token().await?;
        let url = format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}",
            urlencoding::encode(spreadsheet_id),
            urlencoding::encode(range)
        );
        let res = self.http.get(&url).bearer_auth(token).send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("Sheets API {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        Ok(res.json().await?)
    }
}

/// Fake for tests: callers populate maps.
#[cfg(test)]
pub struct FakeSheetsClient {
    pub tabs: Vec<String>,
    pub values: std::collections::HashMap<String, ValueRange>,
}

#[cfg(test)]
#[async_trait]
impl SheetsClient for FakeSheetsClient {
    async fn list_tabs(&self, _spreadsheet_id: &str) -> Result<Vec<String>> {
        Ok(self.tabs.clone())
    }
    async fn get_values(&self, _spreadsheet_id: &str, range: &str) -> Result<ValueRange> {
        self.values.get(range).cloned()
            .ok_or_else(|| anyhow!("FakeSheetsClient: no fixture for range {}", range))
    }
}
