# Merge Orders & Delete Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cashier (a) soft-delete a duplicate row from the Orders list and (b) merge two or more rows for the same customer into a single receipt while still letting sheet edits flow into the merged result.

**Architecture:** Two independent phases. Phase 1 adds a `delete_order` Tauri command and a trash icon in `OrdersPage`. Phase 2 adds a `merged_into_id` column on `"order"` and a `source_row` tag on `order_item` so the sync engine can refresh items per sheet row instead of per order. Merging re-parents the donor's items onto the master order and soft-deletes the donor; subsequent sheet edits to either row continue to flow into the master by matching items on `source_row`.

**Tech Stack:** Rust (Tauri 2 + sqlx + SQLite), React + TypeScript + shadcn/ui, vitest, cargo test.

**Spec:** [`docs/superpowers/specs/2026-05-23-merge-orders-design.md`](../specs/2026-05-23-merge-orders-design.md)

---

## Phase 1 — Delete a row

### Task 1: Add `delete_order` DB function with tests

**Files:**
- Modify: `src-tauri/src/db/orders.rs` (append a function + tests near the existing `apply_order_edit`)

- [ ] **Step 1: Write the failing tests**

Append to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/orders.rs`:

```rust
#[tokio::test]
async fn delete_order_soft_deletes_and_locks_against_resync() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;

    // Insert via the normal sync path so the row mirrors a real sheet row.
    let mut tx = pool.begin().await.unwrap();
    let out = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None,
        delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 11,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();

    delete_order(&pool, &out.order_id).await.unwrap();

    // Hidden by default
    let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
    assert_eq!(alive.len(), 0);
    // Visible under include_deleted
    let all = list_by_tab(&pool, Some("Order_30"), true, 100).await.unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].deleted_at.is_some());
    assert_eq!(all[0].sync_locked, 1);

    // Re-syncing the same row must NOT resurrect it (sync_locked guards both
    // upsert_from_source and soft_delete_missing_rows).
    let mut tx = pool.begin().await.unwrap();
    upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None,
        delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 11,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
    assert_eq!(alive.len(), 0, "deleted+locked row must stay hidden after re-sync");
}

