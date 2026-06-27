use crate::db::{customers, orders, products};
use crate::printer::network;
use crate::printer::receipt::{build_receipt, PrinterConfig, ReceiptData, ReceiptItem};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderEditItem {
    pub product_id: String,
    pub quantity: i64,
    pub unit_price: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderEditPayload {
    pub items: Vec<OrderEditItem>,
    pub discount: i64,
    pub delivery_fee: i64,
}

#[tauri::command]
pub async fn list_orders(
    state: State<'_, AppState>,
    tab: Option<String>,
    include_deleted: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<orders::OrderListRow>, String> {
    orders::list_view(
        &state.db, tab.as_deref(), include_deleted.unwrap_or(false), limit.unwrap_or(200),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_order(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<orders::OrderDetail>, String> {
    orders::get_view(&state.db, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_order(
    state: State<'_, AppState>,
    id: String,
    payload: OrderEditPayload,
) -> Result<(), String> {
    let items: Vec<orders::EditOrderItem> = payload.items.into_iter().map(|it| {
        orders::EditOrderItem {
            product_id: it.product_id, quantity: it.quantity, unit_price: it.unit_price,
        }
    }).collect();
    orders::apply_order_edit(&state.db, &id, &items, payload.discount, payload.delivery_fee)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn print_order(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let config = state.config().await;
    let Some((order, items)) = orders::get_with_items(&state.db, &id).await
        .map_err(|e| e.to_string())? else {
        return Err(format!("Order {} not found", id));
    };
    let cust_name = customers::get_by_id(&state.db, &order.customer_id).await
        .map_err(|e| e.to_string())?
        .map(|c| c.name).unwrap_or_else(|| "(unknown)".into());

    // Collapse identical products (same product + unit price) into one receipt
    // line with summed quantity. A merged order keeps one order_item row per
    // source sheet row, so the same product can appear several times; the
    // receipt should print "Carrot Cake×4", not four "Carrot Cake×1". Raw rows
    // stay untouched in the DB for sync/edit.
    let aggregated = orders::aggregate_items(&items);
    let mut receipt_items = Vec::with_capacity(aggregated.len());
    for it in aggregated {
        let p = products::get_by_id(&state.db, &it.product_id).await
            .map_err(|e| e.to_string())?;
        let name = p.map(|p| p.name_th).unwrap_or_else(|| "(deleted)".into());
        receipt_items.push(ReceiptItem {
            name, quantity: it.quantity as f64, price: it.unit_price as f64,
        });
    }

    let receipt = ReceiptData {
        customer_name: cust_name,
        items: receipt_items,
        discount_type: "none".into(),
        discount: order.discount as f64,
        delivery_fee: order.delivery_fee as f64,
    };
    let printer = PrinterConfig::from(&config);
    let bytes = build_receipt(&receipt, &printer)
        .map_err(|e| format!("Build receipt: {}", e))?;
    network::send_to_printer(&printer.ip, &bytes)
        .map_err(|e| format!("Print: {}", e))?;
    orders::mark_printed(&state.db, &id).await.map_err(|e| e.to_string())?;
    Ok("Printed".into())
}

#[tauri::command]
pub async fn delete_order(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    orders::delete_order(&state.db, &id).await.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub master_order_id: String,
    pub master_order_number: String,
    pub merged_count: usize,
}

#[tauri::command]
pub async fn merge_orders(
    state: State<'_, AppState>,
    order_ids: Vec<String>,
) -> Result<MergeResult, String> {
    let out = orders::merge_orders(&state.db, &order_ids).await.map_err(|e| e.to_string())?;
    Ok(MergeResult {
        master_order_id: out.master_order_id,
        master_order_number: out.master_order_number,
        merged_count: out.merged_count,
    })
}
