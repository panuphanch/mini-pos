# Sheet Sync + Local Store Design

**Date:** 2026-05-16
**Status:** Approved (pending implementation plan)
**Author:** Panuphan Chaimanee, with Claude

## Summary

Replace mini-pos's broken dependency on the unfinished `grannys-ledger` REST API with a self-contained local SQLite store fed by manual syncs from the Google Sheet that the user's wife already uses as the upstream order tracker (`GrannySaidso Order`). The schema mirrors `grannys-ledger`'s Prisma types so a future export-to-API step is mechanical.

## Context

- mini-pos was just rewritten as a Tauri v2 + React + TS + Rust desktop app (commits `b40dffd` → `82ab139`).
- Today's app expects a running `grannys-ledger` REST API at `apiUrl`. That project is unstable and its DB is not ready, so mini-pos effectively cannot list products, customers, or orders right now.
- Receipt printing is local (Rust, escpos, PromptPay QR) and works.
- The wife is the source of truth: she logs every order into a weekly Google Sheet. mini-pos is opened only to print receipts. Today the user manually re-enters Sheet rows into mini-pos to print; this design replaces that manual step.
- The wife's menu names drift week to week (Thai vs English, rewording). Within a single weekly tab the names are consistent because they appear once in the top menu table and as column headers in the order table.

### Sheet structure (single tab per week, e.g. `Order_30`)

Top section — **Menu table**, columns:

| Menu (A–B merged) | Total (C) | Left (D) | Price (E) |
|-------------------|-----------|----------|-----------|

Bottom section — **Order table**, header at the first row whose column A is `ช่องทาง`:

| ช่องทาง (channel) | ลูกค้า (customer) | menu col 1 | … menu col N | สถานที่ส่ง | Note |
|-------------------|------------------|------------|--------------|-----------|------|

- Menu column headers are the same names as the top table, in the same order.
- Cell values under menu columns are integer quantities (blank = 0).
- Red conditional formatting means qty exceeds stock-Left — informational only.
- No per-row date column. Tab name encodes the week.
- No order ID column.
- Note column holds free-text status the wife maintains (`Packed`, `รอส่งยอด` …).
- Channel values seen: `Page`, `Linea`, `DM`.

## Goals

1. mini-pos works without `grannys-ledger`. Pure local SQLite is the source of truth for the POS.
2. Manual `Sync now` pulls a chosen Sheet tab → local DB. Re-runnable multiple times per week.
3. New menu names and new customer names from the Sheet are mapped to canonical local entities via a search-and-create UI; mappings persist as aliases.
4. Local schema matches `grannys-ledger`'s Prisma shapes so a future migration is a straight export.
5. Receipt printing flows from a list of locally-synced orders, not from ad-hoc cart entries (though the ad-hoc path remains for off-Sheet emergencies).

## Non-goals (explicitly out of scope)

- Writeback to the Sheet (no `Printed` marker, no status column edits).
- Auto-sync, polling, or background fetch.
- Live export to `grannys-ledger` API. The export tool is a separate later project.
- Editing orders inside mini-pos. The Sheet stays canonical.
- Stock tracking (the `Total` / `Left` columns are read for price only).
- Customer rollups (`totalSpent`, `orderCount`) on the local side.
- Multi-week reporting / dashboards.
- Multi-workbook or multi-shop.

## Architecture

```
┌────────────────────── mini-pos (Tauri) ─────────────────────┐
│                                                             │
│  React UI (TS)  ──invoke──►  Rust commands                  │
│   - Sync screen               - sync_week                   │
│   - Mapping form              - apply_sync                  │
│   - Orders/Print              - list_orders                 │
│   - Settings                  - print_order                 │
│                               - search_products             │
│                               - search_customers            │
│                               - test_sheets_connection      │
│                               - load_config / save_config   │
│                               - print_receipt (existing)    │
│                                       │                     │
│                                       ▼                     │
│                          Rust core                          │
│                           - sheets client (sheets4)         │
│                           - sync engine                     │
│                           - sqlx + SQLite (WAL)             │
│                           - printer (existing)              │
│                                       │                     │
│   app data dir (Tauri-resolved per platform):               │
│     - config.json                                           │
│     - service-account.json   (chmod 600)                    │
│     - pos.sqlite                                            │
└─────────────────────────────────────────────────────────────┘
        ▲
        │ Google Sheets API v4 (read-only)
        ▼
   GrannySaidso Order Sheet
```

The renderer never holds Google credentials and never opens the SQLite file directly — only typed Tauri commands cross the boundary.

## Data model