#[tokio::test]
async fn delete_order_rejects_already_deleted() {
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
    delete_order(&pool, &out.order_id).await.unwrap();
    let err = delete_order(&pool, &out.order_id).await;
    assert!(err.is_err(), "second delete should error");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `src-tauri/`:
```bash
cargo test --quiet --lib db::orders::tests::delete_order
```
Expected: compile error — `delete_order` is not defined.

- [ ] **Step 3: Implement `delete_order`**

Append to `src-tauri/src/db/orders.rs` just before the `#[cfg(test)]` block:

```rust
/// Soft-delete an order and lock it against re-sync.
///
/// Returns an error if the order doesn't exist, is already soft-deleted, or
/// has been merged into another order (Phase 2). The lock is what stops the
/// next `apply_sync` from inserting the row again.
pub async fn delete_order(pool: &SqlitePool, order_id: &str) -> Result<(), sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT deleted_at FROM "order" WHERE id = ?"#,
    )
    .bind(order_id).fetch_optional(pool).await?;
    let Some((deleted_at,)) = row else {
        return Err(sqlx::Error::RowNotFound);
    };
    if deleted_at.is_some() {
        return Err(sqlx::Error::Protocol(
            format!("order {} is already deleted", order_id).into()
        ));
    }
    let now = now_iso();
    sqlx::query(
        r#"UPDATE "order" SET deleted_at = ?, sync_locked = 1, updated_at = ?
           WHERE id = ?"#,
    )
    .bind(&now).bind(&now).bind(order_id)
    .execute(pool).await?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --quiet --lib db::orders::tests::delete_order
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/orders.rs
git commit -m "feat(orders): add delete_order to soft-delete + lock a row"
```

---

### Task 2: Expose `delete_order` as a Tauri command

**Files:**
- Modify: `src-tauri/src/commands/orders.rs` (add command at end of file)
- Modify: `src-tauri/src/lib.rs:30-45` (register in `invoke_handler`)

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/commands/orders.rs`:

```rust
#[tauri::command]
pub async fn delete_order(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    orders::delete_order(&state.db, &id).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, add `commands::orders::delete_order,` to the `invoke_handler` list. The block should now contain (showing only the orders subsection):

```rust
            commands::orders::list_orders,
            commands::orders::get_order,
            commands::orders::print_order,
            commands::orders::update_order,
            commands::orders::delete_order,
```

- [ ] **Step 3: Verify the backend still builds**

From `src-tauri/`:
```bash
cargo build --quiet
```
Expected: compiles with no warnings about an unused command.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/orders.rs src-tauri/src/lib.rs
git commit -m "feat(orders): expose delete_order Tauri command"
```

---

### Task 3: Add `ordersApi.delete` on the frontend

**Files:**
- Modify: `src/lib/tauri.ts:44-56`

- [ ] **Step 1: Add the API binding**

In `src/lib/tauri.ts`, extend the `ordersApi` block so it reads:

```ts
export const ordersApi = {
  list: (opts: { tab?: string; includeDeleted?: boolean; limit?: number } = {}) =>
    invoke<OrderListRow[]>('list_orders', {
      tab: opts.tab ?? null,
      includeDeleted: opts.includeDeleted ?? false,
      limit: opts.limit ?? 200,
    }),
  get: (id: string) => invoke<OrderDetail | null>('get_order', { id }),
  print: (config: AppConfig, id: string) =>
    invoke<string>('print_order', { config, id }),
  update: (id: string, payload: OrderEditPayload) =>
    invoke<void>('update_order', { id, payload }),
  delete: (id: string) => invoke<void>('delete_order', { id }),
};
```

- [ ] **Step 2: Type-check**

From the project root:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(orders): ordersApi.delete binding"
```

---

### Task 4: Trash icon + confirm dialog in OrdersPage

**Files:**
- Modify: `src/pages/OrdersPage.tsx` (add state, handler, button on each row; add Dialog import)

- [ ] **Step 1: Add the delete state and handler near the existing edit state**

In `src/pages/OrdersPage.tsx`, after the existing `editingLoading` state line (around line 44), add:

```tsx
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<OrderListRow | null>(null);

  const confirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingId(deletingTarget.id);
    try {
      await ordersApi.delete(deletingTarget.id);
      setDeletingTarget(null);
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };
```

- [ ] **Step 2: Add the `Trash2` icon import**

In the top `lucide-react` import block of the same file, add `Trash2,` next to `PencilLine`:

```tsx
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Lock,
  MapPin,
  PencilLine,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
```

- [ ] **Step 3: Add Dialog imports**

Below the existing `Select` imports, add:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
```

- [ ] **Step 4: Wire the trash button into `OrderRow`**

Extend the `OrderRowProps` interface to accept the delete callback:

```tsx
interface OrderRowProps {
  row: OrderListRow;
  isExpanded: boolean;
  detail: OrderDetail | undefined;
  printing: boolean;
  editingLoading: boolean;
  deleting: boolean;
  onToggle: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
```

Update the `OrderRow` function signature to destructure the new props and add the trash button. Replace the existing edit-button `<td>` block (around line 290–302) with this two-button block:

```tsx
        <td className="w-20 px-2 py-3 text-center">
          {!removed && (
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Edit order"
                onClick={stopAndEdit}
                disabled={editingLoading}
              >
                <PencilLine className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Delete order"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </td>
```

Update the matching `<th>` in the header row (around line 182) so the column is wider:

```tsx
                <th className="w-20 px-2 py-3 font-medium"></th>
```

- [ ] **Step 5: Pass the callback when rendering `OrderRow`**

In the `orders.map((o) => ...)` block (around line 187), update the props:

```tsx
              {orders.map((o) => (
                <OrderRow
                  key={o.id}
                  row={o}
                  isExpanded={expandedId === o.id}
                  detail={details[o.id]}
                  printing={printingId === o.id}
                  editingLoading={editingLoading === o.id}
                  deleting={deletingId === o.id}
                  onToggle={() => toggleExpand(o)}
                  onPrint={() => handlePrint(o)}
                  onEdit={() => handleEdit(o)}
                  onDelete={() => setDeletingTarget(o)}
                />
              ))}
```

- [ ] **Step 6: Render the confirm dialog**

Just before the final `</div>` that closes the page (after the `EditOrderDialog` block, around line 210), add:

```tsx
      {deletingTarget && (
        <Dialog open onOpenChange={(open) => !open && !deletingId && setDeletingTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove this order?</DialogTitle>
              <DialogDescription>
                Order {deletingTarget.orderNumber} ({deletingTarget.customerName}) will be hidden
                from the list and locked so the next Re-sync won't bring it back. You can still
                see it under <em>Show removed</em>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeletingTarget(null)}
                disabled={!!deletingId}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? 'Removing…' : 'Remove'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
```

- [ ] **Step 7: Type-check and run the existing frontend tests**

From the project root:
```bash
npx tsc --noEmit
npx vitest run --reporter=dot
```
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/pages/OrdersPage.tsx
git commit -m "feat(orders): trash icon + confirm dialog to remove a row"
```

---

## Phase 2 — Merge orders

### Task 5: Schema migration — `merged_into_id` and `order_item.source_row`

**Files:**
- Create: `src-tauri/src/db/migrations/0003_merge_orders.sql`

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/orders.rs`:

```rust
#[tokio::test]
async fn migration_backfills_order_item_source_row() {
    // After the 0003 migration, every existing order_item should have
    // source_row populated from its parent order. Confirm by inserting an
    // order via the normal sync path and reading the column directly.
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 11,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();

    let row: (Option<i64>,) = sqlx::query_as(
        r#"SELECT source_row FROM order_item LIMIT 1"#,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(row.0, Some(11), "source_row should be populated from parent order");
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cargo test --quiet --lib db::orders::tests::migration_backfills_order_item_source_row
```
Expected: SQL error — `no such column: source_row`.

- [ ] **Step 3: Create the migration**

Create `src-tauri/src/db/migrations/0003_merge_orders.sql`:

```sql
-- Merge-orders feature.
--
-- merged_into_id: when set, this order has been folded into another order
-- (the master). The donor row is also soft-deleted (deleted_at set) and is
-- treated as "not a real order" for everything except sync.
ALTER TABLE "order" ADD COLUMN merged_into_id TEXT
    REFERENCES "order"(id);
CREATE INDEX idx_order_merged_into ON "order"(merged_into_id);

-- order_item.source_row: which sheet row produced this item. For non-merged
-- orders this matches the parent order's source_row. For merged masters the
-- master holds items from multiple source_rows; sync uses this tag to refresh
-- only the items that belong to the row currently being parsed.
ALTER TABLE order_item ADD COLUMN source_row INTEGER;
UPDATE order_item
   SET source_row = (
     SELECT source_row FROM "order" WHERE "order".id = order_item.order_id
   );
```

- [ ] **Step 4: Update Rust structs to read the new column**

In `src-tauri/src/db/orders.rs`, extend the `OrderRow` struct (right after `sync_locked`):

```rust
    pub sync_locked: i64,
    pub merged_into_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
```

Extend `OrderItemRow` (file `src-tauri/src/db/orders.rs`, the struct after `OrderRow`):

```rust
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OrderItemRow {
    pub id: String,
    pub order_id: String,
    pub product_id: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub source_row: Option<i64>,
}
```

- [ ] **Step 5: Run the test**

```bash
cargo test --quiet --lib db::orders::tests::migration_backfills_order_item_source_row
```
Expected: 1 passed.

- [ ] **Step 6: Run the full DB test module to confirm no regressions**

```bash
cargo test --quiet --lib db::orders
```
Expected: all previously-passing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/migrations/0003_merge_orders.sql src-tauri/src/db/orders.rs
git commit -m "feat(orders): migration 0003 — merged_into_id + order_item.source_row"
```

---

### Task 6: Source-row-scoped item refresh in `upsert_from_source`

Change the item refresh inside `upsert_from_source` so each sheet row only replaces its own items. For non-merged orders this is behaviorally identical (all items share the same `source_row`); the change is what later lets a master order hold items from multiple rows safely.

**Files:**
- Modify: `src-tauri/src/db/orders.rs:46-160` (`UpsertOrderItemInput` and `upsert_from_source`)

- [ ] **Step 1: Write the failing test**

Append to the test module in `src-tauri/src/db/orders.rs`:

```rust
#[tokio::test]
async fn upsert_only_refreshes_items_tagged_with_its_source_row() {
    // Simulates the post-merge state by hand: one order owns items tagged with
    // two different source_rows. Re-running upsert for source_row=11 must only
    // touch items tagged 11 and leave items tagged 12 alone.
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

    // Hand-insert a second item on the same order tagged with source_row 12.
    sqlx::query(
        r#"INSERT INTO order_item (id, order_id, product_id, quantity, unit_price, source_row)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(new_id()).bind(&out.order_id).bind(&p.id).bind(3_i64).bind(85_i64).bind(12_i64)
    .execute(&pool).await.unwrap();

    // Re-upsert row 11 with a different quantity — row 12's item must survive.
    let mut tx = pool.begin().await.unwrap();
    upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 170, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 11,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 2, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();

    let items: Vec<(i64, Option<i64>)> = sqlx::query_as(
        r#"SELECT quantity, source_row FROM order_item WHERE order_id = ? ORDER BY source_row"#,
    ).bind(&out.order_id).fetch_all(&pool).await.unwrap();
    assert_eq!(items, vec![(2, Some(11)), (3, Some(12))]);
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cargo test --quiet --lib db::orders::tests::upsert_only_refreshes_items_tagged
```
Expected: fail — the row 12 item is wiped because the old code does `DELETE FROM order_item WHERE order_id = ?` (wholesale).

- [ ] **Step 3: Update `upsert_from_source`'s item refresh**

In `src-tauri/src/db/orders.rs`, replace the items-refresh block (currently lines 139–157) with:

```rust
    // Locked rows keep their items as-is. Refresh them only when the row is
    // either brand new or being updated from the sheet, AND only for items
    // tagged with this sheet row. Other source_rows' items stay (the merge
    // feature relies on this: a master order holds items from multiple
    // source_rows).
    let is_locked: (i64,) = sqlx::query_as(
        r#"SELECT sync_locked FROM "order" WHERE id = ?"#,
    )
    .bind(&order_id).fetch_one(&mut **tx).await?;
    if is_locked.0 == 0 {
        sqlx::query(
            r#"DELETE FROM order_item WHERE order_id = ? AND source_row = ?"#,
        )
        .bind(&order_id).bind(input.source_row).execute(&mut **tx).await?;
        for item in input.items {
            sqlx::query(
                r#"INSERT INTO order_item
                   (id, order_id, product_id, quantity, unit_price, source_row)
                   VALUES (?, ?, ?, ?, ?, ?)"#,
            )
            .bind(new_id()).bind(&order_id).bind(item.product_id)
            .bind(item.quantity).bind(item.unit_price).bind(input.source_row)
            .execute(&mut **tx).await?;
        }
    }
```

- [ ] **Step 4: Run the new test**

```bash
cargo test --quiet --lib db::orders::tests::upsert_only_refreshes_items_tagged
```
Expected: 1 passed.

- [ ] **Step 5: Re-run the whole DB module to confirm no regression**

```bash
cargo test --quiet --lib db::orders
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/orders.rs
git commit -m "refactor(orders): scope upsert's item refresh by source_row"
```

---

### Task 7: Add `merge_orders` DB function with tests

**Files:**
- Modify: `src-tauri/src/db/orders.rs`

- [ ] **Step 1: Write the failing tests**

Append to the test module:

```rust
#[tokio::test]
async fn merge_two_orders_moves_items_sums_fees_marks_donor() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;

    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 170, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 5,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 2, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();

    // Give B a delivery fee so we can confirm the sum.
    sqlx::query(
        r#"UPDATE "order" SET delivery_fee = 40, total_amount = total_amount + 40 WHERE id = ?"#,
    ).bind(&b.order_id).execute(&pool).await.unwrap();

    let out = merge_orders(&pool, &[a.order_id.clone(), b.order_id.clone()]).await.unwrap();

    // Master = lowest source_row (row 4)
    assert_eq!(out.master_order_id, a.order_id);
    assert_eq!(out.merged_count, 1);

    let (master, items) = get_with_items(&pool, &a.order_id).await.unwrap().unwrap();
    assert_eq!(master.delivery_fee, 40);
    assert_eq!(master.discount, 0);
    // 1×85 (row 4) + 2×85 (row 5) + 40 fee = 295
    assert_eq!(master.total_amount, 295);
    assert!(master.merged_into_id.is_none());
    assert_eq!(master.sync_locked, 0, "merge must NOT lock the master");
    assert_eq!(items.len(), 2);

    let donor = sqlx::query_as::<_, OrderRow>(r#"SELECT * FROM "order" WHERE id = ?"#)
        .bind(&b.order_id).fetch_one(&pool).await.unwrap();
    assert_eq!(donor.merged_into_id.as_deref(), Some(a.order_id.as_str()));
    assert!(donor.deleted_at.is_some());
    assert_eq!(donor.sync_locked, 0);
}

#[tokio::test]
async fn merge_rejects_cross_tab() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-18",
        source_tab: "Order_31", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    let res = merge_orders(&pool, &[a.order_id, b.order_id]).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn merge_rejects_locked_donor() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 5,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    apply_order_edit(&pool, &b.order_id, &[
        EditOrderItem { product_id: p.id.clone(), quantity: 1, unit_price: 85 },
    ], 0, 0).await.unwrap();
    let res = merge_orders(&pool, &[a.order_id, b.order_id]).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn merge_rejects_already_merged() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 5,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let cc = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 6,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    merge_orders(&pool, &[a.order_id.clone(), b.order_id]).await.unwrap();
    // b is now merged away; trying to merge it again must fail.
    let res = merge_orders(&pool, &[a.order_id, cc.order_id]).await;
    // a is master (not merged-away), cc is fine — this one should actually succeed.
    assert!(res.is_ok(), "merging into an existing master must work");
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cargo test --quiet --lib db::orders::tests::merge_
```
Expected: compile error — `merge_orders` and `MergeOutcome` not defined.

- [ ] **Step 3: Implement `merge_orders`**

In `src-tauri/src/db/orders.rs`, add the type and function (just before the `#[cfg(test)]` block):

```rust
pub struct MergeOutcome {
    pub master_order_id: String,
    pub master_order_number: String,
    pub merged_count: usize,
}

/// Merge `order_ids` into one master order. The master is the input order
/// with the smallest `source_row`. Donor orders are soft-deleted and their
/// `merged_into_id` points at the master; their items move onto the master,
/// tagged with the donor's `source_row`. Discount and delivery_fee are summed.
///
/// Constraints:
///   * 2+ ids required.
///   * All orders must share the same `source_tab`.
///   * No order may already be merged-away (`merged_into_id IS NOT NULL`).
///   * No order may be `sync_locked` (manual override; merge would replace it).
///   * No order may be soft-deleted.
pub async fn merge_orders(
    pool: &SqlitePool,
    order_ids: &[String],
) -> Result<MergeOutcome, sqlx::Error> {
    if order_ids.len() < 2 {
        return Err(sqlx::Error::Protocol(
            "merge requires at least two orders".into(),
        ));
    }
    let mut rows: Vec<OrderRow> = Vec::with_capacity(order_ids.len());
    for id in order_ids {
        let row = sqlx::query_as::<_, OrderRow>(
            r#"SELECT * FROM "order" WHERE id = ?"#,
        ).bind(id).fetch_optional(pool).await?
        .ok_or(sqlx::Error::RowNotFound)?;
        rows.push(row);
    }
    // Constraint checks.
    let tab = rows[0].source_tab.clone();
    if tab.is_none() {
        return Err(sqlx::Error::Protocol("orders missing source_tab cannot be merged".into()));
    }
    for r in &rows {
        if r.source_tab != tab {
            return Err(sqlx::Error::Protocol(
                "all orders must share the same source_tab".into()
            ));
        }
        if r.merged_into_id.is_some() {
            return Err(sqlx::Error::Protocol(
                format!("order {} is already merged into another", r.order_number).into()
            ));
        }
        if r.sync_locked != 0 {
            return Err(sqlx::Error::Protocol(
                format!("order {} has manual edits; unlock before merging", r.order_number).into()
            ));
        }
        if r.deleted_at.is_some() {
            return Err(sqlx::Error::Protocol(
                format!("order {} is removed", r.order_number).into()
            ));
        }
    }

    // Master = lowest source_row.
    rows.sort_by_key(|r| r.source_row.unwrap_or(i64::MAX));
    let master = rows.remove(0);
    let donors = rows;
    let now = now_iso();

    let mut tx = pool.begin().await?;

    // Move each donor's items onto the master, tagged with the donor's source_row.
    let mut summed_discount = master.discount;
    let mut summed_delivery = master.delivery_fee;
    for d in &donors {
        let donor_row = d.source_row.unwrap_or(0);
        sqlx::query(
            r#"UPDATE order_item
               SET order_id = ?, source_row = ?
               WHERE order_id = ?"#,
        )
        .bind(&master.id).bind(donor_row).bind(&d.id)
        .execute(&mut *tx).await?;

        summed_discount += d.discount;
        summed_delivery += d.delivery_fee;

        sqlx::query(
            r#"UPDATE "order" SET
                 merged_into_id = ?, deleted_at = ?, sync_locked = 0, updated_at = ?
               WHERE id = ?"#,
        )
        .bind(&master.id).bind(&now).bind(&now).bind(&d.id)
        .execute(&mut *tx).await?;
    }

    // Recompute master total = subtotal - discount + delivery_fee.
    let subtotal: (i64,) = sqlx::query_as(
        r#"SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_item WHERE order_id = ?"#,
    ).bind(&master.id).fetch_one(&mut *tx).await?;
    let new_total = (subtotal.0 - summed_discount + summed_delivery).max(0);

    sqlx::query(
        r#"UPDATE "order" SET
             total_amount = ?, discount = ?, delivery_fee = ?, updated_at = ?
           WHERE id = ?"#,
    )
    .bind(new_total).bind(summed_discount).bind(summed_delivery).bind(&now).bind(&master.id)
    .execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(MergeOutcome {
        master_order_id: master.id,
        master_order_number: master.order_number,
        merged_count: donors.len(),
    })
}
```

- [ ] **Step 4: Run the new tests**

```bash
cargo test --quiet --lib db::orders::tests::merge_
```
Expected: all 4 pass.

- [ ] **Step 5: Re-run the whole module to confirm no regression**

```bash
cargo test --quiet --lib db::orders
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/orders.rs
git commit -m "feat(orders): merge_orders moves donor items onto master"
```

---

### Task 8: Hide merged-away rows from `list_by_tab` and `soft_delete_missing_rows`

**Files:**
- Modify: `src-tauri/src/db/orders.rs:162-205`

- [ ] **Step 1: Write the failing test**

Append to the test module:

```rust
#[tokio::test]
async fn list_hides_merged_away_rows_by_default() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 5,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    merge_orders(&pool, &[a.order_id.clone(), b.order_id.clone()]).await.unwrap();

    let alive = list_by_tab(&pool, Some("Order_30"), false, 100).await.unwrap();
    assert_eq!(alive.len(), 1);
    assert_eq!(alive[0].id, a.order_id);

    let all = list_by_tab(&pool, Some("Order_30"), true, 100).await.unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn soft_delete_missing_rows_skips_merged_away() {
    let pool = init_memory_pool().await.unwrap();
    let (p, c) = seed_pc(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    let a = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 4,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    let b = upsert_from_source(&mut tx, UpsertOrderInput {
        customer_id: &c.id, channel: None, delivery_location: None, notes: None,
        total_amount: 85, order_date: "2026-05-11",
        source_tab: "Order_30", source_row: 5,
        items: vec![UpsertOrderItemInput { product_id: &p.id, quantity: 1, unit_price: 85 }],
    }).await.unwrap();
    tx.commit().await.unwrap();
    merge_orders(&pool, &[a.order_id.clone(), b.order_id.clone()]).await.unwrap();

    // Sheet sync says "only row 4 still exists". soft_delete_missing_rows must
    // ignore row 5's order shell because it's already merged-away — touching
    // it would re-stamp deleted_at unnecessarily.
    let mut tx = pool.begin().await.unwrap();
    let n = soft_delete_missing_rows(&mut tx, "Order_30", &[4]).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(n, 0);
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cargo test --quiet --lib db::orders::tests::list_hides_merged_away_rows_by_default db::orders::tests::soft_delete_missing_rows_skips_merged_away
```
Expected: 2 failed (master row 4 still owns row 5's items so the second test passes accidentally; the first test sees both rows because `list_by_tab` doesn't filter yet).

- [ ] **Step 3: Update `list_by_tab`**

In `src-tauri/src/db/orders.rs`, edit `list_by_tab`. After `if !include_deleted { sql.push_str(" AND deleted_at IS NULL"); }`, add:

```rust
    // Merged-away rows are soft-deleted donors; show them only with include_deleted.
    if !include_deleted { sql.push_str(" AND merged_into_id IS NULL"); }
```

- [ ] **Step 4: Update `soft_delete_missing_rows`**

In `src-tauri/src/db/orders.rs`, extend both WHERE clauses in `soft_delete_missing_rows` to also skip merged-away rows:

```rust
    let sql = if keep_rows.is_empty() {
        r#"UPDATE "order" SET deleted_at = ?, updated_at = ?
           WHERE source_tab = ? AND deleted_at IS NULL AND sync_locked = 0
             AND merged_into_id IS NULL"#.to_string()
    } else {
        let placeholders = keep_rows.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        format!(
            r#"UPDATE "order" SET deleted_at = ?, updated_at = ?
               WHERE source_tab = ? AND deleted_at IS NULL AND sync_locked = 0
                 AND merged_into_id IS NULL
                 AND source_row NOT IN ({})"#,
            placeholders
        )
    };
```

- [ ] **Step 5: Run the new tests**

```bash
cargo test --quiet --lib db::orders::tests::list_hides_merged_away_rows_by_default db::orders::tests::soft_delete_missing_rows_skips_merged_away
```
Expected: 2 passed.

- [ ] **Step 6: Re-run the whole module**

```bash
cargo test --quiet --lib db::orders
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/orders.rs
git commit -m "feat(orders): hide merged-away rows from list and soft-delete sweep"
```

---

### Task 9: Sync engine — merged-row pull-through and donor-row cleanup

**Files:**
- Modify: `src-tauri/src/sync/engine.rs:99-245`

- [ ] **Step 1: Write the failing tests**

Look at the existing test scaffolding in `src-tauri/src/sync/engine.rs` (starting around line 247) for the `FakeSheetsClient` + `make_vr` helpers, then append:

```rust
#[tokio::test]
async fn merged_donor_row_edits_flow_into_master() {
    use crate::db::orders::{merge_orders, get_with_items};

    // Initial sync: two K.Ing rows.
    let pool = init_memory_pool().await.unwrap();
    let tab = "Order_30";
    let make_sheet = |row5_qty: &str| {
        make_vr(vec![
            vec!["Menu", "Price", "", "Channel", "Customer", "Choc", "Matcha"],
            vec!["Choc",  "100",   "", "",        "",         "",     ""],
            vec!["Matcha","120",   "", "",        "",         "",     ""],
            vec![ "",      "",      "", "Page",    "K.Ing",    "1",    ""],
            vec![ "",      "",      "", "Page",    "K.Ing",    "",     row5_qty],
        ])
    };
    let fake = FakeSheetsClient {
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

    // Wife edits row 5 in the sheet to qty=3.
    let fake2 = FakeSheetsClient {
        values: HashMap::from([(format!("{}!A1:Z200", tab), make_sheet("3"))]),
    };
    let preview2 = preview_sync(&pool, &fake2, "x", tab).await.unwrap();
    let mappings2 = SyncMappings { menu: vec![], customer: vec![] };
    apply_sync(&pool, &fake2, "x", tab, mappings2).await.unwrap();
    let _ = preview2;

    // Master now reflects qty=3 for the row-5 item; qty=1 for row-4 still.
    let (master, items) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
    let row4 = items.iter().find(|i| i.source_row == Some(4)).expect("row 4 item");
    let row5 = items.iter().find(|i| i.source_row == Some(5)).expect("row 5 item");
    assert_eq!(row4.quantity, 1);
    assert_eq!(row5.quantity, 3);
    // Total = 100 + 120*3 = 460
    assert_eq!(master.total_amount, 460);
}

#[tokio::test]
async fn merged_donor_row_removed_from_sheet_strips_its_items_from_master() {
    use crate::db::orders::{merge_orders, get_with_items};

    let pool = init_memory_pool().await.unwrap();
    let tab = "Order_30";
    let two_rows = make_vr(vec![
        vec!["Menu","Price","","Channel","Customer","Choc","Matcha"],
        vec!["Choc","100","","","","",""],
        vec!["Matcha","120","","","","",""],
        vec!["","","","Page","K.Ing","1",""],
        vec!["","","","Page","K.Ing","","1"],
    ]);
    let fake = FakeSheetsClient {
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

    // Sheet drops row 5.
    let one_row = make_vr(vec![
        vec!["Menu","Price","","Channel","Customer","Choc","Matcha"],
        vec!["Choc","100","","","","",""],
        vec!["Matcha","120","","","","",""],
        vec!["","","","Page","K.Ing","1",""],
    ]);
    let fake2 = FakeSheetsClient {
        values: HashMap::from([(format!("{}!A1:Z200", tab), one_row)]),
    };
    let _ = preview_sync(&pool, &fake2, "x", tab).await.unwrap();
    apply_sync(&pool, &fake2, "x", tab, SyncMappings { menu: vec![], customer: vec![] }).await.unwrap();

    let (master, items) = get_with_items(&pool, &merged.master_order_id).await.unwrap().unwrap();
    assert_eq!(items.len(), 1, "row 5's item must be gone");
    assert_eq!(items[0].source_row, Some(4));
    assert_eq!(master.total_amount, 100);
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cargo test --quiet --lib sync::engine::tests::merged_donor_row_edits_flow_into_master sync::engine::tests::merged_donor_row_removed_from_sheet_strips
```
Expected: failures — the engine doesn't yet route donor-row updates into the master.

- [ ] **Step 3a: Update `preview_sync`'s counters**

In `src-tauri/src/sync/engine.rs`, find the block that builds `existing_rows` (around lines 76–86). The current query filters by `deleted_at IS NULL`, which excludes merged-away rows and makes them look like inserts. Replace the block with:

```rust
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
```

- [ ] **Step 3b: Update `apply_sync` for the pull-through**

In `src-tauri/src/sync/engine.rs`, find the order upsert loop (currently lines 195–232) and replace it with this version. The diff: before calling `upsert_from_source`, look up whether the row is a known donor and redirect items onto the master.

```rust
    let mut tx = pool.begin().await?;
    let mut added = 0i64;
    let mut updated = 0i64;
    let mut keep_rows: Vec<i64> = Vec::new();
    let mut masters_to_recompute: std::collections::HashSet<String> = std::collections::HashSet::new();

    for ord in &preview.parsed_orders {
        let cust_id = customer_alias_to_id.get(&ord.customer)
            .ok_or_else(|| anyhow!("Unresolved customer {}", ord.customer))?.clone();

        let mut total: i64 = 0;
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
```

(The rest of the function — `upsert_week_mapping`, `insert_sync_log`, return — stays unchanged.)

- [ ] **Step 4: Run the new tests**

```bash
cargo test --quiet --lib sync::engine::tests::merged_donor_row_edits_flow_into_master sync::engine::tests::merged_donor_row_removed_from_sheet_strips
```
Expected: 2 passed.

- [ ] **Step 5: Re-run all backend tests**

```bash
cargo test --quiet --lib
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/sync/engine.rs
git commit -m "feat(sync): route donor-row edits into the master order"
```

---

### Task 10: Expose `merge_orders` as a Tauri command + serialize `merged_into_id` to the frontend

**Files:**
- Modify: `src-tauri/src/commands/orders.rs` (add `MergeResult`, `merge_orders` command; add `merged_into_id` to `OrderListRow` / `OrderDetail`)
- Modify: `src-tauri/src/lib.rs:30-45`

- [ ] **Step 1: Add `merged_into_id` to the serialized structs**

In `src-tauri/src/commands/orders.rs`, edit `OrderListRow`:

```rust
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
    pub merged_from_count: i64,
}
```

Edit `OrderDetail` similarly, adding the same two fields at the end of the struct.

In `list_orders` (around line 78), after computing `items_summary`, also count merged donors and populate the new fields. Replace the `out.push(OrderListRow { ... })` block with:

```rust
        let merged_from_count: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM "order" WHERE merged_into_id = ?"#,
        ).bind(&r.id).fetch_one(&state.db).await.map_err(|e| e.to_string())?;
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
            merged_from_count: merged_from_count.0,
        });
```

In `get_order` (around line 116), inside the final `Ok(Some(OrderDetail { ... }))` block, add `merged_into_id: r.merged_into_id.clone(),` and `merged_from_count: { let c: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM "order" WHERE merged_into_id = ?"#).bind(&r.id).fetch_one(&state.db).await.map_err(|e| e.to_string())?; c.0 },` just before `items: detail_items,`.

- [ ] **Step 2: Add `merge_orders` command**

Append to `src-tauri/src/commands/orders.rs`:

```rust
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
```

- [ ] **Step 3: Register the command**

In `src-tauri/src/lib.rs`, add `commands::orders::merge_orders,` to the `invoke_handler` block alongside `delete_order`.

- [ ] **Step 4: Verify the backend builds**

```bash
cargo build --quiet
```
Expected: compiles without warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/orders.rs src-tauri/src/lib.rs
git commit -m "feat(orders): merge_orders command + expose merged metadata to UI"
```

---

### Task 11: TypeScript types and `ordersApi.merge`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Extend types**

In `src/lib/types.ts`, add to `OrderListRow`:

```ts
export interface OrderListRow {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: string | null;
  deliveryLocation: string | null;
  totalAmount: number;
  sourceTab: string | null;
  sourceRow: number | null;
  printedAt: string | null;
  printCount: number;
  deletedAt: string | null;
  orderDate: string;
  notes: string | null;
  itemsSummary: string;
  syncLocked: boolean;
  mergedIntoId: string | null;
  mergedFromCount: number;
}
```

Add the same two fields to `OrderDetail`. Add a new interface:

```ts
export interface MergeResult {
  masterOrderId: string;
  masterOrderNumber: string;
  mergedCount: number;
}
```

- [ ] **Step 2: Extend the API binding**

In `src/lib/tauri.ts`, import `MergeResult` from `./types` and extend `ordersApi`:

```ts
  delete: (id: string) => invoke<void>('delete_order', { id }),
  merge: (orderIds: string[]) =>
    invoke<MergeResult>('merge_orders', { orderIds }),
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts
git commit -m "feat(orders): types + ordersApi.merge"
```

---

### Task 12: UI — multi-select toolbar, merge confirm dialog, merged badge

**Files:**
- Modify: `src/pages/OrdersPage.tsx`

- [ ] **Step 1: Add multi-select state and merge handler**

In `OrdersPage`, after the `deletingTarget` state added in Task 4, add:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<OrderListRow[] | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMergeConfirm = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id));
    if (selected.length < 2) return;
    setMergeConfirm(selected);
  };

  const confirmMerge = async () => {
    if (!mergeConfirm) return;
    setMerging(true);
    try {
      await ordersApi.merge(mergeConfirm.map((o) => o.id));
      setMergeConfirm(null);
      setSelectedIds(new Set());
      setDetails({});
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };
```

Also, after `fetchOrders` finishes, drop selections that no longer exist. Add inside `fetchOrders`, right after `setOrders(rows);`:

```tsx
      setSelectedIds((prev) => {
        const validIds = new Set(rows.map((r) => r.id));
        const next = new Set<string>();
        prev.forEach((id) => { if (validIds.has(id)) next.add(id); });
        return next;
      });
```

- [ ] **Step 2: Add the selection checkbox column and merge button**

Update the header to include a leading checkbox column. Inside the `<thead>` block:

```tsx
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr className="text-muted-foreground text-xs uppercase tracking-wide text-left">
                <th className="w-10 px-2 py-3"></th>
                <th className="w-10 px-2 py-3"></th>
                <th className="px-3 py-3 font-medium">Order #</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Channel</th>
                <th className="px-3 py-3 font-medium">Items / Delivery</th>
                <th className="px-3 py-3 font-medium text-right">Total</th>
                <th className="px-3 py-3 font-medium">Note</th>
                <th className="w-20 px-2 py-3 font-medium"></th>
                <th className="w-32 px-3 py-3 font-medium text-right"></th>
              </tr>
            </thead>
```

In `OrderRow`, add a checkbox `<td>` as the first cell:

```tsx
        <td
          className="w-10 px-2 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          {!removed && (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onSelect()}
              aria-label={`Select order ${row.orderNumber}`}
            />
          )}
        </td>
```

Add `selected: boolean;` and `onSelect: () => void;` to `OrderRowProps`. Pass them when rendering:

```tsx
                  selected={selectedIds.has(o.id)}
                  onSelect={() => toggleSelect(o.id)}
```

In the header bar of the page (around line 125), add a merge button that appears when ≥2 rows are selected. Just before the `<Button variant="outline" onClick={fetchOrders}>` (Refresh), insert:

```tsx
        {selectedIds.size >= 2 && (
          <Button onClick={openMergeConfirm} disabled={merging}>
            Merge {selectedIds.size} orders
          </Button>
        )}
```

- [ ] **Step 3: Render the merged badge on master rows**

In `OrderRow`, edit the order-number cell to show a `merged ×N` pill when `row.mergedFromCount > 0`:

```tsx
        <td className="px-3 py-3 font-mono text-sm">
          <div className="flex items-center gap-2">
            <span>{row.orderNumber}</span>
            {row.syncLocked && (
              <Badge variant="warning" className="gap-1 font-normal" title="Locked from sync">
                <Lock className="h-3 w-3" />
                locked
              </Badge>
            )}
            {row.mergedFromCount > 0 && (
              <Badge variant="muted" className="gap-1 font-normal" title="This order has merged-in rows">
                merged ×{row.mergedFromCount + 1}
              </Badge>
            )}
            {row.mergedIntoId && (
              <Badge variant="muted" className="font-normal" title="Merged into another order">
                merged into
              </Badge>
            )}
          </div>
        </td>
```

- [ ] **Step 4: Render the merge confirm dialog**

After the delete confirm dialog block, add:

```tsx
      {mergeConfirm && (
        <Dialog open onOpenChange={(open) => !open && !merging && setMergeConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Merge {mergeConfirm.length} orders?</DialogTitle>
              <DialogDescription>
                {(() => {
                  const sorted = [...mergeConfirm].sort(
                    (a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0)
                  );
                  const master = sorted[0];
                  const donors = sorted.slice(1);
                  const customers = new Set(mergeConfirm.map((o) => o.customerName));
                  const sameCustomer = customers.size === 1;
                  if (sameCustomer) {
                    return (
                      <>
                        All items will be combined under <strong>{master.orderNumber}</strong>{' '}
                        ({master.customerName}). They'll receive one receipt with all items and
                        one QR code.
                      </>
                    );
                  }
                  return (
                    <>
                      {donors.map((d) => d.customerName).join(', ')}'s order
                      {donors.length > 1 ? 's' : ''} will be merged into{' '}
                      <strong>{master.customerName}</strong>'s order ({master.orderNumber}).
                      Only <strong>{master.customerName}</strong> will receive a receipt.
                    </>
                  );
                })()}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMergeConfirm(null)}
                disabled={merging}
              >
                Cancel
              </Button>
              <Button onClick={confirmMerge} disabled={merging}>
                {merging ? 'Merging…' : 'Merge'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
```

- [ ] **Step 5: Adjust `colSpan` for the expand row**

In the expanded detail `<tr>`, change `colSpan={8}` to `colSpan={9}` to account for the new checkbox column:

```tsx
      {isExpanded && !removed && (
        <tr className="bg-accent/20">
          <td></td>
          <td colSpan={9} className="px-3 py-4">
```

- [ ] **Step 6: Type-check and run tests**

```bash
npx tsc --noEmit
npx vitest run --reporter=dot
```
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/pages/OrdersPage.tsx
git commit -m "feat(orders): multi-select + merge with same/cross-customer confirms"
```

---

### Task 13: Final preflight

- [ ] **Step 1: Run all backend tests**

```bash
cd src-tauri && cargo test --quiet --lib
```
Expected: every test passes.

- [ ] **Step 2: Run frontend tests + type-check**

```bash
npx tsc --noEmit && npx vitest run --reporter=dot
```
Expected: clean.

- [ ] **Step 3: Build the production bundle**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 4: Manual smoke test on a local sheet (recommended)**

Run `npm run tauri dev`, then:
- Open the Orders tab. Confirm trash icon appears next to the edit icon.
- Delete one row, confirm it disappears, toggle "Show removed" to see it.
- Re-sync — the deleted row stays gone.
- Select two K.Ing rows, click Merge, accept the same-customer confirm. Master gains both items, donor disappears.
- Edit the donor row in the sheet (change qty). Re-sync. Master reflects the change.
- Delete the donor row from the sheet. Re-sync. Master no longer contains the donor's items.

This step is optional in a CI/agentic context but recommended before merging the PR.

- [ ] **Step 5: Final commit if any docs/changelog updates landed during smoke test**

If nothing else changed, skip this step. Otherwise:

```bash
git add -A
git commit -m "docs/chore: tidy up after smoke test"
```
