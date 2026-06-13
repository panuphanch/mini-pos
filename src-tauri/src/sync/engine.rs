use crate::db::{customers, orders, products, sync_ignore};
use crate::sheets::client::SheetsClient;
use crate::sheets::parser::{parse_tab, MenuRow};
use crate::sheets::week::parse_tab_week_start;
use crate::sync::types::*;
use anyhow::{anyhow, Result};
use chrono::Datelike;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Pair each order-table column header with the top summary row at the same
/// index to recover its price. The wife maintains both lists in the same order,
/// so column N's price is summary row N's price — even when the header text is a
/// shortened or translated form (e.g. header "แครอท" ↔ summary "Carrot 1P").
fn positional_price_by_alias(order_columns: &[String], menu: &[MenuRow]) -> HashMap<String, i64> {
    let mut map = HashMap::new();
    for (i, col) in order_columns.iter().enumerate() {
        // First occurrence wins; a duplicated header keeps its leftmost price.
        if let Some(row) = menu.get(i) {
            map.entry(col.clone()).or_insert(row.price);
        }
    }
    map
}

pub async fn preview_sync(
    pool: &SqlitePool,
    sheets: &dyn SheetsClient,
    spreadsheet_id: &str,
    tab: &str,
) -> Result<SyncPreview> {
    let range = format!("{}!A1:Z200", tab);
    let vr = sheets.get_values(spreadsheet_id, &range).await?;
    let mut parsed = parse_tab(&vr).map_err(|e| anyhow!(e.to_string()))?;

    let week_start = parse_tab_week_start(tab, chrono::Utc::now().year())
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| chrono::Utc::now().date_naive().format("%Y-%m-%d").to_string());

    // Drop everything the cashier has chosen to ignore for this tab BEFORE we
    // compute unknowns or counts, so an ignored row/name never resurfaces as
    // noise and is never written. Ignored rows vanish entirely; ignored menu
    // names are stripped from the items of the rows that survive.
    let ignored_menu = sync_ignore::list_ignored_menu(pool, tab).await?;
    let ignored_rows = sync_ignore::list_ignored_rows(pool, tab).await?;
    parsed.orders.retain(|o| !ignored_rows.contains(&o.source_row));
    if !ignored_menu.is_empty() {
        for o in &mut parsed.orders {
            o.items.retain(|it| !ignored_menu.contains(&it.menu_name));
        }
    }

    // Reconcile menu aliases.
    //
    // Two surfaces hold menu names in a tab:
    //   1. Top summary table (column A) — has prices.
    //   2. Order table column headers — what each order row's items actually reference.
    //
    // The wife maintains both in the SAME order, but the column header is often a
    // shortened or translated form of the summary name (e.g. summary "Carrot 1P",
    // header "แครอท"). The order rows only ever reference the column-header text, so
    // that is the alias we resolve and map to a product. We pair each column header
    // with the summary row at the same index to recover its price — this collapses
    // each cake to a single entry instead of surfacing the full name (with price)
    // and the short header (at ฿0) as two separate unknowns.
    let price_by_alias = positional_price_by_alias(&parsed.order_columns, &parsed.menu);

    let mut unknown_menus: Vec<UnknownMenu> = Vec::new();
    let mut drifted_menus: Vec<DriftedMenu> = Vec::new();
    let mut seen_menu_alias = std::collections::HashSet::new();
    for alias in &parsed.order_columns {
        if !seen_menu_alias.insert(alias.clone()) { continue; }
        if ignored_menu.contains(alias) { continue; }
        match products::find_by_alias(pool, alias).await? {
            None => {
                let price = price_by_alias.get(alias).copied().unwrap_or(0);
                unknown_menus.push(UnknownMenu { alias: alias.clone(), suggested_price: price });
            }
            Some(product) => {
                // Known alias: the price on the sheet this week is the only
                // signal that the wife has repointed this header at a repriced
                // or different cake. If it disagrees with the bound product's
                // price, surface it instead of silently applying the stale one.
                // A ฿0 (missing) positional price carries no signal — skip it.
                if let Some(&sheet_price) = price_by_alias.get(alias) {
                    if sheet_price > 0 && sheet_price != product.selling_price {
                        drifted_menus.push(DriftedMenu {
                            alias: alias.clone(),
                            product_id: product.id.clone(),
                            product_name_th: product.name_th.clone(),
                            product_name_en: product.name_en.clone(),
                            current_price: product.selling_price,
                            sheet_price,
                        });
                    }
                }
            }
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
        drifted_menus,
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
    //
    // NB: these catalog mutations (update_price / create / upsert_alias) commit
    // immediately, *before* the order transaction below. If the order tx later
    // fails, the catalog edits stay applied — and a retry preview then sees the
    // price already matching, so the drift silently self-resolves. Benign because
    // every catalog op here is idempotent, but non-obvious.
    let mut menu_alias_to_product: HashMap<String, String> = HashMap::new();
    let mut created_menu_by_payload: HashMap<(String, Option<String>, i64), String> = HashMap::new();
    // Aliases the cashier explicitly resolved in this request. A drifted alias
    // already resolves via find_by_alias, so the "already in DB" backfill below
    // would satisfy a contains_key gate without any human decision — we gate on
    // this set instead to force an explicit choice for every drift.
    let explicitly_mapped: std::collections::HashSet<String> =
        mappings.menu.iter().map(|(a, _)| a.clone()).collect();
    for (alias, choice) in mappings.menu {
        let pid = match choice {
            MenuMappingChoice::Existing { product_id } => product_id,
            MenuMappingChoice::UpdatePrice { product_id, selling_price } => {
                products::update_price(pool, &product_id, selling_price).await?;
                product_id
            }
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
    for dm in &preview.drifted_menus {
        if !explicitly_mapped.contains(&dm.alias) {
            return Err(anyhow!(
                "Menu price drift unresolved: {} (sheet ฿{} vs ฿{})",
                dm.alias, dm.sheet_price, dm.current_price
            ));
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
            // Locked master: cashier has manually edited it via EditOrderDialog;
            // don't overwrite their edits with sheet data.
            let master_locked: (i64,) = sqlx::query_as(
                r#"SELECT sync_locked FROM "order" WHERE id = ?"#,
            )
            .bind(&master_id).fetch_one(&mut *tx).await?;
            if master_locked.0 != 0 {
                keep_rows.push(ord.source_row);
                continue;
            }

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
    async fn column_header_is_priced_from_aligned_summary_row() {
        // Real-world case from the screenshot: the wife shortens / translates the
        // column header ("Short") relative to the top summary name ("FullName"),
        // but keeps both lists in the same order. The order rows only reference
        // the column header, so we surface ONE unknown ("Short") and price it
        // from the summary row at the same index — no spurious ฿0 duplicate.
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
        assert_eq!(aliases, vec!["Short"], "only the order-column header is surfaced, once");
        assert_eq!(preview.unknown_menus[0].suggested_price, 100,
            "price comes from the positionally-aligned summary row");

        // Map the single alias to a new product.
        let mappings = SyncMappings {
            menu: vec![
                ("Short".into(), MenuMappingChoice::Create {
                    name_th: "FullName".into(), name_en: None, selling_price: 100,
                }),
            ],
            customer: vec![("C1".into(), CustomerMappingChoice::Create { name: "C1".into() })],
        };
        let res = apply_sync(&pool, &fake, "ss", "Order_21", mappings).await.unwrap();
        assert_eq!(res.rows_added, 1);
        let rows = crate::db::orders::list_by_tab(&pool, Some("Order_21"), false, 100).await.unwrap();
        assert_eq!(rows[0].total_amount, 100);

        let product_count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM product"#)
            .fetch_one(&pool).await.unwrap();
        assert_eq!(product_count, 1, "one column header → one product");
    }

    fn screenshot_csv_shape() -> ValueRange {
        // Mirrors ~/Downloads/GrannySaidso Order - 6-7_06_26.csv: summary table
        // with full/English names + prices, then an order table whose column
        // headers are shortened/Thai forms in the SAME order.
        make_vr(vec![
            vec!["Menu", "", "Total", "", "Price"],
            vec!["เค้กพายคาราเมลโคตรถั่ว", "", "10", "0", "145"],
            vec!["London Choc Caramel Moose", "", "16", "0", "165"],
            vec!["Matcha Layers", "", "10", "0", "165"],
            vec!["เค้กเผือกลอดช่อง", "", "10", "0", "129"],
            vec!["Carrot 1P", "", "6", "0", "85"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "พายคาราเมลโคตรถั่ว", "London Choc",
                 "Matcha Layers", "เค้กเผือกลอดช่อง", "แครอท", "สถานที่ส่ง", "Note"],
            vec!["DM", "N'อ้อนใจ", "2", "1", "", "", "", "Chawyn", ""],
            vec!["Page", "K.PPor", "", "1", "", "", "1", "บ้าน", ""],
        ])
    }

    #[tokio::test]
    async fn screenshot_shape_surfaces_each_cake_once_with_price() {
        // Regression for the reported bug: each cake showed twice — full name w/
        // price and short header at ฿0. Now each order column appears once,
        // priced from its aligned summary row, and no ฿0 duplicate exists.
        let pool = init_memory_pool().await.unwrap();
        let fake = fake_with("Order_33", screenshot_csv_shape());
        let preview = preview_sync(&pool, &fake, "ss", "Order_33").await.unwrap();

        let priced: Vec<(String, i64)> = preview.unknown_menus.iter()
            .map(|m| (m.alias.clone(), m.suggested_price)).collect();
        // Only the order-column headers, each exactly once, none at ฿0.
        assert!(priced.contains(&("London Choc".to_string(), 165)));
        assert!(priced.contains(&("แครอท".to_string(), 85)));
        assert!(priced.contains(&("พายคาราเมลโคตรถั่ว".to_string(), 145)));
        assert!(!priced.iter().any(|(_, p)| *p == 0), "no ฿0 duplicate entries: {:?}", priced);
        // No full summary names leak in as separate unknowns.
        assert!(!priced.iter().any(|(a, _)| a == "London Choc Caramel Moose"));
        assert!(!priced.iter().any(|(a, _)| a == "Carrot 1P"));
        // Five columns are referenced across the two rows → at most 5 unknowns.
        assert!(preview.unknown_menus.len() <= 5);
    }

    #[tokio::test]
    async fn ignored_menu_and_rows_are_excluded_from_sync() {
        let pool = init_memory_pool().await.unwrap();
        let fake = fake_with("Order_33", screenshot_csv_shape());

        // Ignore one bad column name and one order row.
        sync_ignore::ignore_menu(&pool, "Order_33", "แครอท").await.unwrap();
        sync_ignore::ignore_row(&pool, "Order_33", 10).await.unwrap(); // K.PPor row

        let preview = preview_sync(&pool, &fake, "ss", "Order_33").await.unwrap();
        assert!(!preview.unknown_menus.iter().any(|m| m.alias == "แครอท"),
            "ignored menu name must not surface");
        assert!(!preview.parsed_orders.iter().any(|o| o.source_row == 10),
            "ignored row must not be parsed");
        assert!(!preview.unknown_customers.iter().any(|c| c.alias == "K.PPor"),
            "customer from an ignored row must not surface");

        // Un-ignore restores them.
        sync_ignore::unignore_menu(&pool, "Order_33", "แครอท").await.unwrap();
        sync_ignore::unignore_row(&pool, "Order_33", 10).await.unwrap();
        let preview2 = preview_sync(&pool, &fake, "ss", "Order_33").await.unwrap();
        assert!(preview2.unknown_menus.iter().any(|m| m.alias == "แครอท"));
        assert!(preview2.parsed_orders.iter().any(|o| o.source_row == 10));
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
    async fn locked_master_ignores_donor_row_edits_via_sync() {
        use crate::db::orders::{merge_orders, apply_order_edit, get_with_items, EditOrderItem};

        let pool = init_memory_pool().await.unwrap();
        let tab = "Order_31";
        // Use the same fixture format as merged_donor_row_edits_flow_into_master.
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
        apply_sync(&pool, &fake, "x", tab, SyncMappings {
            menu: preview.unknown_menus.iter().map(|m| (m.alias.clone(),
                MenuMappingChoice::Create { name_th: m.alias.clone(), name_en: None, selling_price: m.suggested_price })).collect(),
            customer: preview.unknown_customers.iter().map(|c| (c.alias.clone(),
                CustomerMappingChoice::Create { name: c.alias.clone() })).collect(),
        }).await.unwrap();

        // Merge the two K.Ing rows, then lock the master via apply_order_edit.
        let orders = crate::db::orders::list_by_tab(&pool, Some(tab), false, 100).await.unwrap();
        let ids: Vec<String> = orders.iter().map(|o| o.id.clone()).collect();
        let merged = merge_orders(&pool, &ids).await.unwrap();
        let (master_before, items_before) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
        let total_before = master_before.total_amount;
        let item_count_before = items_before.len();

        // Cashier edits the master in-app — keep items as-is but trigger the lock.
        let edit_items: Vec<EditOrderItem> = items_before.iter().map(|it| EditOrderItem {
            product_id: it.product_id.clone(),
            quantity: it.quantity,
            unit_price: it.unit_price,
        }).collect();
        apply_order_edit(&pool, &merged.master_order_id, &edit_items, 0, 0).await.unwrap();

        // Sheet edits the Matcha row (source_row=6) to qty=3 — locked master must ignore.
        let fake2 = FakeSheetsClient {
            tabs: vec![tab.to_string()],
            values: HashMap::from([(format!("{}!A1:Z200", tab), make_sheet("3"))]),
        };
        apply_sync(&pool, &fake2, "x", tab, SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();

        let (master_after, items_after) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
        assert_eq!(master_after.total_amount, total_before, "locked master total must not change from sync");
        assert_eq!(items_after.len(), item_count_before, "locked master items must not change from sync");
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

    #[tokio::test]
    async fn reused_header_price_drift_is_surfaced_and_blocks_until_resolved() {
        // Regression for the silent overcharge: the wife reuses a short column
        // header across weeks. When she repoints it at a repriced cake, the
        // global exact alias used to apply the OLD price with no unknown
        // surfaced. Now the price mismatch surfaces as a drift that blocks
        // apply until the cashier resolves it.
        let pool = init_memory_pool().await.unwrap();

        // Week A: header "Taro" priced 129, mapped to a new product.
        let week_a = make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["Taro", "", "10", "5", "129"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "Taro", "สถานที่ส่ง", "Note"],
            vec!["Page", "C1", "1", "Home", ""],
        ]);
        let fake_a = fake_with("Order_40", week_a);
        let pa = preview_sync(&pool, &fake_a, "ss", "Order_40").await.unwrap();
        assert_eq!(pa.unknown_menus.len(), 1);
        assert!(pa.drifted_menus.is_empty(), "nothing bound yet → no drift");
        apply_sync(&pool, &fake_a, "ss", "Order_40", SyncMappings {
            menu: vec![("Taro".into(), MenuMappingChoice::Create {
                name_th: "เค้กโคตรเผือกมะพร้าวอ่อน".into(), name_en: None, selling_price: 129 })],
            customer: vec![("C1".into(), CustomerMappingChoice::Create { name: "C1".into() })],
        }).await.unwrap();
        let product_id = products::find_by_alias(&pool, "Taro").await.unwrap().unwrap().id;

        // Week B (different tab): SAME header "Taro", but the menu changed — 115.
        let week_b = make_vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["Taro", "", "10", "5", "115"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "Taro", "สถานที่ส่ง", "Note"],
            vec!["Page", "C1", "2", "Home", ""],
        ]);
        let fake_b = fake_with("Order_41", week_b);
        let pb = preview_sync(&pool, &fake_b, "ss", "Order_41").await.unwrap();

        // The reused header resolves (not unknown) but the price mismatch drifts.
        assert!(pb.unknown_menus.is_empty(), "known alias must not surface as unknown");
        assert_eq!(pb.drifted_menus.len(), 1, "price mismatch must surface as drift");
        let d = &pb.drifted_menus[0];
        assert_eq!(d.alias, "Taro");
        assert_eq!(d.current_price, 129);
        assert_eq!(d.sheet_price, 115);
        assert_eq!(d.product_id, product_id);

        // Applying without resolving the drift is blocked.
        let blocked = apply_sync(&pool, &fake_b, "ss", "Order_41",
            SyncMappings { menu: vec![], customer: vec![] }).await;
        assert!(blocked.is_err(), "unresolved drift must block apply");

        // Resolve via UpdatePrice → product adopts 115 and the order is priced at 115.
        apply_sync(&pool, &fake_b, "ss", "Order_41", SyncMappings {
            menu: vec![("Taro".into(), MenuMappingChoice::UpdatePrice {
                product_id: product_id.clone(), selling_price: 115 })],
            customer: vec![],
        }).await.unwrap();

        let updated = products::get_by_id(&pool, &product_id).await.unwrap().unwrap();
        assert_eq!(updated.selling_price, 115, "product price updated to sheet price");
        let rows = crate::db::orders::list_by_tab(&pool, Some("Order_41"), false, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_amount, 230, "2 × ฿115");

        // A second preview now sees no drift (prices agree).
        let pb2 = preview_sync(&pool, &fake_b, "ss", "Order_41").await.unwrap();
        assert!(pb2.drifted_menus.is_empty(), "drift clears once prices agree");
    }
}
