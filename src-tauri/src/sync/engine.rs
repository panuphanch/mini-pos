use crate::db::{customers, orders, products};
use crate::sheets::client::SheetsClient;
use crate::sheets::parser::parse_tab;
use crate::sheets::week::parse_tab_week_start;
use crate::sync::types::*;
use anyhow::{anyhow, Result};
use chrono::Datelike;
use sqlx::SqlitePool;
use std::collections::HashMap;

pub async fn preview_sync(
    pool: &SqlitePool,
    sheets: &dyn SheetsClient,
    spreadsheet_id: &str,
    tab: &str,
) -> Result<SyncPreview> {
    let range = format!("{}!A1:Z200", tab);
    let vr = sheets.get_values(spreadsheet_id, &range).await?;
    let parsed = parse_tab(&vr).map_err(|e| anyhow!(e.to_string()))?;

    let week_start = parse_tab_week_start(tab, chrono::Utc::now().year())
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| chrono::Utc::now().date_naive().format("%Y-%m-%d").to_string());

    // Reconcile menu aliases.
    //
    // Two surfaces hold menu names in a tab:
    //   1. Top menu table (column A) — has prices.
    //   2. Order table column headers — what each order row's items actually reference.
    //
    // In practice the wife sometimes shortens the column header (e.g. top menu says
    // "เค้กโคตรเผือกมะพร้าว", header says "เค้กโคตรเผือก") because the column is narrow.
    // We must surface BOTH so the user can map them — possibly to the same canonical
    // product. The price suggestion for column-header-only names defaults to whatever
    // we can find in the top menu by exact match, else 0.
    let price_by_top_name: std::collections::HashMap<String, i64> =
        parsed.menu.iter().map(|m| (m.menu_name.clone(), m.price)).collect();

    let mut menu_alias_candidates: Vec<(String, i64)> = Vec::new();
    let mut seen_menu_alias = std::collections::HashSet::new();
    // Top menu first (so the suggested prices are predictable in the UI).
    for m in &parsed.menu {
        if seen_menu_alias.insert(m.menu_name.clone()) {
            menu_alias_candidates.push((m.menu_name.clone(), m.price));
        }
    }
    // Then column-header names from order items.
    for o in &parsed.orders {
        for it in &o.items {
            if seen_menu_alias.insert(it.menu_name.clone()) {
                let price = price_by_top_name.get(&it.menu_name).copied().unwrap_or(0);
                menu_alias_candidates.push((it.menu_name.clone(), price));
            }
        }
    }

    let mut unknown_menus: Vec<UnknownMenu> = Vec::new();
    for (alias, price) in menu_alias_candidates {
        if products::find_by_alias(pool, &alias).await?.is_none() {
            unknown_menus.push(UnknownMenu { alias, suggested_price: price });
        }
    }

    // Reconcile customer aliases — unique set.
    let mut seen = std::collections::HashSet::new();
    let mut unknown_customers: Vec<UnknownCustomer> = Vec::new();
    for o in &parsed.orders {
        if seen.insert(o.customer.clone()) {
            if customers::find_by_alias(pool, &o.customer).await?.is_none() {
                unknown_customers.push(UnknownCustomer { alias: o.customer.clone() });
            }
        }
    }

    // Count insert/update/soft-delete.
    // Existing rows includes merged-away donors. We treat them as "exists"
    // so the preview counters categorize sheet edits to them as updates,
    // not inserts.
    let existing: Vec<(i64,)> = sqlx::query_as(
        r#"SELECT source_row FROM "order"
           WHERE source_tab = ?
             AND (deleted_at IS NULL OR merged_into_id IS NOT NULL)"#,
    )
    .bind(tab).fetch_all(pool).await?;
    let existing_rows: std::collections::HashSet<i64> = existing.into_iter().map(|t| t.0).collect();
    let parsed_rows: std::collections::HashSet<i64> = parsed.orders.iter().map(|o| o.source_row).collect();

    let will_insert = parsed_rows.difference(&existing_rows).count() as i64;
    let will_update = parsed_rows.intersection(&existing_rows).count() as i64;
    let will_soft_delete = existing_rows.difference(&parsed_rows).count() as i64;

    Ok(SyncPreview {
        tab: tab.to_string(),
        week_start_date: week_start,
        unknown_menus,
        unknown_customers,
        parsed_orders: parsed.orders,
        will_insert, will_update, will_soft_delete,
        parse_errors: parsed.parse_errors,
    })
}

