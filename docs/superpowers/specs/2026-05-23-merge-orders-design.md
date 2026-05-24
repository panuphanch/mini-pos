# Merge Orders & Delete Row — Design

**Date:** 2026-05-23
**Status:** Approved for planning
**Brainstorm:** [`docs/brainstorms/2026-05-23-duplicate-rows.html`](../../brainstorms/2026-05-23-duplicate-rows.html)

## Problem

The cashier (wife) sometimes writes one customer across multiple rows in the
Google Sheet so the kitchen prepares each cake separately. At checkout the
customer pays once and wants **one receipt** with both items. Today every sheet
row becomes its own order with its own receipt and QR code, so the cashier has
no way to combine them. There is also no way to remove an accidental duplicate
row from the app.

The Google Sheet is the source of truth for orders. Anything we do in-app must
survive `Re-sync` without silently undoing itself.

## Scope

This spec covers two related features:

1. **Delete row** (Phase 1) — soft-delete a single order from the Orders list.
2. **Merge orders** (Phase 2) — combine 2+ orders into one master order whose
   line items keep flowing from their original sheet rows.

Out of scope:

- **Un-merge button.** Deferred. The merge confirm dialog is expected to catch
  accidents. We can add un-merge later if the need is real.
- **Group / link without merging** (Option C from the brainstorm). Deferred.
- **"Print together" without DB merge** (Option A). Deferred.

## Decisions

| Question | Decision |
| --- | --- |
| Block merge across different customer names? | No — lenient, with a confirm dialog. |
| Discount + delivery fee on merge | Sum both. If the cashier wants them split, she doesn't merge. |
| Master row deleted from sheet later | Remove its row-tagged items from master; soft-delete the master if nothing's left. Surface a sync notice. |
| Un-merge button | Defer to a later phase. |
| Sheet edits to a merged-away row | Flow through transparently into the master (see "Sync behavior" below). |

## Phase 1 — Delete a row

### UX

- Each row in the Orders list gets a trash icon next to the existing pencil
  (edit) icon. Disabled when the row is already soft-deleted.
- Clicking opens a confirm dialog: *"Remove this order from the list? It will
  be hidden but kept in the database. Re-sync will not bring it back."*
- After confirm: the row disappears unless `Show removed` is on.

### Data

No new columns. Re-uses existing `deleted_at` and `sync_locked` on `"order"`.

A user-initiated delete sets:

- `deleted_at = now()`
- `sync_locked = 1` (so the next sync doesn't resurrect it)
- `updated_at = now()`

### Commands

New Tauri command:

```rust
#[tauri::command]
pub async fn delete_order(order_id: String) -> Result<()>
```

Behavior:

- Returns an error if the order is already soft-deleted.
- Returns an error if the order has been merged into another order (Phase 2).

### Tests

- Soft-deleting a row hides it from `list_by_tab` with `include_deleted = false`.
- Re-sync does not resurrect the soft-deleted, locked row.
- A row that has been soft-deleted appears under `Show removed` with the
  "removed" badge that already exists.

## Phase 2 — Merge orders

### UX

- Orders list gets a leading checkbox column. Selecting ≥1 row reveals a
  toolbar with **Merge** and **Delete** actions.
- Merge is enabled when ≥2 rows are selected and none of them are already
  soft-deleted or merged-away.
- Master = the selected row with the lowest `source_row` (the earliest one).
- Confirm dialog before commit:
  - If all selected rows share the same customer:
    *"Merge 2 orders into Order_30-04 (K.Ing)? She'll receive one receipt with
    all items combined."*
  - If customers differ:
    *"Merge P.Som's order into K.Ing's order? P.Som's items will appear on
    K.Ing's combined receipt. P.Som will not receive a separate receipt."*
- After merge:
  - Master row shows a `merged ×N` pill next to its order number.
  - Merged-away rows are hidden by default; visible under `Show removed` with a
    `merged into <master_order_number>` badge.
  - Master's detail panel lists items grouped by their originating
    `source_row` (e.g. *"From row 04: Choc Lava ฿180 — From row 05: Matcha Roll
    ฿220"*).

### Data

**New column on `"order"`:**

```sql
ALTER TABLE "order" ADD COLUMN merged_into_id TEXT
    REFERENCES "order"(id);
CREATE INDEX idx_order_merged_into ON "order"(merged_into_id);
```

`merged_into_id IS NULL` for normal and master orders. Set on merged-away rows
to point at the master.

**New column on `order_item`:**

```sql
ALTER TABLE order_item ADD COLUMN source_row INTEGER;
```

Every item carries the `source_row` it was parsed from. For pre-migration
items, backfill from `"order".source_row` so existing data is consistent.

`source_tab` is not needed on `order_item` — all items in a single master order
necessarily belong to the same tab as the master, and merge across tabs is not
supported (see Constraints).

### Constraints

- Merge is only allowed for orders in the **same `source_tab`** (same week).
  Cross-week merge is rejected with a toast: *"Can't merge orders from
  different weeks."*
- Cannot merge an already-merged-away order. Cannot merge into a soft-deleted
  master.
- Locked orders (`sync_locked = 1`) cannot participate in a merge — the locked
  flag means the user has manually overridden values and merge would replace
  them. Reject with: *"Order_30-04 has manual edits; unlock it (or use only
  unlocked orders) before merging."*

### Commands

```rust
#[tauri::command]
pub async fn merge_orders(order_ids: Vec<String>) -> Result<MergeOutcome>

pub struct MergeOutcome {
    pub master_order_id: String,
    pub master_order_number: String,
    pub merged_count: usize,
}
```

Algorithm (inside one transaction):

1. Load all input orders. Validate constraints above.
2. Choose master = the order with the smallest `source_row`.
3. For each non-master order:
   - Re-parent items, tagging them with the donor's `source_row`:
     `UPDATE order_item SET order_id = <master>, source_row = <donor.source_row> WHERE order_id = <donor>`
     (the SET on `source_row` is a no-op if the migration backfill already set it correctly; doing it explicitly here is defensive against any edge where a manual edit dropped the tag).
   - Add the donor's `discount` and `delivery_fee` to the master.
   - Set on the donor: `merged_into_id = <master>`, `deleted_at = now()`,
     `sync_locked = 0`, `updated_at = now()`.
4. Recompute master's `total_amount`:
   `sum(items.unit_price * items.quantity) - discount + delivery_fee`.
5. Bump master's `updated_at`.

The master's `sync_locked` is **not** changed by merge. Merging is not a
manual edit — it's a regrouping. Sheet edits should keep flowing.

### Sync behavior changes

The sync engine's existing flow is "for each parsed sheet row, upsert by
`(source_tab, source_row)`". The merge feature changes how items are refreshed:
each sheet row only owns the items tagged with its own `source_row`, never
the whole order's items. This unifies the master and non-merged cases.

**Refactor `upsert_from_source`'s item refresh.** Today it does
`DELETE FROM order_item WHERE order_id = ?` (wipes all items) then inserts.
After this change, the delete is scoped:

```sql
DELETE FROM order_item WHERE order_id = ? AND source_row = ?
```

then inserts the freshly parsed items, each tagged with that `source_row`.
For non-merged orders this is identical to the old behavior (all items share
the same source_row as their parent order). For merged masters, items
contributed by other rows are preserved.

**Three additions to the sync engine:**

1. **Items tag.** Every item written by sync (insert or refresh) carries the
   `source_row` of the sheet row that produced it. Existing items get this
   via the migration backfill.

2. **Merged-row pull-through.** Before calling `upsert_from_source`, the
   engine looks up the order keyed by `(source_tab, source_row)`. If that
   order has `merged_into_id IS NOT NULL`:
   - Treat the master as the upsert target instead of the donor's order
     shell.
   - Run the same source_row-scoped delete-then-insert against the master,
     using the donor row's `source_row` as the tag.
   - Recompute master `total_amount` after the items change.
   - Do not touch the donor's own order row (it stays soft-deleted with
     `merged_into_id` intact).