SQLite, `sqlx` migrations. IDs are TEXT (cuid-style) so they survive a future export into `grannys-ledger` without remapping. Currency stored as integer **satang** to avoid float drift.

```sql
CREATE TABLE product (
    id              TEXT PRIMARY KEY,
    name_th         TEXT NOT NULL,
    name_en         TEXT,
    selling_price   INTEGER NOT NULL,          -- satang
    category        TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    image_url       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE customer (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    nickname        TEXT,
    phone           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE product_alias (
    id              TEXT PRIMARY KEY,
    alias           TEXT NOT NULL UNIQUE,      -- exact string from sheet header
    product_id      TEXT NOT NULL REFERENCES product(id),
    created_at      TEXT NOT NULL
);

CREATE TABLE customer_alias (
    id              TEXT PRIMARY KEY,
    alias           TEXT NOT NULL UNIQUE,      -- exact string from sheet customer cell
    customer_id     TEXT NOT NULL REFERENCES customer(id),
    created_at      TEXT NOT NULL
);

CREATE TABLE "order" (
    id                  TEXT PRIMARY KEY,
    order_number        TEXT NOT NULL UNIQUE,  -- "<tab>-<seq>", stable across re-syncs
    customer_id         TEXT NOT NULL REFERENCES customer(id),
    channel             TEXT,                  -- raw string: "Page", "Linea", "DM"…
    delivery_location   TEXT,
    notes               TEXT,                  -- verbatim Note column
    status              TEXT NOT NULL DEFAULT 'confirmed',
    total_amount        INTEGER NOT NULL,      -- satang
    discount            INTEGER NOT NULL DEFAULT 0,
    delivery_fee        INTEGER NOT NULL DEFAULT 0,
    order_date          TEXT NOT NULL,         -- ISO date, derived from tab → week start
    source_tab          TEXT,                  -- "Order_30", NULL for manual entry
    source_row          INTEGER,               -- sheet row index, NULL for manual entry
    synced_at           TEXT,
    printed_at          TEXT,
    print_count         INTEGER NOT NULL DEFAULT 0,
    deleted_at          TEXT,                  -- soft delete when row disappears
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (source_tab, source_row)
);

CREATE TABLE order_item (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
    product_id      TEXT NOT NULL REFERENCES product(id),
    quantity        INTEGER NOT NULL,
    unit_price      INTEGER NOT NULL           -- satang, captured at sync time from menu table
);

CREATE TABLE sync_log (
    id                  TEXT PRIMARY KEY,
    tab_name            TEXT NOT NULL,
    synced_at           TEXT NOT NULL,
    rows_added          INTEGER NOT NULL DEFAULT 0,
    rows_updated        INTEGER NOT NULL DEFAULT 0,
    rows_soft_deleted   INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL,         -- "success" | "error"
    error_message       TEXT
);

CREATE TABLE tab_week_mapping (
    tab_name        TEXT PRIMARY KEY,
    week_start_date TEXT NOT NULL              -- ISO date, Monday of the week
);
```

Alignment with `grannys-ledger` (from `src/lib/types.ts`):

- `product` ↔ `Product` (`id`, `nameTh`, `nameEn`, `sellingPrice`, `category`, `isActive`, `imageUrl`)
- `customer` ↔ `Customer` (`id`, `name`, `nickname`, `phone`)
- `order` + `order_item` ↔ `Order` + `OrderItem` (`OrderCreateInput` already names `customerId`, `platform`, `deliveryType`, `items[].productId/quantity/unitPrice`, `discount`, `deliveryFee`, `notes`)

`product_alias`, `customer_alias`, `sync_log`, `tab_week_mapping` are **mini-pos-only** — provenance for the sync. They do not migrate.

## Re-sync invariants

The natural key for a Sheet row is `(source_tab, source_row)`. A second sync on the same tab is idempotent:

- **New rows** the wife added → inserted with `synced_at = now`.
- **Existing rows** with changed qty / customer / channel / location / note → updated in place. The `order_items` for that order are deleted and re-inserted from the fresh parse. `updated_at` advances.
- **`printed_at` and `print_count` are never touched by sync.** A printed order stays printed even if its row is re-parsed.
- **Rows that disappear from the Sheet** → soft-deleted (`deleted_at` set). UI surfaces them in a "Removed in source" group so the user notices if they had already printed one.
- **Row inserted mid-week** (which shifts later rows down) → handled because the entire tab is re-parsed each sync and `order_number` is assigned on first sight (see below). The unique `(source_tab, source_row)` constraint means re-keyed rows look like updates; that's fine because content is what matters.
- **`order_number = "<tab>-<seq>"`**, where `seq` is assigned on first sight and stored. Stable across re-syncs even if the sheet row index shifts. Generated as `MAX(seq) + 1` within the same tab.

