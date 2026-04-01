use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub printer_ip: String,
    pub paper_width: u32,
    pub api_url: String,
    pub service_username: String,
    pub service_password: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            printer_ip: "192.168.1.55".to_string(),
            paper_width: 80,
            api_url: "http://localhost:3000/api".to_string(),
            service_username: "pos-service".to_string(),
            service_password: String::new(),
        }
    }
}
