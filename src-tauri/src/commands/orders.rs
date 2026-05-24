use crate::config::AppConfig;
use crate::db::{customers, orders, products};
use crate::printer::network;
use crate::printer::receipt::{build_receipt, PrinterConfig, ReceiptData, ReceiptItem};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderListRow {
    pub id: String,
    pub order_number: String,
    pub customer_name: String,
    pub channel: Option<String>,
    pub delivery_location: Option<String>,
    pub total_amount: i64,
    pub source_tab: Option<String>,
    pub source_row: Option<i64>,
    pub printed_at: Option<String>,
    pub print_count: i64,
    pub deleted_at: Option<String>,
    pub order_date: String,
    pub notes: Option<String>,
    pub items_summary: String,
    pub sync_locked: bool,
    pub merged_into_id: Option<String>,
    pub merged_into_order_number: Option<String>,
    pub merged_from_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDetailItem {
    pub product_id: String,
    pub name_th: String,
    pub quantity: i64,
    pub unit_price: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDetail {
    pub id: String,
    pub order_number: String,
    pub customer_name: String,
    pub channel: Option<String>,
    pub delivery_location: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub total_amount: i64,
    pub discount: i64,
    pub delivery_fee: i64,
    pub order_date: String,
    pub source_tab: Option<String>,
    pub source_row: Option<i64>,
    pub printed_at: Option<String>,
    pub print_count: i64,
    pub deleted_at: Option<String>,
    pub sync_locked: bool,
    pub merged_into_id: Option<String>,
    pub merged_into_order_number: Option<String>,
    pub merged_from_count: i64,
    pub items: Vec<OrderDetailItem>,
}

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
) -> Result<Vec<OrderListRow>, String> {
    let rows = orders::list_by_tab(
        &state.db, tab.as_deref(), include_deleted.unwrap_or(false), limit.unwrap_or(200),
    ).await.map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let cust = customers::get_by_id(&state.db, &r.customer_id).await
            .map_err(|e| e.to_string())?
            .map(|c| c.name).unwrap_or_else(|| "(unknown)".into());
        let items = sqlx::query_as::<_, (String, i64)>(
            r#"SELECT p.name_th, oi.quantity FROM order_item oi
               JOIN product p ON p.id = oi.product_id
               WHERE oi.order_id = ? ORDER BY oi.id"#,
        ).bind(&r.id).fetch_all(&state.db).await.map_err(|e| e.to_string())?;
        let items_summary = items.iter()
            .map(|(n, q)| format!("{}×{}", n, q))
            .collect::<Vec<_>>().join(" ");
        let merged_from_count: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM "order" WHERE merged_into_id = ?"#,
        ).bind(&r.id).fetch_one(&state.db).await.map_err(|e| e.to_string())?;
        let merged_into_order_number: Option<String> = if let Some(ref mid) = r.merged_into_id {
            let row: Option<(String,)> = sqlx::query_as(
                r#"SELECT order_number FROM "order" WHERE id = ?"#,
            ).bind(mid).fetch_optional(&state.db).await.map_err(|e| e.to_string())?;
            row.map(|t| t.0)
        } else { None };
        out.push(OrderListRow {
            id: r.id, order_number: r.order_number, customer_name: cust,
            channel: r.channel, delivery_location: r.delivery_location,
            total_amount: r.total_amount,
            source_tab: r.source_tab, source_row: r.source_row,
            printed_at: r.printed_at, print_count: r.print_count,
            deleted_at: r.deleted_at, order_date: r.order_date,
            notes: r.notes, items_summary,
            sync_locked: r.sync_locked != 0,
            merged_into_id: r.merged_into_id,
            merged_into_order_number,
            merged_from_count: merged_from_count.0,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_order(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<OrderDetail>, String> {
    let Some((r, items)) = orders::get_with_items(&state.db, &id).await
        .map_err(|e| e.to_string())? else { return Ok(None); };
    let cust = customers::get_by_id(&state.db, &r.customer_id).await
        .map_err(|e| e.to_string())?
        .map(|c| c.name).unwrap_or_else(|| "(unknown)".into());
    let mut detail_items = Vec::with_capacity(items.len());
    for it in items {
        let p = products::get_by_id(&state.db, &it.product_id).await
            .map_err(|e| e.to_string())?;
        detail_items.push(OrderDetailItem {
            product_id: it.product_id.clone(),
            name_th: p.map(|p| p.name_th).unwrap_or_else(|| "(deleted product)".into()),
            quantity: it.quantity, unit_price: it.unit_price,
        });
    }
    let merged_from_count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM "order" WHERE merged_into_id = ?"#,
    ).bind(&r.id).fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    let merged_into_order_number: Option<String> = if let Some(ref mid) = r.merged_into_id {
        let row: Option<(String,)> = sqlx::query_as(
            r#"SELECT order_number FROM "order" WHERE id = ?"#,
        ).bind(mid).fetch_optional(&state.db).await.map_err(|e| e.to_string())?;
        row.map(|t| t.0)
    } else { None };
    Ok(Some(OrderDetail {
        id: r.id, order_number: r.order_number, customer_name: cust,
        channel: r.channel, delivery_location: r.delivery_location,
        notes: r.notes, status: r.status, total_amount: r.total_amount,
        discount: r.discount, delivery_fee: r.delivery_fee,
        order_date: r.order_date, source_tab: r.source_tab, source_row: r.source_row,
        printed_at: r.printed_at, print_count: r.print_count,
        deleted_at: r.deleted_at, sync_locked: r.sync_locked != 0,
        merged_into_id: r.merged_into_id,
        merged_into_order_number,
        merged_from_count: merged_from_count.0,
        items: detail_items,
    }))
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
    config: AppConfig,
    id: String,
) -> Result<String, String> {
    let Some((order, items)) = orders::get_with_items(&state.db, &id).await
        .map_err(|e| e.to_string())? else {
        return Err(format!("Order {} not found", id));
    };
    let cust_name = customers::get_by_id(&state.db, &order.customer_id).await
        .map_err(|e| e.to_string())?
        .map(|c| c.name).unwrap_or_else(|| "(unknown)".into());

    let mut receipt_items = Vec::with_capacity(items.len());
    for it in items {
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
    let printer = PrinterConfig {
        ip: config.printer_ip.clone(),
        paper_width: config.paper_width,
        shop_name: config.shop_name.clone(),
        shop_phone: config.shop_phone.clone(),
        shop_line: config.shop_line.clone(),
        qr_text: "Scan to Pay".to_string(),
        qr_code_type: config.promptpay_type.clone(),
        qr_code_value: config.promptpay_value.clone(),
        thank_you_message: config.thank_you_message.clone(),
    };
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