## Sync pipeline

Single Rust command: `sync_week(tab_name) -> SyncPreview`. No writes.

1. **Fetch tab.** One Sheets API call: `spreadsheets.values.get(spreadsheetId, "<tab>!A1:Z200")`.
2. **Parse top Menu table.** Walk rows from `A1` down until column A is blank. Skip the literal `Menu` header. Each row → `{ menu_name, total, left, price }`. This gives price per menu for this tab.
3. **Parse bottom Order table.**
   - Locate header row: first row where column A == `ช่องทาง`.
   - Columns: `A = channel`, `B = customer`, `C..N = menu names` (same order as top table), `N+1 = สถานที่ส่ง`, `N+2 = Note`.
   - Each subsequent non-empty row → `ParsedOrderRow { channel, customer_alias, items: [(menu_alias, qty)…], delivery_location, notes }`. Stop at first fully empty row.
4. **Reconcile names (read-only).**
   - For each menu header → look up `product_alias`; record unknown if missing.
   - For each customer name → look up `customer_alias`; record unknown if missing.
   - Build `SyncPreview { tab, week_start_date, unknown_menus, unknown_customers, parsed_orders, will_insert, will_update, will_soft_delete, parse_errors }`.
5. **Return `SyncPreview`** to TS. **No DB writes yet.**

User maps unknowns in the UI, then TS calls `apply_sync(tab, mappings)`:

```
BEGIN
  upsert product_alias rows from mappings.menu_mappings
  insert new products for "create new" choices (price = sheet menu price)
  upsert customer_alias rows
  insert new customers for "create new" choices
  for each parsed order:
    upsert "order" by (source_tab, source_row), assign/keep order_number
    delete then insert order_items
  soft-delete orders whose (source_tab, source_row) no longer appears
  insert sync_log row
COMMIT
```

On transaction failure: `ROLLBACK`, error returned to TS, preview state preserved so the user can retry without re-mapping.

## Mapping UI

Two stacked sections; same pattern for both:

```
─── Unknown menu names (3) ──────────────────────────────
  "มัทฉะเลเยอร์"         price ฿165 from sheet
    [ 🔍 search canonical product ▾ ]   [ + Create new ]

  "Matcha Layer"          price ฿165 from sheet
    [ 🔍 search… ▾ ]                    [ + Create new ]

─── Unknown customers (2) ───────────────────────────────
  "K.Parin"
    [ 🔍 search customer ▾ ]            [ + Create new ]

                          [ Apply mappings & sync ]
```

- Searchbox = controlled input, debounced (~200ms), calls `search_products(q)` / `search_customers(q)` Tauri commands → dropdown of matches showing `name_th / name_en` for products and `name / nickname` for customers.
- **Create new** opens a small inline form pre-filled: products `{ name_th = alias, selling_price = sheet price }`; customers `{ name = alias }`.
- The alias gets remembered automatically — no toggle needed; that is exactly what `product_alias` / `customer_alias` are.
- Apply button is disabled until every unknown is resolved (mapped or created).

### Customer name conventions

- Aliases preserve verbatim Sheet text including `K.`, `P'`, mixed Thai/Latin, italic-rendered names (text is unchanged by formatting).
- No auto-normalization on lookup. Silent merging of distinct customers who share a nickname is worse than asking once.
- The canonical `customer.name` can be a cleaner form chosen at "Create new" time; the messy original lives only in the alias.

## Tab discovery and date inference

- Default tab is the **last tab in workbook order** (Sheets API `spreadsheets.get` returns tabs in display order). That is almost always "this week".
- Settings override: `Latest tab` / `Pick from list` / `Pinned by name`.
- Date inference: parse `Order_<n>` as the ISO week number for the current year. `order_date = Monday of that week`. If unparseable, prompt the user once on first sync of that tab; persist into `tab_week_mapping`.

## Print flow

Today's `OrdersPage` (which fetches from the API) is rewritten to read locally:

```
Tab: [ Order_30 ▾ ]   ◯ Show all weeks            [ Sync now ]

┌────────────────────────────────────────────────────────────────┐
│ Row │ Channel │ Customer    │ Items                  │ Total │   │
├────────────────────────────────────────────────────────────────┤
│ 11  │ Page    │ K.Parin     │ ColCoco×1 ChocFudge×1  │  214  │ 🖨 │
│ 12  │ Page    │ แพรพร้อมเพิ่ม │ ColCoco×3 ChocFudge×2  │ 557 ⚠ │ 🖨 │
│ 13  │ Page    │ K.TK MC     │ ChocFudge×2            │  170  │ ✓ │
│ …   │         │             │                        │       │    │
└────────────────────────────────────────────────────────────────┘
              Legend:  🖨 print   ✓ printed (click to reprint)   ⚠ has parse warning
```

