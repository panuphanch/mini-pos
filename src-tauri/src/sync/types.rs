use crate::sheets::parser::ParsedOrder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnknownMenu {
    pub alias: String,
    pub suggested_price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnknownCustomer {
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    pub tab: String,
    pub week_start_date: String,
    pub unknown_menus: Vec<UnknownMenu>,
    pub unknown_customers: Vec<UnknownCustomer>,
    pub parsed_orders: Vec<ParsedOrder>,
    pub will_insert: i64,
    pub will_update: i64,
    pub will_soft_delete: i64,
    pub parse_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MenuMappingChoice {
    // `rename_all` on an externally-tagged enum only renames the variant tag
    // (Existing → "existing"), NOT the inner struct-variant fields. So each
    // variant needs its own `rename_all` for camelCase field names to work
    // over the Tauri/JSON boundary.
    #[serde(rename_all = "camelCase")]
    Existing { product_id: String },
    #[serde(rename_all = "camelCase")]
    Create { name_th: String, name_en: Option<String>, selling_price: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomerMappingChoice {
    #[serde(rename_all = "camelCase")]
    Existing { customer_id: String },
    #[serde(rename_all = "camelCase")]
    Create { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMappings {
    pub menu: Vec<(String, MenuMappingChoice)>,
    pub customer: Vec<(String, CustomerMappingChoice)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub tab: String,
    pub rows_added: i64,
    pub rows_updated: i64,
    pub rows_soft_deleted: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Locks in the JSON shape the TypeScript layer relies on, so a future
    /// refactor of the Rust enum can't silently change the wire format.
    #[test]
    fn menu_mapping_create_uses_camel_case_field_names() {
        let json = serde_json::json!({
            "create": {
                "nameTh": "มัทฉะเลเยอร์",
                "nameEn": null,
                "sellingPrice": 165,
            }
        });
        let decoded: MenuMappingChoice = serde_json::from_value(json.clone()).unwrap();
        match decoded {
            MenuMappingChoice::Create { name_th, name_en, selling_price } => {
                assert_eq!(name_th, "มัทฉะเลเยอร์");
                assert_eq!(name_en, None);
                assert_eq!(selling_price, 165);
            }
            other => panic!("expected Create, got {:?}", other),
        }
        // And round-trip back to the same JSON shape.
        let encoded = serde_json::to_value(&MenuMappingChoice::Create {
            name_th: "มัทฉะเลเยอร์".into(),
            name_en: None,
            selling_price: 165,
        }).unwrap();
        assert_eq!(encoded, json);
    }

    #[test]
    fn menu_mapping_existing_uses_camel_case() {
        let json = serde_json::json!({ "existing": { "productId": "abc" } });
        let decoded: MenuMappingChoice = serde_json::from_value(json).unwrap();
        match decoded {
            MenuMappingChoice::Existing { product_id } => assert_eq!(product_id, "abc"),
            other => panic!("expected Existing, got {:?}", other),
        }
    }

    #[test]
    fn customer_mapping_uses_camel_case() {
        let json = serde_json::json!({ "existing": { "customerId": "xyz" } });
        let decoded: CustomerMappingChoice = serde_json::from_value(json).unwrap();
        match decoded {
            CustomerMappingChoice::Existing { customer_id } => assert_eq!(customer_id, "xyz"),
            other => panic!("expected Existing, got {:?}", other),
        }
    }
}
