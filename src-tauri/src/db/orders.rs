use crate::db::ids::{new_id, now_iso};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OrderRow {
    pub id: String,
    pub order_number: String,
    pub customer_id: String,
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
    pub synced_at: Option<String>,
    pub printed_at: Option<String>,
    pub print_count: i64,
    pub deleted_at: Option<String>,
    pub sync_locked: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub struct EditOrderItem {
    pub product_id: String,
    pub quantity: i64,
    pub unit_price: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OrderItemRow {
    pub id: String,
    pub order_id: String,
    pub product_id: String,
    pub quantity: i64,
    pub unit_price: i64,
}

pub struct UpsertOrderInput<'a> {
    pub customer_id: &'a str,
    pub channel: Option<&'a str>,
    pub delivery_location: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub total_amount: i64,
    pub order_date: &'a str,
    pub source_tab: &'a str,
    pub source_row: i64,
    pub items: Vec<UpsertOrderItemInput<'a>>,
}

pub struct UpsertOrderItemInput<'a> {
    pub product_id: &'a str,
    pub quantity: i64,
    pub unit_price: i64,
}

pub struct UpsertOutcome {
    // Returned for callers and asserted in tests; `cargo run` doesn't read them
    // directly today, so silence the dead-code lint without removing the contract.
    #[allow(dead_code)]
    pub order_id: String,
    #[allow(dead_code)]
    pub order_number: String,
    pub was_insert: bool,
}