pub async fn apply_sync(
    pool: &SqlitePool,
    sheets: &dyn SheetsClient,
    spreadsheet_id: &str,
    tab: &str,
    mappings: SyncMappings,
) -> Result<SyncResult> {
    // Re-fetch + re-parse (fresh state).
    let preview = preview_sync(pool, sheets, spreadsheet_id, tab).await?;

    // 1) Apply menu mappings outside the row-loop transaction so search/find see them.
    // Within a single sync the parser can surface the same canonical menu under
    // two different unknown aliases (top-menu list + a shortened order column
    // header). If the user fills both rows with identical "Create new" details
    // we want one product, not two — otherwise future catalog edits diverge.
    let mut menu_alias_to_product: HashMap<String, String> = HashMap::new();
    let mut created_menu_by_payload: HashMap<(String, Option<String>, i64), String> = HashMap::new();
    for (alias, choice) in mappings.menu {
        let pid = match choice {
            MenuMappingChoice::Existing { product_id } => product_id,
            MenuMappingChoice::Create { name_th, name_en, selling_price } => {
                let key = (name_th.clone(), name_en.clone(), selling_price);
                if let Some(existing) = created_menu_by_payload.get(&key) {
                    existing.clone()
                } else {
                    let new_id = products::create(pool, &name_th, name_en.as_deref(), selling_price).await?.id;
                    created_menu_by_payload.insert(key, new_id.clone());
                    new_id
                }
            }
        };
        products::upsert_alias(pool, &alias, &pid).await?;
        menu_alias_to_product.insert(alias, pid);
    }
    // Aliases already in DB
    for m in &preview.parsed_orders {
        for it in &m.items {
            if !menu_alias_to_product.contains_key(&it.menu_name) {
                if let Some(p) = products::find_by_alias(pool, &it.menu_name).await? {
                    menu_alias_to_product.insert(it.menu_name.clone(), p.id);
                }
            }
        }
    }
    // Each item's unit_price comes from the canonical product the alias resolves to.
    // We used to cross-reference the top-menu table here, but that only worked when
    // the column-header text exactly matched a top-menu entry — and in practice the
    // wife sometimes shortens column headers. The product the user just created (or
    // picked) already carries the right selling_price.

    let mut customer_alias_to_id: HashMap<String, String> = HashMap::new();
    for (alias, choice) in mappings.customer {
        let cid = match choice {
            CustomerMappingChoice::Existing { customer_id } => customer_id,
            CustomerMappingChoice::Create { name } => customers::create(pool, &name).await?.id,
        };
        customers::upsert_alias(pool, &alias, &cid).await?;
        customer_alias_to_id.insert(alias, cid);
    }
    for o in &preview.parsed_orders {
        if !customer_alias_to_id.contains_key(&o.customer) {
            if let Some(c) = customers::find_by_alias(pool, &o.customer).await? {
                customer_alias_to_id.insert(o.customer.clone(), c.id);
            }
        }
    }

    // 2) Verify all unknowns are resolved — fail fast otherwise.
    for um in &preview.unknown_menus {
        if !menu_alias_to_product.contains_key(&um.alias) {
            return Err(anyhow!("Menu alias unresolved: {}", um.alias));
        }
    }
    for uc in &preview.unknown_customers {
        if !customer_alias_to_id.contains_key(&uc.alias) {
            return Err(anyhow!("Customer alias unresolved: {}", uc.alias));
        }
    }

    // 3) Pre-fetch each resolved product's selling_price BEFORE opening the
    // transaction. Doing the lookup inside the tx would re-use the pool's
    // connection budget and deadlock in single-connection setups (notably the
    // in-memory test pool).
    let mut product_price_by_id: HashMap<String, i64> = HashMap::new();
    for pid in menu_alias_to_product.values() {
        if product_price_by_id.contains_key(pid) { continue; }
        let product = products::get_by_id(pool, pid).await?
            .ok_or_else(|| anyhow!("Product {} not found", pid))?;
        product_price_by_id.insert(pid.clone(), product.selling_price);
    }

    // 4) Upsert orders in one transaction.
    let mut tx = pool.begin().await?;
    let mut added = 0i64;
    let mut updated = 0i64;
    let mut keep_rows: Vec<i64> = Vec::new();
    let mut masters_to_recompute: std::collections::HashSet<String> = std::collections::HashSet::new();

    for ord in &preview.parsed_orders {
        let cust_id = customer_alias_to_id.get(&ord.customer)
            .ok_or_else(|| anyhow!("Unresolved customer {}", ord.customer))?.clone();

        let mut total: i64 = 0;
        // Collect owned product_ids so lifetimes work for UpsertOrderItemInput<'_>.
        let mut item_data: Vec<(String, i64, i64)> = Vec::new();
        for item in &ord.items {
            let pid = menu_alias_to_product.get(&item.menu_name)
                .ok_or_else(|| anyhow!("Unresolved menu {}", item.menu_name))?
                .clone();
            let unit = *product_price_by_id.get(&pid).unwrap_or(&0);
            total += unit * item.quantity;
            item_data.push((pid, item.quantity, unit));
        }

        // Pull-through path: if this row was merged into another order, refresh
        // the master's items tagged with this row's source_row instead of doing
        // the normal upsert (which would resurrect the donor's order shell).
        let donor_master: Option<String> = sqlx::query_as::<_, (Option<String>,)>(
            r#"SELECT merged_into_id FROM "order" WHERE source_tab = ? AND source_row = ?"#,
        )
        .bind(tab).bind(ord.source_row)
        .fetch_optional(&mut *tx).await?
        .and_then(|(m,)| m);

        if let Some(master_id) = donor_master {
            sqlx::query(
                r#"DELETE FROM order_item WHERE order_id = ? AND source_row = ?"#,
            )
            .bind(&master_id).bind(ord.source_row).execute(&mut *tx).await?;
            for (pid, qty, unit) in &item_data {
                sqlx::query(
                    r#"INSERT INTO order_item
                       (id, order_id, product_id, quantity, unit_price, source_row)
                       VALUES (?, ?, ?, ?, ?, ?)"#,
                )
                .bind(crate::db::ids::new_id())
                .bind(&master_id).bind(pid).bind(qty).bind(unit).bind(ord.source_row)
                .execute(&mut *tx).await?;
            }
            masters_to_recompute.insert(master_id);
            keep_rows.push(ord.source_row);
            updated += 1;
            continue;
        }

        let items: Vec<orders::UpsertOrderItemInput<'_>> = item_data.iter().map(|(pid, qty, unit)| {
            orders::UpsertOrderItemInput {
                product_id: pid.as_str(),
                quantity: *qty,
                unit_price: *unit,
            }
        }).collect();

        let out = orders::upsert_from_source(&mut tx, orders::UpsertOrderInput {
            customer_id: &cust_id,
            channel: ord.channel.as_deref(),
            delivery_location: ord.delivery_location.as_deref(),
            notes: ord.notes.as_deref(),
            total_amount: total,
            order_date: &preview.week_start_date,
            source_tab: tab,
            source_row: ord.source_row,
            items,
        }).await?;
        if out.was_insert { added += 1; } else { updated += 1; }
        keep_rows.push(ord.source_row);
    }
    let soft_deleted = orders::soft_delete_missing_rows(&mut tx, tab, &keep_rows).await?;

    // If a donor row vanished from the sheet, its items must vanish from the
    // master too. soft_delete_missing_rows skips merged-away rows, so we
    // detect them here and strip their items.
    let stale_donors: Vec<(String, i64)> = sqlx::query_as(
        r#"SELECT merged_into_id, source_row FROM "order"
           WHERE source_tab = ?
             AND merged_into_id IS NOT NULL
             AND source_row IS NOT NULL"#,
    ).bind(tab).fetch_all(&mut *tx).await?;
    for (master_id, row) in stale_donors {
        if !keep_rows.contains(&row) {
            sqlx::query(
                r#"DELETE FROM order_item WHERE order_id = ? AND source_row = ?"#,
            )
            .bind(&master_id).bind(row).execute(&mut *tx).await?;
            masters_to_recompute.insert(master_id);
        }
    }

    // Recompute totals for any master that changed.
    for master_id in &masters_to_recompute {
        let row: (i64, i64, i64) = sqlx::query_as(
            r#"SELECT
                 COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS subtotal,
                 o.discount, o.delivery_fee
               FROM "order" o
               LEFT JOIN order_item oi ON oi.order_id = o.id
               WHERE o.id = ?
               GROUP BY o.id"#,
        ).bind(master_id).fetch_one(&mut *tx).await?;
        let new_total = (row.0 - row.1 + row.2).max(0);
        sqlx::query(
            r#"UPDATE "order" SET total_amount = ?, updated_at = ? WHERE id = ?"#,
        ).bind(new_total).bind(crate::db::ids::now_iso()).bind(master_id)
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;

    orders::upsert_week_mapping(pool, tab, &preview.week_start_date).await?;
    orders::insert_sync_log(pool, tab, added, updated, soft_deleted, "success", None).await?;

    Ok(SyncResult {
        tab: tab.to_string(),
        rows_added: added,
        rows_updated: updated,
        rows_soft_deleted: soft_deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::init_memory_pool;
    use crate::sheets::client::{FakeSheetsClient, ValueRange};
    use std::collections::HashMap;

    fn make_vr(rows: Vec<Vec<&str>>) -> ValueRange {
        ValueRange {
            values: rows.into_iter()
                .map(|r| r.into_iter().map(String::from).collect()).collect(),
        }
    }

    fn fixture_tab() -> ValueRange {
        make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "10", "5", "100"],
            vec!["B", "", "10", "5", "200"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "B", "สถานที่ส่ง", "Note"],
            vec!["Page", "Cust1", "1", "2", "Home", "Packed"],
            vec!["Page", "Cust2", "", "1", "Office", ""],
        ])
    }

    fn fake_with(tab: &str, vr: ValueRange) -> FakeSheetsClient {
        let mut values = HashMap::new();
        values.insert(format!("{}!A1:Z200", tab), vr.clone());
        values.insert(format!("{}!A1:E50", tab), vr);
        FakeSheetsClient { tabs: vec![tab.to_string()], values }
    }

    #[tokio::test]
    async fn first_sync_with_mappings_inserts_orders() {
        let pool = init_memory_pool().await.unwrap();
        let fake = fake_with("Order_20", fixture_tab());
        let preview = preview_sync(&pool, &fake, "ss", "Order_20").await.unwrap();
        assert_eq!(preview.unknown_menus.len(), 2);
        assert_eq!(preview.unknown_customers.len(), 2);
        assert_eq!(preview.will_insert, 2);

        let mappings = SyncMappings {
            menu: preview.unknown_menus.iter().map(|m| (
                m.alias.clone(),
                MenuMappingChoice::Create {
                    name_th: m.alias.clone(), name_en: None, selling_price: m.suggested_price,
                },
            )).collect(),
            customer: preview.unknown_customers.iter().map(|c| (
                c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias.clone() },
            )).collect(),
        };
        let res = apply_sync(&pool, &fake, "ss", "Order_20", mappings).await.unwrap();
        assert_eq!(res.rows_added, 2);
        assert_eq!(res.rows_updated, 0);

        let all = crate::db::orders::list_by_tab(&pool, Some("Order_20"), false, 100).await.unwrap();
        assert_eq!(all.len(), 2);
        // total = 1*100 + 2*200 = 500
        let cust1 = all.iter().find(|o| o.order_number.ends_with("-1")).unwrap();
        assert_eq!(cust1.total_amount, 500);
    }

    #[tokio::test]
    async fn second_sync_with_changed_qty_updates_in_place() {
        let pool = init_memory_pool().await.unwrap();
        let mut fake = fake_with("Order_20", fixture_tab());

        // First sync, create everything.
        let p1 = preview_sync(&pool, &fake, "ss", "Order_20").await.unwrap();
        let m1 = SyncMappings {
            menu: p1.unknown_menus.into_iter().map(|m| (
                m.alias.clone(),
                MenuMappingChoice::Create {
                    name_th: m.alias, name_en: None, selling_price: m.suggested_price,
                },
            )).collect(),
            customer: p1.unknown_customers.into_iter().map(|c| (
                c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias },
            )).collect(),
        };
        apply_sync(&pool, &fake, "ss", "Order_20", m1).await.unwrap();

        // Now mutate the fixture: Cust1's qty for A goes from 1 to 5.
        let changed = make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "10", "5", "100"],
            vec!["B", "", "10", "5", "200"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "B", "สถานที่ส่ง", "Note"],
            vec!["Page", "Cust1", "5", "2", "Home", "Packed"],
            vec!["Page", "Cust2", "", "1", "Office", ""],
        ]);
        fake.values.insert("Order_20!A1:Z200".into(), changed.clone());
        fake.values.insert("Order_20!A1:E50".into(), changed);

        let p2 = preview_sync(&pool, &fake, "ss", "Order_20").await.unwrap();
        assert_eq!(p2.unknown_menus.len(), 0);
        assert_eq!(p2.unknown_customers.len(), 0);
        assert_eq!(p2.will_insert, 0);
        assert_eq!(p2.will_update, 2);

        let res = apply_sync(&pool, &fake, "ss", "Order_20",
            SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();
        assert_eq!(res.rows_added, 0);
        assert_eq!(res.rows_updated, 2);

        let rows = crate::db::orders::list_by_tab(&pool, Some("Order_20"), false, 100).await.unwrap();
        let cust1 = rows.iter().find(|o| o.order_number.ends_with("-1")).unwrap();
        assert_eq!(cust1.total_amount, 5 * 100 + 2 * 200);
    }

    #[tokio::test]
    async fn top_menu_and_column_header_names_can_differ() {
        // Real-world case from the screenshot: the wife shortens column headers
        // because they're narrow. Top table = "FullName", header = "Short".
        // Both must be surfaced as unknowns, and both must be mappable.
        let pool = init_memory_pool().await.unwrap();
        let vr = make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["FullName", "", "10", "5", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "Short", "สถานที่ส่ง", "Note"],
            vec!["Page", "C1", "1", "Home", ""],
        ]);
        let fake = fake_with("Order_21", vr);
        let preview = preview_sync(&pool, &fake, "ss", "Order_21").await.unwrap();
        let aliases: Vec<&str> = preview.unknown_menus.iter().map(|m| m.alias.as_str()).collect();
        assert!(aliases.contains(&"FullName"), "preview should surface top-menu name");
        assert!(aliases.contains(&"Short"), "preview should surface column-header name");

        // Map both aliases to the SAME canonical product (the typical fix).
        // First creates the product; second maps the short alias to it.
        let mappings = SyncMappings {
            menu: vec![
                ("FullName".into(), MenuMappingChoice::Create {
                    name_th: "FullName".into(), name_en: None, selling_price: 100,
                }),
                // We don't yet have the product_id here, so use a sentinel that
                // apply_sync's "already in DB" pass will overwrite via find_by_alias.
                // Trick: use Create with same selling_price; we'll dedupe via alias.
                ("Short".into(), MenuMappingChoice::Create {
                    name_th: "FullName".into(), name_en: None, selling_price: 100,
                }),
            ],
            customer: vec![("C1".into(), CustomerMappingChoice::Create { name: "C1".into() })],
        };
        let res = apply_sync(&pool, &fake, "ss", "Order_21", mappings).await.unwrap();
        assert_eq!(res.rows_added, 1);
        let rows = crate::db::orders::list_by_tab(&pool, Some("Order_21"), false, 100).await.unwrap();
        // Quantity 1, unit_price 100 → total 100, even though the column header
        // "Short" has no matching top-menu price.
        assert_eq!(rows[0].total_amount, 100);

        // Identical Create payloads should collapse into one product so future
        // catalog edits stay consistent across both aliases.
        let product_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM product"#)
            .fetch_one(&pool).await.unwrap();
        assert_eq!(product_count, 1, "two aliases with identical Create payloads must share one product");
        let full = crate::db::products::find_by_alias(&pool, "FullName").await.unwrap().unwrap();
        let short = crate::db::products::find_by_alias(&pool, "Short").await.unwrap().unwrap();
        assert_eq!(full.id, short.id);
    }

    #[tokio::test]
    async fn merged_donor_row_edits_flow_into_master() {
        use crate::db::orders::{merge_orders, get_with_items};

        let pool = init_memory_pool().await.unwrap();
        let tab = "Order_30";
        // Both Choc and Matcha in the top menu with proper prices.
        // Layout (0-indexed):
        //   0: Choc   menu item  (price at col4 = 100)
        //   1: Matcha menu item  (price at col4 = 120)
        //   2: blank  → stops menu loop
        //   3: ช่องทาง header
        //   4: K.Ing Choc row   → source_row = 5
        //   5: K.Ing Matcha row → source_row = 6
        let make_sheet = |row6_qty: &str| {
            make_vr(vec![
                vec!["Choc",   "", "", "", "100"],
                vec!["Matcha", "", "", "", "120"],
                vec![""],
                vec!["ช่องทาง", "ลูกค้า", "Choc", "Matcha"],
                vec!["Page", "K.Ing", "1", ""],
                vec!["Page", "K.Ing", "", row6_qty],
            ])
        };
        let fake = FakeSheetsClient {
            tabs: vec![tab.to_string()],
            values: HashMap::from([(format!("{}!A1:Z200", tab), make_sheet("1"))]),
        };
        let preview = preview_sync(&pool, &fake, "x", tab).await.unwrap();
        let mappings = SyncMappings {
            menu: preview.unknown_menus.iter().map(|m| (m.alias.clone(),
                MenuMappingChoice::Create { name_th: m.alias.clone(), name_en: None, selling_price: m.suggested_price })).collect(),
            customer: preview.unknown_customers.iter().map(|c| (c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias.clone() })).collect(),
        };
        apply_sync(&pool, &fake, "x", tab, mappings).await.unwrap();

        // Merge the two K.Ing rows.
        let orders = crate::db::orders::list_by_tab(&pool, Some(tab), false, 100).await.unwrap();
        assert_eq!(orders.len(), 2);
        let ids: Vec<String> = orders.iter().map(|o| o.id.clone()).collect();
        let merged = merge_orders(&pool, &ids).await.unwrap();

        // Wife edits the Matcha row (source_row=6) to qty=3.
        let fake2 = FakeSheetsClient {
            tabs: vec![tab.to_string()],
            values: HashMap::from([(format!("{}!A1:Z200", tab), make_sheet("3"))]),
        };
        apply_sync(&pool, &fake2, "x", tab, SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();

        // Master now reflects qty=3 for source_row=6; qty=1 for source_row=5 still.
        let (master, items) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
        let row5 = items.iter().find(|i| i.source_row == Some(5)).expect("row 5 item");
        let row6 = items.iter().find(|i| i.source_row == Some(6)).expect("row 6 item");
        assert_eq!(row5.quantity, 1);
        assert_eq!(row6.quantity, 3);
        // Total = 100*1 + 120*3 = 460
        assert_eq!(master.total_amount, 460);
    }

    #[tokio::test]
    async fn merged_donor_row_removed_from_sheet_strips_its_items_from_master() {
        use crate::db::orders::{merge_orders, get_with_items};

        let pool = init_memory_pool().await.unwrap();
        let tab = "Order_32";
        let two_rows = make_vr(vec![
            vec!["Choc",   "", "", "", "100"],
            vec!["Matcha", "", "", "", "120"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "Choc", "Matcha"],
            vec!["Page", "K.Ing", "1", ""],
            vec!["Page", "K.Ing", "", "1"],
        ]);
        // source_rows: row4→5, row5→6
        let fake = FakeSheetsClient {
            tabs: vec![tab.to_string()],
            values: HashMap::from([(format!("{}!A1:Z200", tab), two_rows)]),
        };
        let p = preview_sync(&pool, &fake, "x", tab).await.unwrap();
        apply_sync(&pool, &fake, "x", tab, SyncMappings {
            menu: p.unknown_menus.iter().map(|m| (m.alias.clone(),
                MenuMappingChoice::Create { name_th: m.alias.clone(), name_en: None, selling_price: m.suggested_price })).collect(),
            customer: p.unknown_customers.iter().map(|c| (c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias.clone() })).collect(),
        }).await.unwrap();

        let orders = crate::db::orders::list_by_tab(&pool, Some(tab), false, 100).await.unwrap();
        let ids: Vec<String> = orders.iter().map(|o| o.id.clone()).collect();
        let merged = merge_orders(&pool, &ids).await.unwrap();

        // Sheet drops the second K.Ing row (source_row=6).
        let one_row = make_vr(vec![
            vec!["Choc",   "", "", "", "100"],
            vec!["Matcha", "", "", "", "120"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "Choc", "Matcha"],
            vec!["Page", "K.Ing", "1", ""],
        ]);
        let fake2 = FakeSheetsClient {
            tabs: vec![tab.to_string()],
            values: HashMap::from([(format!("{}!A1:Z200", tab), one_row)]),
        };
        apply_sync(&pool, &fake2, "x", tab, SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();

        let (master, items) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
        assert_eq!(items.len(), 1, "row 6's item must be gone");
        assert_eq!(items[0].source_row, Some(5));
        assert_eq!(master.total_amount, 100);
    }

    #[tokio::test]
    async fn deleted_row_is_soft_deleted_and_printed_state_preserved() {
        let pool = init_memory_pool().await.unwrap();
        let mut fake = fake_with("Order_20", fixture_tab());

        let p1 = preview_sync(&pool, &fake, "ss", "Order_20").await.unwrap();
        let m1 = SyncMappings {
            menu: p1.unknown_menus.into_iter().map(|m| (
                m.alias.clone(),
                MenuMappingChoice::Create { name_th: m.alias, name_en: None, selling_price: m.suggested_price },
            )).collect(),
            customer: p1.unknown_customers.into_iter().map(|c| (
                c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias },
            )).collect(),
        };
        apply_sync(&pool, &fake, "ss", "Order_20", m1).await.unwrap();

        // Print Cust1's order.
        let rows = crate::db::orders::list_by_tab(&pool, Some("Order_20"), false, 100).await.unwrap();
        let cust1_id = rows.iter().find(|o| o.order_number.ends_with("-1")).unwrap().id.clone();
        crate::db::orders::mark_printed(&pool, &cust1_id).await.unwrap();

        // Remove Cust2 row from the sheet.
        let changed = make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "10", "5", "100"],
            vec!["B", "", "10", "5", "200"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "B", "สถานที่ส่ง", "Note"],
            vec!["Page", "Cust1", "1", "2", "Home", "Packed"],
        ]);
        fake.values.insert("Order_20!A1:Z200".into(), changed.clone());
        fake.values.insert("Order_20!A1:E50".into(), changed);

        let res = apply_sync(&pool, &fake, "ss", "Order_20",
            SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();
        assert_eq!(res.rows_soft_deleted, 1);

        let alive = crate::db::orders::list_by_tab(&pool, Some("Order_20"), false, 100).await.unwrap();
        assert_eq!(alive.len(), 1);
        let printed = crate::db::orders::get_with_items(&pool, &cust1_id).await.unwrap().unwrap().0;
        assert!(printed.printed_at.is_some());
    }
}