3. **Merged-row deletion from the sheet.** The existing
   `soft_delete_missing_rows` skips locked rows. Extend it to also ignore
   rows with `merged_into_id` set (they're already soft-deleted). For each
   merged-away row whose sheet row has disappeared:
   - Delete items in the master tagged with that `source_row`.
   - Recompute master `total_amount`.
   - If the master now has zero items AND its own sheet row is also gone,
     soft-delete the master.

The preview command (`preview_sync`) needs the same logic in its counters so
the "+N / ~N / -N" numbers match what apply will do. A merged-away row whose
sheet row is unchanged counts as 0 (no-op); a changed merged-away row counts
as 1 update (against the master).

### List query change

`list_by_tab` adds `AND merged_into_id IS NULL` to the default WHERE so the
hidden donor rows don't show. Under `include_deleted = true` they show with the
`merged into <master_number>` badge so the cashier can audit.

### Tests

Database layer (`src-tauri/src/db/orders.rs`):

- Merging 2 orders moves items, sums discount + delivery_fee, sets
  `merged_into_id`, soft-deletes the donor.
- Merge rejects different `source_tab`s.
- Merge rejects locked donors.
- Merge rejects already-merged orders.
- Merging 3 orders with the same customer: master is the lowest source_row;
  items from all 3 land on master tagged with their original source_rows.

Sync engine (`src-tauri/src/sync/engine.rs`):

- After merge, re-sync with the same sheet data is a no-op (items, totals,
  merged_into_id all stable).
- After merge, editing the donor row in the sheet (adding an item) flows into
  the master: master gains the new item tagged with that source_row, total
  recomputed.
- After merge, deleting the donor row from the sheet removes its items from
  master and recomputes the total. Master itself survives if it still has
  items.
- After merge, deleting both donor and master rows from the sheet
  soft-deletes the master.
- Re-syncing does NOT resurrect a merged-away row's own order shell.

Frontend (`src/pages/OrdersPage.tsx`):

- Selecting ≥2 rows reveals the merge toolbar.
- Same-customer merge confirm vs. cross-customer merge confirm differ in
  wording.
- Merged orders show `merged ×N` pill and grouped item breakdown in detail
  panel.

## Migration

One new migration file:

```text
src-tauri/src/db/migrations/0003_merge_orders.sql
```

Contents:

1. `ALTER TABLE "order" ADD COLUMN merged_into_id TEXT REFERENCES "order"(id);`
2. `CREATE INDEX idx_order_merged_into ON "order"(merged_into_id);`
3. `ALTER TABLE order_item ADD COLUMN source_row INTEGER;`
4. Backfill: `UPDATE order_item SET source_row = (SELECT source_row FROM "order" WHERE "order".id = order_item.order_id);`

No data loss. Existing orders keep working exactly as before; the new columns
are inert until a merge is performed.

## Open items deliberately not designed

- **Customer-rename propagation:** if a donor row's customer is renamed in the
  sheet after merge, we keep the master's customer (master is the donor row's
  master). No warning. Document this in the user-facing help when we add one.
- **Reports / analytics:** there are none today. When they're added, a
  merged-away row should not be counted separately; treating
  `merged_into_id IS NOT NULL` as "not a real order" handles this.
- **Status bar warnings about merged orders:** none beyond what already
  exists. If we discover the cashier needs explicit notifications ("this
  merged order changed during sync"), we can add them later from the same
  `sync_log` surface that exists today.

## Phasing

| Phase | Effort | Scope |
| --- | --- | --- |
| 1 — Delete row | ~½ day | Trash icon, confirm dialog, `delete_order` command, tests. |
| 2 — Merge orders | ~1.5 days | Migration, `merge_orders` command, sync changes, list filter, UI toolbar, confirm dialogs, tests. |

Phases ship independently. Phase 1 has no dependency on Phase 2.