/// Upsert an order keyed by (source_tab, source_row). Replaces items.
/// `printed_at` and `print_count` are never touched.
pub async fn upsert_from_source(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: UpsertOrderInput<'_>,
) -> Result<UpsertOutcome, sqlx::Error> {
    let now = now_iso();

    let existing: Option<(String, String, i64)> = sqlx::query_as(
        r#"SELECT id, order_number, sync_locked FROM "order"
           WHERE source_tab = ? AND source_row = ?"#,
    )
    .bind(input.source_tab).bind(input.source_row)
    .fetch_optional(&mut **tx).await?;

    let (order_id, order_number, was_insert) = match existing {
        Some((id, num, locked)) => {
            if locked == 0 {
                sqlx::query(
                    r#"UPDATE "order" SET
                         customer_id = ?, channel = ?, delivery_location = ?, notes = ?,
                         total_amount = ?, order_date = ?, synced_at = ?, updated_at = ?,
                         deleted_at = NULL
                       WHERE id = ?"#,
                )
                .bind(input.customer_id).bind(input.channel).bind(input.delivery_location)
                .bind(input.notes).bind(input.total_amount).bind(input.order_date)
                .bind(&now).bind(&now).bind(&id)
                .execute(&mut **tx).await?;
            }
            // Locked rows: skip the UPDATE entirely so the user's edits stay
            // intact. We still return was_insert=false so the caller counts the
            // row as "kept" rather than "new" — that drives the soft-delete
            // bookkeeping below.
            (id, num, false)
        }
        None => {
            // Next seq = number of orders already keyed to this tab + 1.
            // Counting (rather than parsing the seq out of `order_number`) keeps
            // this correct when the tab name itself contains the delimiter '-'
            // (e.g. "16-17/05/26"). Soft-deleted rows are included on purpose so
            // their seqs aren't reused.
            let count: (i64,) = sqlx::query_as(
                r#"SELECT COUNT(*) FROM "order" WHERE source_tab = ?"#,
            )
            .bind(input.source_tab).fetch_one(&mut **tx).await?;
            let next_seq = count.0 + 1;
            let id = new_id();
            let num = format!("{}-{}", input.source_tab, next_seq);
            sqlx::query(
                r#"INSERT INTO "order"
                   (id, order_number, customer_id, channel, delivery_location, notes,
                    status, total_amount, order_date, source_tab, source_row,
                    synced_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)"#,
            )
            .bind(&id).bind(&num).bind(input.customer_id).bind(input.channel)
            .bind(input.delivery_location).bind(input.notes).bind(input.total_amount)
            .bind(input.order_date).bind(input.source_tab).bind(input.source_row)
            .bind(&now).bind(&now).bind(&now)
            .execute(&mut **tx).await?;
            (id, num, true)
        }
    };

    // Locked rows keep their items as-is. Refresh them only when the row is
    // either brand new or being updated from the sheet.
    let is_locked: (i64,) = sqlx::query_as(
        r#"SELECT sync_locked FROM "order" WHERE id = ?"#,
    )
    .bind(&order_id).fetch_one(&mut **tx).await?;
    if is_locked.0 == 0 {
        sqlx::query(r#"DELETE FROM order_item WHERE order_id = ?"#)
            .bind(&order_id).execute(&mut **tx).await?;
        for item in input.items {
            sqlx::query(
                r#"INSERT INTO order_item (id, order_id, product_id, quantity, unit_price)
                   VALUES (?, ?, ?, ?, ?)"#,
            )
            .bind(new_id()).bind(&order_id).bind(item.product_id)
            .bind(item.quantity).bind(item.unit_price)
            .execute(&mut **tx).await?;
        }
    }

    Ok(UpsertOutcome { order_id, order_number, was_insert })
}

pub async fn soft_delete_missing_rows(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    tab: &str,
    keep_rows: &[i64],
) -> Result<i64, sqlx::Error> {
    // Locked rows are always preserved here — the cashier asked us to keep
    // their edited version even if the sheet no longer references it.
    //
    // When keep_rows is empty we want to soft-delete every live row for the
    // tab (still respecting sync_locked). Building `NOT IN (NULL)` would
    // silently match nothing in SQLite, so drop that predicate entirely.
    let sql = if keep_rows.is_empty() {
        r#"UPDATE "order" SET deleted_at = ?, updated_at = ?
           WHERE source_tab = ? AND deleted_at IS NULL AND sync_locked = 0"#.to_string()
    } else {
        let placeholders = keep_rows.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        format!(
            r#"UPDATE "order" SET deleted_at = ?, updated_at = ?
               WHERE source_tab = ? AND deleted_at IS NULL AND sync_locked = 0
                 AND source_row NOT IN ({})"#,
            placeholders
        )
    };
    let mut q = sqlx::query(&sql).bind(now_iso()).bind(now_iso()).bind(tab);
    for r in keep_rows { q = q.bind(r); }
    let res = q.execute(&mut **tx).await?;
    Ok(res.rows_affected() as i64)
}

pub async fn list_by_tab(
    pool: &SqlitePool,
    tab: Option<&str>,
    include_deleted: bool,
    limit: i64,
) -> Result<Vec<OrderRow>, sqlx::Error> {
    let mut sql = String::from(r#"SELECT * FROM "order" WHERE 1=1"#);
    if !include_deleted { sql.push_str(" AND deleted_at IS NULL"); }
    if tab.is_some() { sql.push_str(" AND source_tab = ?"); }
    sql.push_str(" ORDER BY source_tab DESC, source_row ASC LIMIT ?");
    let mut q = sqlx::query_as::<_, OrderRow>(&sql);
    if let Some(t) = tab { q = q.bind(t); }
    q = q.bind(limit);
    q.fetch_all(pool).await
}

pub async fn get_with_items(
    pool: &SqlitePool, id: &str,
) -> Result<Option<(OrderRow, Vec<OrderItemRow>)>, sqlx::Error> {
    let order = sqlx::query_as::<_, OrderRow>(r#"SELECT * FROM "order" WHERE id = ?"#)
        .bind(id).fetch_optional(pool).await?;
    let Some(order) = order else { return Ok(None); };
    let items = sqlx::query_as::<_, OrderItemRow>(
        "SELECT * FROM order_item WHERE order_id = ? ORDER BY id"
    ).bind(id).fetch_all(pool).await?;
    Ok(Some((order, items)))
}

/// Apply a manual edit to an order. Replaces the line items, recomputes the
/// total as `subtotal - discount + delivery_fee`, and flips `sync_locked = 1`
/// so future syncs from the sheet leave this row alone.
pub async fn apply_order_edit(
    pool: &SqlitePool,
    order_id: &str,
    items: &[EditOrderItem],
    discount: i64,
    delivery_fee: i64,
) -> Result<(), sqlx::Error> {
    let subtotal: i64 = items.iter().map(|i| i.quantity * i.unit_price).sum();
    let total = (subtotal - discount + delivery_fee).max(0);
    let now = now_iso();
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"UPDATE "order" SET
             total_amount = ?, discount = ?, delivery_fee = ?,
             sync_locked = 1, updated_at = ?
           WHERE id = ?"#,
    )
    .bind(total).bind(discount).bind(delivery_fee).bind(&now).bind(order_id)
    .execute(&mut *tx).await?;

    sqlx::query(r#"DELETE FROM order_item WHERE order_id = ?"#)
        .bind(order_id).execute(&mut *tx).await?;
    for it in items {
        sqlx::query(
            r#"INSERT INTO order_item (id, order_id, product_id, quantity, unit_price)
               VALUES (?, ?, ?, ?, ?)"#,
        )
        .bind(new_id()).bind(order_id).bind(&it.product_id)
        .bind(it.quantity).bind(it.unit_price)
        .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn mark_printed(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "order" SET printed_at = ?, print_count = print_count + 1, updated_at = ?
           WHERE id = ?"#,
    )
    .bind(now_iso()).bind(now_iso()).bind(id)
    .execute(pool).await?;
    Ok(())
}

pub async fn insert_sync_log(
    pool: &SqlitePool, tab: &str, added: i64, updated: i64, deleted: i64,
    status: &str, error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO sync_log
           (id, tab_name, synced_at, rows_added, rows_updated, rows_soft_deleted, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(new_id()).bind(tab).bind(now_iso())
    .bind(added).bind(updated).bind(deleted).bind(status).bind(error)
    .execute(pool).await?;
    Ok(())
}

pub async fn upsert_week_mapping(
    pool: &SqlitePool, tab: &str, week_start: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO tab_week_mapping (tab_name, week_start_date) VALUES (?, ?)
           ON CONFLICT(tab_name) DO UPDATE SET week_start_date = excluded.week_start_date"#,
    )
    .bind(tab).bind(week_start).execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{pool::init_memory_pool, products, customers};

    async fn seed_pc(pool: &SqlitePool) -> (products::Product, customers::Customer) {
        let p = products::create(pool, "เค้กช็อคฟัดจ์", Some("Choco Fudge"), 85).await.unwrap();
        let c = customers::create(pool, "K.Parin").await.unwrap();
        (p, c)
    }

    #[tokio::test]
    async fn upsert_assigns_stable_order_number_and_replaces_items() {
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        let out = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: Some("Page"),
            delivery_location: Some("X"), notes: None,
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();
        assert!(out.was_insert);
        assert_eq!(out.order_number, "Order_30-1");

        // Re-sync with qty 2 -> update, same order_number.
        let mut tx = pool.begin().await.unwrap();
        let out2 = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: Some("Page"),
            delivery_location: Some("X"), notes: Some("packed"),
            total_amount: 170, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 2, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();
        assert!(!out2.was_insert);
        assert_eq!(out2.order_number, "Order_30-1");

        let (ord, items) = get_with_items(&pool, &out2.order_id).await.unwrap().unwrap();
        assert_eq!(ord.total_amount, 170);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].quantity, 2);
    }

    #[tokio::test]
    async fn mark_printed_persists_across_resync() {
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;
        let mut tx = pool.begin().await.unwrap();
        let out = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: None, delivery_location: None, notes: None,
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();

        mark_printed(&pool, &out.order_id).await.unwrap();
        let (ord_after_print, _) = get_with_items(&pool, &out.order_id).await.unwrap().unwrap();
        assert!(ord_after_print.printed_at.is_some());
        assert_eq!(ord_after_print.print_count, 1);

        // Re-sync should NOT clear printed_at.
        let mut tx = pool.begin().await.unwrap();
        upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: None, delivery_location: None, notes: None,
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();
        let (ord_after_resync, _) = get_with_items(&pool, &out.order_id).await.unwrap().unwrap();
        assert!(ord_after_resync.printed_at.is_some());
        assert_eq!(ord_after_resync.print_count, 1);
    }

    #[tokio::test]
    async fn soft_delete_marks_rows_not_in_keep_list() {
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;
        for row in [11, 12, 13] {
            let mut tx = pool.begin().await.unwrap();
            upsert_from_source(&mut tx, UpsertOrderInput {
                customer_id: &c.id, channel: None, delivery_location: None, notes: None,
                total_amount: 85, order_date: "2026-05-11",
                source_tab: "Order_30", source_row: row,
                items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
            }).await.unwrap();
            tx.commit().await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        let n = soft_delete_missing_rows(&mut tx, "Order_30", &[11, 13]).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n, 1);

        let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
        assert_eq!(alive.len(), 2);
        let all = list_by_tab(&pool, Some("Order_30"), true, 100).await.unwrap();
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn soft_delete_with_empty_keep_list_deletes_all_rows_in_tab() {
        // Regression: when a synced tab loses every order row, keep_rows is
        // empty. The old SQL built `NOT IN (NULL)` which SQLite treats as
        // never-true, so rows stuck around. Empty keep_rows must wipe the tab.
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;
        for row in [11, 12] {
            let mut tx = pool.begin().await.unwrap();
            upsert_from_source(&mut tx, UpsertOrderInput {
                customer_id: &c.id, channel: None, delivery_location: None, notes: None,
                total_amount: 85, order_date: "2026-05-11",
                source_tab: "Order_30", source_row: row,
                items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
            }).await.unwrap();
            tx.commit().await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        let n = soft_delete_missing_rows(&mut tx, "Order_30", &[]).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n, 2);
        let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
        assert_eq!(alive.len(), 0);
    }

    #[tokio::test]
    async fn sync_locked_order_is_not_overwritten_by_upsert_and_is_kept() {
        // When the cashier edits an order locally we set sync_locked = 1. After
        // that flag is on, a re-sync from the sheet must:
        //   1. recognise the row as existing (no insert), but
        //   2. leave items, total, discount, delivery_fee untouched, and
        //   3. NOT soft-delete the row even if the sheet no longer carries it.
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        let out = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: Some("Page"),
            delivery_location: None, notes: None,
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();

        // Cashier edits the order: bump qty and add a delivery fee. We model this
        // here as a direct write — the higher-level update_order command will use
        // the same code path.
        sqlx::query(
            r#"UPDATE "order"
               SET sync_locked = 1, total_amount = 210, delivery_fee = 40,
                   updated_at = ?
               WHERE id = ?"#,
        )
        .bind(now_iso()).bind(&out.order_id)
        .execute(&pool).await.unwrap();
        sqlx::query(r#"DELETE FROM order_item WHERE order_id = ?"#)
            .bind(&out.order_id).execute(&pool).await.unwrap();
        sqlx::query(
            r#"INSERT INTO order_item (id, order_id, product_id, quantity, unit_price)
               VALUES (?, ?, ?, ?, ?)"#,
        )
        .bind(new_id()).bind(&out.order_id).bind(&p.id).bind(2_i64).bind(85_i64)
        .execute(&pool).await.unwrap();

        // A subsequent sync tries to push qty back to 1 — locked row must ignore it.
        let mut tx = pool.begin().await.unwrap();
        let out2 = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: Some("Page"),
            delivery_location: None, notes: Some("from sheet"),
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();
        assert!(!out2.was_insert, "locked row must be recognised as existing");

        let (ord, items) = get_with_items(&pool, &out.order_id).await.unwrap().unwrap();
        assert_eq!(ord.total_amount, 210, "locked total must not be overwritten");
        assert_eq!(ord.delivery_fee, 40, "locked delivery_fee must not be overwritten");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].quantity, 2, "locked items must not be overwritten");
        assert_eq!(ord.sync_locked, 1);

        // Sheet drops the row entirely: locked row must NOT be soft-deleted.
        let mut tx = pool.begin().await.unwrap();
        let n = soft_delete_missing_rows(&mut tx, "Order_30", &[]).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n, 0, "locked rows must be excluded from soft-delete");
        let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
        assert_eq!(alive.len(), 1, "locked row should still be alive after soft delete");
    }

    #[tokio::test]
    async fn apply_order_edit_replaces_items_and_locks_sync() {
        // The update_order command rebuilds items, recomputes total from
        // subtotal - discount + delivery_fee, and flips sync_locked on.
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;
        let p2 = crate::db::products::create(&pool, "ขนมปังกล้วย", None, 60).await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        let out = upsert_from_source(&mut tx, UpsertOrderInput {
            customer_id: &c.id, channel: None, delivery_location: None, notes: None,
            total_amount: 85, order_date: "2026-05-11",
            source_tab: "Order_30", source_row: 11,
            items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
        }).await.unwrap();
        tx.commit().await.unwrap();

        let edit_items = vec![
            EditOrderItem { product_id: p.id.clone(), quantity: 3, unit_price: 85 },
            EditOrderItem { product_id: p2.id.clone(), quantity: 2, unit_price: 60 },
        ];
        apply_order_edit(&pool, &out.order_id, &edit_items, 25, 30).await.unwrap();

        let (ord, items) = get_with_items(&pool, &out.order_id).await.unwrap().unwrap();
        // subtotal = 3*85 + 2*60 = 375. total = 375 - 25 + 30 = 380.
        assert_eq!(ord.total_amount, 380);
        assert_eq!(ord.discount, 25);
        assert_eq!(ord.delivery_fee, 30);
        assert_eq!(ord.sync_locked, 1);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn order_numbers_stay_unique_when_tab_name_contains_dash() {
        // Mimics a real-world tab name like "16-17/05/26". Earlier the seq was
        // parsed out of order_number by INSTR(.., '-') which split at the FIRST
        // dash, returning bogus values and eventually causing UNIQUE collisions.
        let pool = init_memory_pool().await.unwrap();
        let (p, c) = seed_pc(&pool).await;
        let tab = "16-17/05/26";
        let mut nums: Vec<String> = Vec::new();
        for row in 11..=20 {
            let mut tx = pool.begin().await.unwrap();
            let out = upsert_from_source(&mut tx, UpsertOrderInput {
                customer_id: &c.id, channel: None, delivery_location: None, notes: None,
                total_amount: 85, order_date: "2026-05-16",
                source_tab: tab, source_row: row,
                items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
            }).await.unwrap();
            tx.commit().await.unwrap();
            nums.push(out.order_number);
        }
        let mut dedup = nums.clone();
        dedup.sort(); dedup.dedup();
        assert_eq!(dedup.len(), nums.len(),
            "order_numbers should all be unique, got: {:?}", nums);
        assert_eq!(nums[0], "16-17/05/26-1");
        assert_eq!(nums[9], "16-17/05/26-10");
    }
}