- Row expand: full items, delivery location, notes, sheet row, source tab, last printed.
- 🖨 → `print_order(order_id)`: Rust loads order + items + canonical product names + current shop/printer config, builds the existing `ReceiptData` struct, calls the existing `print_receipt`. On success: `printed_at = now`, `print_count += 1`.
- Soft-deleted rows grouped at the bottom under "Removed in source (N)", collapsed by default.

`POSPage` (the existing cart-based ad-hoc entry) **stays** for the rare emergency case where the wife needs a receipt for something not yet in the Sheet. It is repointed to write directly into the local `order` table with `source_tab = NULL, source_row = NULL`. Its API calls are removed.

## Settings page changes

**Remove:**

- `apiUrl`, `serviceUsername`, `servicePassword` fields and the API connection section.

**Add — Google Sheets section:**

- `Spreadsheet ID` (text).
- `Service account JSON`: `Choose file…` copies the file into the app data dir as `service-account.json` with `chmod 600`. The service-account email parsed from the JSON is shown below the field, with the helper text: "Share the spreadsheet with this email as **Viewer**."
- `Default tab strategy`: `Latest tab` | `Pick from list` (dropdown queries `spreadsheets.get`) | `Pinned: <tab>`.
- `Test connection` button: lists tab names and row counts on success; shows error from the Sheets client on failure.

