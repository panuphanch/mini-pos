use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TabStrategy {
    Latest,
    CurrentWeek,
    Pinned(String),
}

impl Default for TabStrategy {
    fn default() -> Self {
        TabStrategy::Latest
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub printer_ip: String,
    pub paper_width: u32,

    // Sheets
    pub spreadsheet_id: String,
    pub service_account_path: String,
    pub default_tab_strategy: TabStrategy,

    // Shop
    pub shop_name: String,
    pub shop_phone: String,
    pub shop_line: String,
    pub promptpay_type: String,    // "phone" | "id_card"
    pub promptpay_value: String,
    pub thank_you_message: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            printer_ip: "192.168.1.55".to_string(),
            paper_width: 80,
            spreadsheet_id: String::new(),
            service_account_path: "service-account.json".to_string(),
            default_tab_strategy: TabStrategy::Latest,
            shop_name: "Granny's Bakery".to_string(),
            shop_phone: String::new(),
            shop_line: String::new(),
            promptpay_type: "phone".to_string(),
            promptpay_value: String::new(),
            thank_you_message: "Thank you!".to_string(),
        }
    }
}

/// Read config.json from `app_data_dir`, or seed it with defaults. This is the
/// single load path: `AppState` calls it once at startup and holds the result
/// as the in-process source of truth. On a present-but-corrupt file we fall back
/// to defaults *without* overwriting, so the bad file stays recoverable.
pub fn load_or_init(app_data_dir: &Path) -> AppConfig {
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => match migrate_from_json(&content) {
                Ok(cfg) => {
                    // Persist normalized (drops old fields, fills new ones).
                    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
                        let _ = fs::write(&config_path, json);
                    }
                    cfg
                }
                Err(e) => {
                    eprintln!("config parse failed, using defaults (file preserved): {e}");
                    AppConfig::default()
                }
            },
            Err(e) => {
                eprintln!("config read failed, using defaults: {e}");
                AppConfig::default()
            }
        }
    } else {
        let cfg = AppConfig::default();
        let _ = fs::create_dir_all(app_data_dir);
        if let Ok(json) = serde_json::to_string_pretty(&cfg) {
            let _ = fs::write(&config_path, json);
        }
        cfg
    }
}

/// Migrate older config JSON (with apiUrl etc.) by dropping unknown fields
/// and filling defaults for missing ones. Called from `load_or_init`.
pub fn migrate_from_json(raw: &str) -> Result<AppConfig, serde_json::Error> {
    let v: serde_json::Value = serde_json::from_str(raw)?;
    let obj = v.as_object();
    let get_str = |k: &str, d: &str| -> String {
        obj.and_then(|o| o.get(k))
            .and_then(|x| x.as_str())
            .map(String::from)
            .unwrap_or_else(|| d.to_string())
    };
    let get_u32 = |k: &str, d: u32| -> u32 {
        obj.and_then(|o| o.get(k))
            .and_then(|x| x.as_u64())
            .map(|n| n as u32)
            .unwrap_or(d)
    };
    let default = AppConfig::default();
    let strategy = obj
        .and_then(|o| o.get("defaultTabStrategy"))
        .and_then(|s| serde_json::from_value::<TabStrategy>(s.clone()).ok())
        .unwrap_or_default();
    Ok(AppConfig {
        printer_ip: get_str("printerIp", &default.printer_ip),
        paper_width: get_u32("paperWidth", default.paper_width),
        spreadsheet_id: get_str("spreadsheetId", &default.spreadsheet_id),
        service_account_path: get_str("serviceAccountPath", &default.service_account_path),
        default_tab_strategy: strategy,
        shop_name: get_str("shopName", &default.shop_name),
        shop_phone: get_str("shopPhone", &default.shop_phone),
        shop_line: get_str("shopLine", &default.shop_line),
        promptpay_type: get_str("promptpayType", &default.promptpay_type),
        promptpay_value: get_str("promptpayValue", &default.promptpay_value),
        thank_you_message: get_str("thankYouMessage", &default.thank_you_message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_drops_old_api_fields_and_keeps_printer() {
        let old = r#"{
            "printerIp": "192.168.1.99",
            "paperWidth": 58,
            "apiUrl": "http://localhost:3000/api",
            "serviceUsername": "u",
            "servicePassword": "p"
        }"#;
        let cfg = migrate_from_json(old).unwrap();
        assert_eq!(cfg.printer_ip, "192.168.1.99");
        assert_eq!(cfg.paper_width, 58);
        assert_eq!(cfg.spreadsheet_id, "");
        assert_eq!(cfg.default_tab_strategy, TabStrategy::Latest);
        assert_eq!(cfg.shop_name, "Granny's Bakery");
    }

    #[test]
    fn migrate_preserves_new_fields_when_present() {
        let raw = r#"{
            "printerIp": "10.0.0.1",
            "paperWidth": 80,
            "spreadsheetId": "abc123",
            "serviceAccountPath": "service-account.json",
            "defaultTabStrategy": "currentWeek",
            "shopName": "X",
            "shopPhone": "555",
            "shopLine": "@x",
            "promptpayType": "phone",
            "promptpayValue": "0812345678",
            "thankYouMessage": "Thanks"
        }"#;
        let cfg = migrate_from_json(raw).unwrap();
        assert_eq!(cfg.spreadsheet_id, "abc123");
        assert_eq!(cfg.default_tab_strategy, TabStrategy::CurrentWeek);
        assert_eq!(cfg.shop_name, "X");
    }

    #[test]
    fn migrate_handles_pinned_tab() {
        let raw = r#"{ "defaultTabStrategy": { "pinned": "Order_30" } }"#;
        let cfg = migrate_from_json(raw).unwrap();
        assert_eq!(cfg.default_tab_strategy, TabStrategy::Pinned("Order_30".to_string()));
    }

    #[test]
    fn load_or_init_seeds_default_when_missing() {
        let dir = std::env::temp_dir().join("grannys-pos-test-cfg-missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = load_or_init(&dir);
        assert_eq!(cfg.shop_name, "Granny's Bakery");
        assert!(dir.join("config.json").exists(), "should seed config.json");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_or_init_reads_and_normalizes_existing() {
        let dir = std::env::temp_dir().join("grannys-pos-test-cfg-existing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.json"),
            r#"{ "printerIp": "10.0.0.9", "paperWidth": 58, "apiUrl": "x" }"#,
        ).unwrap();
        let cfg = load_or_init(&dir);
        assert_eq!(cfg.printer_ip, "10.0.0.9");
        assert_eq!(cfg.paper_width, 58);
        let written = std::fs::read_to_string(dir.join("config.json")).unwrap();
        assert!(!written.contains("apiUrl"), "dropped field should not survive normalize");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