**Add — Shop section** (was previously fetched from `grannys-ledger`'s settings API in `OrdersPage.handleReprint`):

- `shopName`, `shopPhone`, `shopLine`.
- `promptpayType` (`phone` | `id_card`), `promptpayValue`.
- `thankYouMessage`.

These already feed `PrinterConfig` for receipts; they just get a local home now.

### Config shape (Rust)

```rust
struct AppConfig {
    // existing
    printer_ip: String,
    paper_width: u32,

    // new — sheets
    spreadsheet_id: String,
    service_account_path: String,   // resolved against app data dir
    default_tab_strategy: TabStrategy,   // Latest | CurrentWeek | Pinned(String)

    // new — shop
    shop_name: String,
    shop_phone: String,
    shop_line: String,
    promptpay_type: String,         // "phone" | "id_card"
    promptpay_value: String,
    thank_you_message: String,
}
```

**Config migration:** on first launch after upgrade, drop `api_url`, `service_username`, `service_password` if present; default the new fields to empty strings / `TabStrategy::Latest`.

## Tauri command surface

```
load_config() -> AppConfig
save_config(cfg: AppConfig) -> ()

test_sheets_connection() -> { tabs: [{ name, row_count }] }
sync_week(tab: String) -> SyncPreview
apply_sync(tab: String, mappings: SyncMappings) -> SyncResult

list_orders(filter: { tab?: String, include_deleted: bool, limit: u32 }) -> Vec<OrderListRow>
get_order(id: String) -> OrderDetail

search_products(q: String, limit: u32) -> Vec<ProductLite>
search_customers(q: String, limit: u32) -> Vec<CustomerLite>

print_order(id: String) -> PrintResult
test_printer() -> () (existing)
check_printer_status() -> bool (existing)
print_receipt(...) -> () (existing — kept for the POSPage ad-hoc path)
```

## Edge cases (from the actual Sheet)

| Case | Behavior |
|---|---|
| Red conditional-format on a qty cell | Cell value is still numeric; formatting ignored. |
| Empty qty cell under a menu column | Treated as 0; no `order_item`. |
| Italic / strikethrough customer names (e.g. `BowNik`) | Text value unchanged; alias matched verbatim. |
| Customer prefixes (`K.`, `P'`) | Kept in alias verbatim; not normalized away. |
| Trailing blank rows in the order table | Stop at first row where channel + customer + every menu column are blank. |
| Note `Packed` / `รอส่งยอด` | Stored verbatim in `order.notes`. Not interpreted as `status`. |
| `สถานที่ส่ง` with colored / bold text | Plain string into `delivery_location`. |
| Menu added mid-week | Next sync surfaces it as unknown in the mapping screen. |
| Menu removed mid-week | Column missing on next sync; existing `order_items` referencing the canonical product are unaffected. |
| Customer name renamed in Sheet | Re-sync surfaces new alias; user maps to same canonical customer; alias table grows. |
| Channel typos (`Linea` etc.) | Stored as raw string. No enum. A future `channel_alias` table is the natural fix if it ever matters. |

## Error handling

| Failure | Behavior |
|---|---|
| Sheets 401/403 (no access) | Toast + Settings link: `Share the spreadsheet with <service-account-email> as Viewer.` Email shown verbatim. |
| Sheets 404 (bad spreadsheet ID) | Toast + jump to Settings → Spreadsheet ID field highlighted. |
| Sheets 429 (rate limited) | Toast `Rate limited, retry in 30s`; sync button disabled with countdown. No automatic retries. |
| Network down | Inline error in sync screen, retry button. Printing previously-synced orders still works. |
| Service account JSON missing/malformed | Settings shows a red banner; sync button disabled. |
| Tab header row not found (no `ช่องทาง`) | Parse error returned with the first 10 rows for diagnostics; sync aborted, nothing written. |
| Single row malformed (e.g. qty cell has text) | Collected into `parse_errors[]`; tab sync continues for other rows. UI shows errors as a sub-list. |
| DB migration failure at startup | App refuses main UI; recovery dialog with DB path + Open data folder button. No silent reset. |
| Apply-sync transaction failure | `ROLLBACK`; error returned; preview state preserved so user can retry without re-mapping. |

## Concurrency

- Sheets is fetched fresh on each manual click; no caching layer in scope.
- DB writes happen in a single transaction per `apply_sync`. SQLite opened in WAL mode.
- One sync at a time; the button is disabled while a sync is in flight.

## Future migration to grannys-ledger

When `grannys-ledger` is ready, a one-shot exporter walks `product`, `customer`, `"order"` (excluding `deleted_at IS NOT NULL`), and `order_item` and POSTs to the API. Because IDs are already cuid-style TEXT, they can be reused upstream. `product_alias`, `customer_alias`, `sync_log`, `tab_week_mapping` stay local.

## Testing

### Rust

- **Parser unit tests** (`sync/parser.rs`), table-driven against fixture `ValueRange` JSON:
  - Happy path matching the screenshot scenario.
  - Empty qty cells, partial rows, trailing blanks.
  - Header row not found.
  - Menu added / removed between two snapshots.
  - Customer name with `K.`, `P'`, italic-rendered (text is the same; assert no mangling).
  - Note / `สถานที่ส่ง` with mixed Thai + English.
- **Sync engine integration tests** with `sqlite::memory:`:
  - First sync of an empty DB.
  - Re-sync same tab, no changes → 0 inserts, 0 updates, `printed_at` untouched.
  - Re-sync with one row's qty changed → 1 update, `order_items` replaced.
  - Re-sync after row insertion mid-tab → new order gets a fresh `order_number` seq; existing orders unchanged.
  - Re-sync after row deletion → soft-delete.
  - Aliases persist; second sync auto-resolves.
- The Sheets client is behind a trait; tests inject a fake. No live Sheets calls.

### TS

- **Mapping screen** (Vitest + Testing Library):
  - Searchbox debounced query, results render, selection persists.
  - Create-new opens inline form pre-filled with alias + sheet price.
  - Apply button disabled until every unknown is resolved.
- **OrdersPage**: synced rows render; print click invokes correct command; `printed_at` causes ✓ to render.

### Manual smoke test plan

1. Fresh install → Settings → paste spreadsheet ID + service account JSON → Test connection lists tabs.
2. Sync `Order_30` → mapping screen for 4 menus + 5 customers → fill → apply → orders appear.
3. Print a row → 🖨 becomes ✓.
4. Wife adds a row in the Sheet → re-sync → new row appears, others unchanged, printed ones still ✓.
5. Wife deletes a row → re-sync → that row moves to "Removed in source".
6. Disconnect network → existing orders still printable; sync button shows network error.

## Implementation surface (high level)

| Area | New | Modified | Removed |
|---|---|---|---|
| Rust | `sync/` (sheets client, parser, engine), `db/` (sqlx pool, migrations, repos), new commands | `commands/config.rs` (new fields), `lib.rs` (handler list), `Cargo.toml` (deps: `sqlx`, `google-sheets4` or equivalent, `chrono`, `cuid`) | none yet |
| TS | `pages/SyncPage.tsx`, `components/MappingForm.tsx`, `lib/tauri.ts` extensions | `pages/OrdersPage.tsx` (rewrite to local), `pages/POSPage.tsx` + `stores/cart.ts` (submit → local DB), `pages/SettingsPage.tsx` (Sheets + Shop sections), `lib/types.ts` (extend) | `lib/api.ts` (delete), API-related fields in `AppConfig` |

A detailed file-by-file implementation plan is the next step (`writing-plans` skill).
