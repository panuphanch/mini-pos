# Sheet Sync + Local Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mini-pos self-contained against a local SQLite store fed by manual syncs from the weekly Google Sheet, replacing the dead `grannys-ledger` API dependency, with a mapping UI for unknown menu/customer names and a print-from-list flow.

**Architecture:** Rust owns Sheets fetch (service-account JWT), SQLite (sqlx, WAL), parsing, sync engine, and printer. TS handles UI: sync screen, mapping form (search + create), orders/print list, settings. Schema mirrors `grannys-ledger`'s Prisma types so a future export is mechanical.

**Tech Stack:** Tauri v2, Rust (sqlx 0.8 + SQLite, reqwest 0.12, jsonwebtoken 9, chrono, cuid2), React 18 + TypeScript + Tailwind, Zustand, Google Sheets API v4 (read-only).

**Spec:** `docs/superpowers/specs/2026-05-16-sheet-sync-local-store-design.md`

**Deviation from spec:** Currency is stored as **INTEGER baht** (not satang). All observed sheet prices are whole baht and the existing TS layer already uses baht. If fractional baht is needed later, migration is `ALTER TABLE … RENAME COLUMN; UPDATE … SET col = col * 100;`.

---

## File Structure

**New Rust files:**
- `src-tauri/src/db/mod.rs` — module root, re-exports
- `src-tauri/src/db/pool.rs` — sqlx pool init, WAL pragma
- `src-tauri/src/db/migrations/0001_initial.sql` — schema
- `src-tauri/src/db/models.rs` — row structs
- `src-tauri/src/db/ids.rs` — cuid2 id + timestamp helpers
- `src-tauri/src/db/products.rs` — product + product_alias repo
- `src-tauri/src/db/customers.rs` — customer + customer_alias repo
- `src-tauri/src/db/orders.rs` — order + order_item + sync_log + tab_week_mapping repo
- `src-tauri/src/sheets/mod.rs` — module root
- `src-tauri/src/sheets/auth.rs` — service-account JWT → access token, cached
- `src-tauri/src/sheets/client.rs` — `SheetsClient` trait + `HttpSheetsClient` + `FakeSheetsClient` (test-only)
- `src-tauri/src/sheets/parser.rs` — `parse_tab(ValueRange) -> ParsedTab`
- `src-tauri/src/sheets/week.rs` — `tab_name → week_start_date`
- `src-tauri/src/sync/mod.rs` — module root
- `src-tauri/src/sync/types.rs` — `SyncPreview`, `SyncMappings`, etc.
- `src-tauri/src/sync/engine.rs` — `preview_sync`, `apply_sync`
- `src-tauri/src/commands/sync.rs` — `sync_week`, `apply_sync`, `test_sheets_connection`
- `src-tauri/src/commands/catalog.rs` — `search_products`, `search_customers`
- `src-tauri/src/commands/orders.rs` — `list_orders`, `get_order`, `print_order`

**Modified Rust files:**
- `src-tauri/Cargo.toml` — add deps
- `src-tauri/src/lib.rs` — register commands, init DB
- `src-tauri/src/config.rs` — new fields, migrate-on-load
- `src-tauri/src/commands/config.rs` — adjust validation
- `src-tauri/src/commands/mod.rs` — register new submodules
- `src-tauri/src/printer/receipt.rs` — expose `build_receipt` for reuse (likely already public; verify)

**New TS files:**
- `src/lib/sync.ts` — sync command wrappers + types
- `src/components/SearchPicker.tsx` — reusable typeahead picker
- `src/components/MappingForm.tsx` — unknown menu + customer mapping
- `src/pages/SyncPage.tsx` — sync screen

**Modified TS files:**
- `src/lib/types.ts` — drop API types; add local types
- `src/lib/tauri.ts` — add wrappers for new commands; remove API config
- `src/App.tsx` — remove API auth flow; add Sync tab; init DB-aware
- `src/pages/OrdersPage.tsx` — rewrite against local commands
- `src/pages/POSPage.tsx` + `src/components/PaymentDialog.tsx` + `src/stores/cart.ts` — charge writes local order
- `src/pages/SettingsPage.tsx` — Sheets section, Shop section, drop API section
- `src/components/StatusBar.tsx` — drop API status (printer only)
- `src/components/CustomerSearch.tsx` — point at `search_customers` Tauri command

**Deleted TS files:**
- `src/lib/api.ts`

---

## Phase A — Rust foundation

### Task 1: Add Cargo dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit `Cargo.toml` to add deps**

Add under `[dependencies]`:

```toml
sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio", "sqlite", "macros", "migrate", "chrono"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
jsonwebtoken = "9"
chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }
cuid2 = "0.1"
thiserror = "1"
async-trait = "0.1"
anyhow = "1"
```

- [ ] **Step 2: Run cargo check to fetch deps**

Run: `cd src-tauri && cargo check`
Expected: PASS (existing code still compiles). Downloads new crates on first run.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add sqlx, reqwest, jwt, chrono, cuid2 for sheet sync"
```

---

### Task 2: Refactor `AppConfig` with new fields + migrate-on-load

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/commands/config.rs`

- [ ] **Step 1: Replace `src-tauri/src/config.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TabStrategy {
    Latest,
    CurrentWeek,
    Pinned(String),
}

impl Default for TabStrategy {
    fn default() -> Self {
        TabStrategy::Latest
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub printer_ip: String,
    pub paper_width: u32,

    // Sheets
    pub spreadsheet_id: String,
    pub service_account_path: String,
    pub default_tab_strategy: TabStrategy,

    // Shop
    pub shop_name: String,
    pub shop_phone: String,
    pub shop_line: String,
    pub promptpay_type: String,    // "phone" | "id_card"
    pub promptpay_value: String,
    pub thank_you_message: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            printer_ip: "192.168.1.55".to_string(),
            paper_width: 80,
            spreadsheet_id: String::new(),
            service_account_path: "service-account.json".to_string(),
            default_tab_strategy: TabStrategy::Latest,
            shop_name: "Granny's Bakery".to_string(),
            shop_phone: String::new(),
            shop_line: String::new(),
            promptpay_type: "phone".to_string(),
            promptpay_value: String::new(),
            thank_you_message: "Thank you!".to_string(),
        }
    }
}

/// Migrate older config JSON (with apiUrl etc.) by dropping unknown fields
/// and filling defaults for missing ones. Called from `load_config`.
pub fn migrate_from_json(raw: &str) -> Result<AppConfig, serde_json::Error> {
    // serde_json with default-on-missing via `#[serde(default)]` would be invasive.
    // Instead: parse as Value, project known keys.
    let v: serde_json::Value = serde_json::from_str(raw)?;
    let obj = v.as_object();
    let get_str = |k: &str, d: &str| -> String {
        obj.and_then(|o| o.get(k))
            .and_then(|x| x.as_str())
            .map(String::from)
            .unwrap_or_else(|| d.to_string())
    };
    let get_u32 = |k: &str, d: u32| -> u32 {
        obj.and_then(|o| o.get(k))
            .and_then(|x| x.as_u64())
            .map(|n| n as u32)
            .unwrap_or(d)
    };
    let default = AppConfig::default();
    let strategy = obj
        .and_then(|o| o.get("defaultTabStrategy"))
        .and_then(|s| serde_json::from_value::<TabStrategy>(s.clone()).ok())
        .unwrap_or_default();
    Ok(AppConfig {
        printer_ip: get_str("printerIp", &default.printer_ip),
        paper_width: get_u32("paperWidth", default.paper_width),
        spreadsheet_id: get_str("spreadsheetId", &default.spreadsheet_id),
        service_account_path: get_str("serviceAccountPath", &default.service_account_path),
        default_tab_strategy: strategy,
        shop_name: get_str("shopName", &default.shop_name),
        shop_phone: get_str("shopPhone", &default.shop_phone),
        shop_line: get_str("shopLine", &default.shop_line),
        promptpay_type: get_str("promptpayType", &default.promptpay_type),
        promptpay_value: get_str("promptpayValue", &default.promptpay_value),
        thank_you_message: get_str("thankYouMessage", &default.thank_you_message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_drops_old_api_fields_and_keeps_printer() {
        let old = r#"{
            "printerIp": "192.168.1.99",
            "paperWidth": 58,
            "apiUrl": "http://localhost:3000/api",
            "serviceUsername": "u",
            "servicePassword": "p"
        }"#;
        let cfg = migrate_from_json(old).unwrap();
        assert_eq!(cfg.printer_ip, "192.168.1.99");
        assert_eq!(cfg.paper_width, 58);
        assert_eq!(cfg.spreadsheet_id, "");
        assert_eq!(cfg.default_tab_strategy, TabStrategy::Latest);
        assert_eq!(cfg.shop_name, "Granny's Bakery");
    }

    #[test]
    fn migrate_preserves_new_fields_when_present() {
        let raw = r#"{
            "printerIp": "10.0.0.1",
            "paperWidth": 80,
            "spreadsheetId": "abc123",
            "serviceAccountPath": "service-account.json",
            "defaultTabStrategy": "currentWeek",
            "shopName": "X",
            "shopPhone": "555",
            "shopLine": "@x",
            "promptpayType": "phone",
            "promptpayValue": "0812345678",
            "thankYouMessage": "Thanks"
        }"#;
        let cfg = migrate_from_json(raw).unwrap();
        assert_eq!(cfg.spreadsheet_id, "abc123");
        assert_eq!(cfg.default_tab_strategy, TabStrategy::CurrentWeek);
        assert_eq!(cfg.shop_name, "X");
    }

    #[test]
    fn migrate_handles_pinned_tab() {
        let raw = r#"{ "defaultTabStrategy": { "pinned": "Order_30" } }"#;
        let cfg = migrate_from_json(raw).unwrap();
        assert_eq!(cfg.default_tab_strategy, TabStrategy::Pinned("Order_30".to_string()));
    }
}
```

- [ ] **Step 2: Update `src-tauri/src/commands/config.rs` to use migrator and adjust validation**

Replace its body with:

```rust
use crate::config::{migrate_from_json, AppConfig};
use std::fs;
use tauri::Manager;

#[tauri::command]
pub fn load_config(app_handle: tauri::AppHandle) -> Result<AppConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let cfg = migrate_from_json(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;
        // Persist normalized (drops old fields).
        let json = serde_json::to_string_pretty(&cfg)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        Ok(cfg)
    } else {
        let default_config = AppConfig::default();
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
        Ok(default_config)
    }
}

#[tauri::command]
pub fn save_config(app_handle: tauri::AppHandle, config: AppConfig) -> Result<String, String> {
    if config.printer_ip.is_empty() {
        return Err("Printer IP cannot be empty".to_string());
    }
    if config.paper_width != 58 && config.paper_width != 80 {
        return Err("Paper width must be 58 or 80 mm".to_string());
    }
    // spreadsheet_id may be empty until the user fills it in Settings.

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;

    let config_path = app_data_dir.join("config.json");
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok("Config saved successfully".to_string())
}
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib config::tests`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/commands/config.rs
git commit -m "feat(config): drop API fields, add sheets + shop fields, migrate-on-load"
```

---

### Task 3: SQLite pool + initial migration

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/pool.rs`
- Create: `src-tauri/src/db/migrations/0001_initial.sql`
- Create: `src-tauri/src/db/ids.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod db;`)

- [ ] **Step 1: Create `src-tauri/src/db/migrations/0001_initial.sql`**

```sql
CREATE TABLE product (
    id              TEXT PRIMARY KEY,
    name_th         TEXT NOT NULL,
    name_en         TEXT,
    selling_price   INTEGER NOT NULL,
    category        TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    image_url       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_product_name_th ON product(name_th);
CREATE INDEX idx_product_active ON product(is_active);

CREATE TABLE customer (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    nickname        TEXT,
    phone           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_customer_name ON customer(name);

CREATE TABLE product_alias (
    id              TEXT PRIMARY KEY,
    alias           TEXT NOT NULL UNIQUE,
    product_id      TEXT NOT NULL REFERENCES product(id),
    created_at      TEXT NOT NULL
);

CREATE TABLE customer_alias (
    id              TEXT PRIMARY KEY,
    alias           TEXT NOT NULL UNIQUE,
    customer_id     TEXT NOT NULL REFERENCES customer(id),
    created_at      TEXT NOT NULL
);

CREATE TABLE "order" (
    id                  TEXT PRIMARY KEY,
    order_number        TEXT NOT NULL UNIQUE,
    customer_id         TEXT NOT NULL REFERENCES customer(id),
    channel             TEXT,
    delivery_location   TEXT,
    notes               TEXT,
    status              TEXT NOT NULL DEFAULT 'confirmed',
    total_amount        INTEGER NOT NULL,
    discount            INTEGER NOT NULL DEFAULT 0,
    delivery_fee        INTEGER NOT NULL DEFAULT 0,
    order_date          TEXT NOT NULL,
    source_tab          TEXT,
    source_row          INTEGER,
    synced_at           TEXT,
    printed_at          TEXT,
    print_count         INTEGER NOT NULL DEFAULT 0,
    deleted_at          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (source_tab, source_row)
);
CREATE INDEX idx_order_source_tab ON "order"(source_tab);
CREATE INDEX idx_order_customer ON "order"(customer_id);
CREATE INDEX idx_order_date ON "order"(order_date);

CREATE TABLE order_item (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
    product_id      TEXT NOT NULL REFERENCES product(id),
    quantity        INTEGER NOT NULL,
    unit_price      INTEGER NOT NULL
);
CREATE INDEX idx_order_item_order ON order_item(order_id);

CREATE TABLE sync_log (
    id                  TEXT PRIMARY KEY,
    tab_name            TEXT NOT NULL,
    synced_at           TEXT NOT NULL,
    rows_added          INTEGER NOT NULL DEFAULT 0,
    rows_updated        INTEGER NOT NULL DEFAULT 0,
    rows_soft_deleted   INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL,
    error_message       TEXT
);

CREATE TABLE tab_week_mapping (
    tab_name        TEXT PRIMARY KEY,
    week_start_date TEXT NOT NULL
);
```

- [ ] **Step 2: Create `src-tauri/src/db/pool.rs`**

```rust
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteConnectOptions};
use std::path::Path;
use std::str::FromStr;

pub async fn init_pool(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }
    let url = format!("sqlite://{}?mode=rwc", db_path.display());
    let opts = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
pub async fn init_memory_pool() -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;
    Ok(pool)
}
```

- [ ] **Step 3: Create `src-tauri/src/db/ids.rs`**

```rust
use chrono::Utc;

pub fn new_id() -> String {
    cuid2::create_id()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
```

- [ ] **Step 4: Create `src-tauri/src/db/mod.rs`**

```rust
pub mod ids;
pub mod pool;

#[cfg(test)]
pub use pool::init_memory_pool;
pub use pool::init_pool;
```

- [ ] **Step 5: Add `mod db;` to `src-tauri/src/lib.rs`**

Insert after `mod config;`:

```rust
mod db;
```

- [ ] **Step 6: Write smoke test inside `pool.rs`** (append after `init_memory_pool`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_apply_and_tables_exist() {
        let pool = init_memory_pool().await.unwrap();
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='order'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, 1);
        for t in ["product", "customer", "product_alias", "customer_alias",
                  "order_item", "sync_log", "tab_week_mapping"] {
            let r: (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{}'", t))
                .fetch_one(&pool).await.unwrap();
            assert_eq!(r.0, 1, "missing table {}", t);
        }
    }
}
```

- [ ] **Step 7: Run test**

Run: `cd src-tauri && cargo test --lib db::pool::tests::migrations_apply`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/db src-tauri/src/lib.rs
git commit -m "feat(db): sqlite pool + initial schema migration"
```

---

## Phase B — Repositories

### Task 4: Products + product_alias repo

**Files:**
- Create: `src-tauri/src/db/products.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/db/products.rs`**

```rust
use crate::db::ids::{new_id, now_iso};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub name_th: String,
    pub name_en: Option<String>,
    pub selling_price: i64,
    pub category: Option<String>,
    pub is_active: bool,
    pub image_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductLite {
    pub id: String,
    pub name_th: String,
    pub name_en: Option<String>,
    pub selling_price: i64,
}

pub async fn create(
    pool: &SqlitePool,
    name_th: &str,
    name_en: Option<&str>,
    selling_price: i64,
) -> Result<Product, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO product (id, name_th, name_en, selling_price, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)"#,
    )
    .bind(&id).bind(name_th).bind(name_en).bind(selling_price).bind(&now).bind(&now)
    .execute(pool).await?;
    get_by_id(pool, &id).await.map(Option::unwrap)
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Product>, sqlx::Error> {
    sqlx::query_as::<_, Product>("SELECT * FROM product WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}

pub async fn search(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<ProductLite>, sqlx::Error> {
    let like = format!("%{}%", q);
    sqlx::query_as::<_, ProductLite>(
        r#"SELECT id, name_th, name_en, selling_price FROM product
           WHERE is_active = 1 AND (name_th LIKE ? OR COALESCE(name_en, '') LIKE ?)
           ORDER BY name_th LIMIT ?"#,
    )
    .bind(&like).bind(&like).bind(limit)
    .fetch_all(pool).await
}

pub async fn find_by_alias(pool: &SqlitePool, alias: &str) -> Result<Option<Product>, sqlx::Error> {
    sqlx::query_as::<_, Product>(
        r#"SELECT p.* FROM product p
           JOIN product_alias pa ON pa.product_id = p.id
           WHERE pa.alias = ?"#,
    )
    .bind(alias).fetch_optional(pool).await
}

pub async fn upsert_alias(pool: &SqlitePool, alias: &str, product_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO product_alias (id, alias, product_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(alias) DO UPDATE SET product_id = excluded.product_id"#,
    )
    .bind(new_id()).bind(alias).bind(product_id).bind(now_iso())
    .execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::init_memory_pool;

    #[tokio::test]
    async fn create_search_alias_roundtrip() {
        let pool = init_memory_pool().await.unwrap();
        let p = create(&pool, "เค้กช็อคฟัดจ์", Some("Choco Fudge"), 85).await.unwrap();
        let results = search(&pool, "ช็อค", 10).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, p.id);

        upsert_alias(&pool, "เค้กช็อคฟัดจ์", &p.id).await.unwrap();
        let found = find_by_alias(&pool, "เค้กช็อคฟัดจ์").await.unwrap().unwrap();
        assert_eq!(found.id, p.id);

        // Alias is idempotent.
        upsert_alias(&pool, "เค้กช็อคฟัดจ์", &p.id).await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM product_alias")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 1);
    }
}
```

- [ ] **Step 2: Register module in `src-tauri/src/db/mod.rs`**

Append:
```rust
pub mod products;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib db::products`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/products.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): product + product_alias repo"
```

---

### Task 5: Customers + customer_alias repo

**Files:**
- Create: `src-tauri/src/db/customers.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/db/customers.rs`**

```rust
use crate::db::ids::{new_id, now_iso};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerLite {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
}

pub async fn create(pool: &SqlitePool, name: &str) -> Result<Customer, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    sqlx::query("INSERT INTO customer (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(name).bind(&now).bind(&now)
        .execute(pool).await?;
    get_by_id(pool, &id).await.map(Option::unwrap)
}

pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Customer>, sqlx::Error> {
    sqlx::query_as::<_, Customer>("SELECT * FROM customer WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}

pub async fn search(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<CustomerLite>, sqlx::Error> {
    let like = format!("%{}%", q);
    sqlx::query_as::<_, CustomerLite>(
        r#"SELECT id, name, nickname FROM customer
           WHERE name LIKE ? OR COALESCE(nickname, '') LIKE ?
           ORDER BY name LIMIT ?"#,
    )
    .bind(&like).bind(&like).bind(limit)
    .fetch_all(pool).await
}

pub async fn find_by_alias(pool: &SqlitePool, alias: &str) -> Result<Option<Customer>, sqlx::Error> {
    sqlx::query_as::<_, Customer>(
        r#"SELECT c.* FROM customer c
           JOIN customer_alias ca ON ca.customer_id = c.id
           WHERE ca.alias = ?"#,
    )
    .bind(alias).fetch_optional(pool).await
}

pub async fn upsert_alias(pool: &SqlitePool, alias: &str, customer_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO customer_alias (id, alias, customer_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(alias) DO UPDATE SET customer_id = excluded.customer_id"#,
    )
    .bind(new_id()).bind(alias).bind(customer_id).bind(now_iso())
    .execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::init_memory_pool;

    #[tokio::test]
    async fn create_search_alias_roundtrip() {
        let pool = init_memory_pool().await.unwrap();
        let c = create(&pool, "K.Parin").await.unwrap();
        let r = search(&pool, "Parin", 5).await.unwrap();
        assert_eq!(r.len(), 1);
        upsert_alias(&pool, "K.Parin (Aom)", &c.id).await.unwrap();
        let found = find_by_alias(&pool, "K.Parin (Aom)").await.unwrap().unwrap();
        assert_eq!(found.id, c.id);
    }
}
```

- [ ] **Step 2: Register in `src-tauri/src/db/mod.rs`**

Append: `pub mod customers;`

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib db::customers`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/customers.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): customer + customer_alias repo"
```

---

### Task 6: Orders + order_items + sync_log + tab_week_mapping repo

**Files:**
- Create: `src-tauri/src/db/orders.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/db/orders.rs`**

```rust
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
    pub created_at: String,
    pub updated_at: String,
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
    pub order_id: String,
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

    let existing: Option<(String, String)> = sqlx::query_as(
        r#"SELECT id, order_number FROM "order" WHERE source_tab = ? AND source_row = ?"#,
    )
    .bind(input.source_tab).bind(input.source_row)
    .fetch_optional(&mut **tx).await?;

    let (order_id, order_number, was_insert) = match existing {
        Some((id, num)) => {
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
            (id, num, false)
        }
        None => {
            let seq: (Option<i64>,) = sqlx::query_as(
                r#"SELECT MAX(CAST(SUBSTR(order_number, INSTR(order_number, '-') + 1) AS INTEGER))
                   FROM "order" WHERE source_tab = ?"#,
            )
            .bind(input.source_tab).fetch_one(&mut **tx).await?;
            let next_seq = seq.0.unwrap_or(0) + 1;
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

    Ok(UpsertOutcome { order_id, order_number, was_insert })
}

pub async fn soft_delete_missing_rows(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    tab: &str,
    keep_rows: &[i64],
) -> Result<i64, sqlx::Error> {
    let placeholders = if keep_rows.is_empty() {
        "NULL".to_string()
    } else {
        keep_rows.iter().map(|_| "?").collect::<Vec<_>>().join(",")
    };
    let sql = format!(
        r#"UPDATE "order" SET deleted_at = ?, updated_at = ?
           WHERE source_tab = ? AND deleted_at IS NULL AND source_row NOT IN ({})"#,
        placeholders
    );
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
}
```

- [ ] **Step 2: Register module in `src-tauri/src/db/mod.rs`**

Append: `pub mod orders;`

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib db::orders`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/orders.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): order/order_item/sync_log/week-mapping repo with idempotent upsert"
```

---

## Phase C — Sheets

### Task 7: Service-account JWT auth

**Files:**
- Create: `src-tauri/src/sheets/mod.rs`
- Create: `src-tauri/src/sheets/auth.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod sheets;`)

- [ ] **Step 1: Create `src-tauri/src/sheets/auth.rs`**

```rust
use anyhow::{anyhow, Context, Result};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
pub struct ServiceAccount {
    pub client_email: String,
    pub private_key: String,
    pub token_uri: String,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

pub struct AuthClient {
    sa: ServiceAccount,
    http: reqwest::Client,
    cache: Mutex<Option<(String, Instant)>>,
}

impl AuthClient {
    pub fn from_file(path: &std::path::Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Reading service account file {}", path.display()))?;
        let sa: ServiceAccount = serde_json::from_str(&raw)
            .context("Parsing service account JSON")?;
        Ok(Self {
            sa,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
            cache: Mutex::new(None),
        })
    }

    pub fn client_email(&self) -> &str { &self.sa.client_email }

    pub async fn access_token(&self) -> Result<String> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some((tok, exp)) = cache.as_ref() {
                if Instant::now() + Duration::from_secs(60) < *exp {
                    return Ok(tok.clone());
                }
            }
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?.as_secs();
        let claims = Claims {
            iss: &self.sa.client_email,
            scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
            aud: &self.sa.token_uri,
            iat: now,
            exp: now + 3600,
        };
        let key = EncodingKey::from_rsa_pem(self.sa.private_key.as_bytes())
            .context("Parsing service account RSA private key")?;
        let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
            .context("Signing JWT")?;
        let res = self.http.post(&self.sa.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", &jwt),
            ])
            .send().await?;
        if !res.status().is_success() {
            let s = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("Token endpoint returned {}: {}", s, body));
        }
        let tr: TokenResponse = res.json().await?;
        let exp = Instant::now() + Duration::from_secs(tr.expires_in);
        *self.cache.lock().unwrap() = Some((tr.access_token.clone(), exp));
        Ok(tr.access_token)
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/sheets/mod.rs`**

```rust
pub mod auth;
```

- [ ] **Step 3: Add `mod sheets;` to `src-tauri/src/lib.rs`**

Insert after `mod db;`:
```rust
mod sheets;
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sheets src-tauri/src/lib.rs
git commit -m "feat(sheets): service-account JWT auth with token cache"
```

(No unit test here — exercising real token endpoint needs a real key. Auth is covered by the manual smoke test in the final task.)

---

### Task 8: Sheets HTTP client (trait + real + fake)

**Files:**
- Create: `src-tauri/src/sheets/client.rs`
- Modify: `src-tauri/src/sheets/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/sheets/client.rs`**

```rust
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
pub struct ValueRange {
    #[serde(default)]
    pub values: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sheet {
    pub properties: SheetProperties,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetProperties {
    pub title: String,
    pub grid_properties: Option<GridProperties>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridProperties {
    pub row_count: Option<i64>,
    pub column_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Spreadsheet {
    pub sheets: Vec<Sheet>,
}

#[async_trait]
pub trait SheetsClient: Send + Sync {
    async fn list_tabs(&self, spreadsheet_id: &str) -> Result<Vec<String>>;
    async fn get_values(&self, spreadsheet_id: &str, range: &str) -> Result<ValueRange>;
}

pub struct HttpSheetsClient {
    auth: Arc<super::auth::AuthClient>,
    http: reqwest::Client,
}

impl HttpSheetsClient {
    pub fn new(auth: Arc<super::auth::AuthClient>) -> Self {
        Self { auth, http: reqwest::Client::new() }
    }
}

#[async_trait]
impl SheetsClient for HttpSheetsClient {
    async fn list_tabs(&self, spreadsheet_id: &str) -> Result<Vec<String>> {
        let token = self.auth.access_token().await?;
        let url = format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}?fields=sheets.properties",
            urlencoding::encode(spreadsheet_id)
        );
        let res = self.http.get(&url).bearer_auth(token).send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("Sheets API {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        let s: Spreadsheet = res.json().await?;
        Ok(s.sheets.into_iter().map(|sh| sh.properties.title).collect())
    }

    async fn get_values(&self, spreadsheet_id: &str, range: &str) -> Result<ValueRange> {
        let token = self.auth.access_token().await?;
        let url = format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}",
            urlencoding::encode(spreadsheet_id),
            urlencoding::encode(range)
        );
        let res = self.http.get(&url).bearer_auth(token).send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("Sheets API {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        Ok(res.json().await?)
    }
}

/// Fake for tests: callers populate maps.
pub struct FakeSheetsClient {
    pub tabs: Vec<String>,
    pub values: std::collections::HashMap<String, ValueRange>,
}

#[async_trait]
impl SheetsClient for FakeSheetsClient {
    async fn list_tabs(&self, _spreadsheet_id: &str) -> Result<Vec<String>> {
        Ok(self.tabs.clone())
    }
    async fn get_values(&self, _spreadsheet_id: &str, range: &str) -> Result<ValueRange> {
        self.values.get(range).cloned()
            .ok_or_else(|| anyhow!("FakeSheetsClient: no fixture for range {}", range))
    }
}
```

- [ ] **Step 2: Add `urlencoding` to Cargo.toml deps**

Edit `src-tauri/Cargo.toml`, append:
```toml
urlencoding = "2"
```

- [ ] **Step 3: Update `src-tauri/src/sheets/mod.rs`**

```rust
pub mod auth;
pub mod client;
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sheets src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(sheets): SheetsClient trait with HTTP + fake implementations"
```

---

### Task 9: Parser (menu + order tables → ParsedTab) and tab→week date

**Files:**
- Create: `src-tauri/src/sheets/parser.rs`
- Create: `src-tauri/src/sheets/week.rs`
- Modify: `src-tauri/src/sheets/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/sheets/week.rs`**

```rust
use chrono::{Datelike, NaiveDate, Weekday};

/// Parse "Order_30" → Monday of ISO week 30 in `for_year`.
pub fn parse_tab_week_start(tab: &str, for_year: i32) -> Option<NaiveDate> {
    let rest = tab.strip_prefix("Order_")?;
    let week: u32 = rest.parse().ok()?;
    if !(1..=53).contains(&week) { return None; }
    NaiveDate::from_isoywd_opt(for_year, week, Weekday::Mon)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_week() {
        let d = parse_tab_week_start("Order_30", 2026).unwrap();
        assert_eq!(d.iso_week().week(), 30);
        assert_eq!(d.weekday(), Weekday::Mon);
    }
    #[test]
    fn rejects_garbage() {
        assert!(parse_tab_week_start("Foo", 2026).is_none());
        assert!(parse_tab_week_start("Order_99", 2026).is_none());
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/sheets/parser.rs`**

```rust
use crate::sheets::client::ValueRange;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuRow {
    pub menu_name: String,
    pub price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedOrderItem {
    pub menu_name: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedOrder {
    pub source_row: i64,
    pub channel: Option<String>,
    pub customer: String,
    pub delivery_location: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<ParsedOrderItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTab {
    pub menu: Vec<MenuRow>,
    pub orders: Vec<ParsedOrder>,
    pub parse_errors: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Header row 'ช่องทาง' not found in tab")]
    HeaderNotFound,
    #[error("Menu table appears empty")]
    EmptyMenu,
}

const CHANNEL_HEADER: &str = "ช่องทาง";
const DELIVERY_HEADER: &str = "สถานที่ส่ง";
const NOTE_HEADER: &str = "Note";

fn cell<'a>(row: &'a [String], idx: usize) -> &'a str {
    row.get(idx).map(String::as_str).unwrap_or("").trim()
}

pub fn parse_tab(vr: &ValueRange) -> Result<ParsedTab, ParseError> {
    let rows = &vr.values;

    // --- Menu table: rows starting at index 0, stop when col A blank ---
    let mut menu: Vec<MenuRow> = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let a = cell(&rows[i], 0);
        if a.is_empty() { break; }
        if a == "Menu" { i += 1; continue; }
        let price_str = cell(&rows[i], 4);
        let price: i64 = price_str.parse().unwrap_or(0);
        if price > 0 {
            menu.push(MenuRow { menu_name: a.to_string(), price });
        }
        i += 1;
    }
    if menu.is_empty() { return Err(ParseError::EmptyMenu); }

    // --- Find header row of order table ---
    let header_idx = rows.iter().position(|r| cell(r, 0) == CHANNEL_HEADER)
        .ok_or(ParseError::HeaderNotFound)?;
    let header = &rows[header_idx];

    // Columns C..N are menu names. Identify delivery + note columns by header name.
    let mut menu_cols: Vec<(usize, String)> = Vec::new();
    let mut delivery_col: Option<usize> = None;
    let mut note_col: Option<usize> = None;
    for (idx, h) in header.iter().enumerate() {
        let h_trim = h.trim();
        if idx < 2 { continue; }
        if h_trim == DELIVERY_HEADER { delivery_col = Some(idx); continue; }
        if h_trim == NOTE_HEADER { note_col = Some(idx); continue; }
        if !h_trim.is_empty() {
            menu_cols.push((idx, h_trim.to_string()));
        }
    }

    // --- Parse order rows ---
    let mut orders: Vec<ParsedOrder> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for r in (header_idx + 1)..rows.len() {
        let row = &rows[r];
        let channel = cell(row, 0);
        let customer = cell(row, 1);
        let all_qty_empty = menu_cols.iter().all(|(c, _)| cell(row, *c).is_empty());
        if channel.is_empty() && customer.is_empty() && all_qty_empty {
            continue;  // blank row, skip
        }
        if customer.is_empty() {
            errors.push(format!("Row {}: missing customer", r + 1));
            continue;
        }

        let mut items = Vec::new();
        for (col_idx, name) in &menu_cols {
            let s = cell(row, *col_idx);
            if s.is_empty() { continue; }
            match s.parse::<i64>() {
                Ok(q) if q > 0 => items.push(ParsedOrderItem { menu_name: name.clone(), quantity: q }),
                Ok(_) => {}
                Err(_) => errors.push(format!("Row {} col '{}': non-numeric qty '{}'", r + 1, name, s)),
            }
        }
        let delivery = delivery_col.and_then(|c| {
            let v = cell(row, c);
            if v.is_empty() { None } else { Some(v.to_string()) }
        });
        let notes = note_col.and_then(|c| {
            let v = cell(row, c);
            if v.is_empty() { None } else { Some(v.to_string()) }
        });
        let chan = if channel.is_empty() { None } else { Some(channel.to_string()) };
        orders.push(ParsedOrder {
            source_row: (r + 1) as i64,
            channel: chan,
            customer: customer.to_string(),
            delivery_location: delivery,
            notes,
            items,
        });
    }

    Ok(ParsedTab { menu, orders, parse_errors: errors })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vr(rows: Vec<Vec<&str>>) -> ValueRange {
        ValueRange {
            values: rows.into_iter()
                .map(|r| r.into_iter().map(String::from).collect()).collect(),
        }
    }

    #[test]
    fn parses_screenshot_shape() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["เค้กโคตรเผือกมะพร้าว", "", "10", "0", "129"],
            vec!["เค้กช็อคฟัดจ์", "", "16", "3", "85"],
            vec!["ทาร์ตลูกตาล", "", "10", "3", "110"],
            vec!["มัทฉะเลเยอร์", "", "10", "2", "165"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "เค้กโคตรเผือกมะพร้าว", "เค้กช็อคฟัดจ์",
                 "ทาร์ตลูกตาล", "มัทฉะเลเยอร์", "สถานที่ส่ง", "Note"],
            vec!["Page", "K.Parin", "1", "1", "1", "1", "บ้านรัตนรักษ์ SAT", "Packed"],
            vec!["Linea", "P'Mink", "", "", "", "2", "Pilates Timetable", "Packed"],
            vec![""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.menu.len(), 4);
        assert_eq!(p.menu[1], MenuRow { menu_name: "เค้กช็อคฟัดจ์".into(), price: 85 });
        assert_eq!(p.orders.len(), 2);
        assert_eq!(p.orders[0].customer, "K.Parin");
        assert_eq!(p.orders[0].items.len(), 4);
        assert_eq!(p.orders[1].items, vec![
            ParsedOrderItem { menu_name: "มัทฉะเลเยอร์".into(), quantity: 2 }
        ]);
        assert_eq!(p.orders[1].delivery_location.as_deref(), Some("Pilates Timetable"));
    }

    #[test]
    fn missing_header_errors() {
        let vr = vr(vec![
            vec!["Menu"],
            vec!["X", "", "1", "1", "10"],
        ]);
        let err = parse_tab(&vr).unwrap_err();
        assert!(matches!(err, ParseError::HeaderNotFound));
    }

    #[test]
    fn empty_menu_errors() {
        let vr = vr(vec![
            vec!["Menu"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "สถานที่ส่ง", "Note"],
        ]);
        let err = parse_tab(&vr).unwrap_err();
        assert!(matches!(err, ParseError::EmptyMenu));
    }

    #[test]
    fn non_numeric_qty_recorded_as_parse_error() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "1", "1", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "สถานที่ส่ง", "Note"],
            vec!["Page", "X", "ดู", "Y", ""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.orders.len(), 1);
        assert!(p.orders[0].items.is_empty());
        assert_eq!(p.parse_errors.len(), 1);
    }

    #[test]
    fn trailing_blank_rows_are_skipped() {
        let vr = vr(vec![
            vec!["Menu", "", "Total", "Left", "Price"],
            vec!["A", "", "1", "1", "100"],
            vec![""],
            vec!["ช่องทาง", "ลูกค้า", "A", "สถานที่ส่ง", "Note"],
            vec!["Page", "X", "1", "Y", ""],
            vec![""],
            vec!["", "", "", "", ""],
        ]);
        let p = parse_tab(&vr).unwrap();
        assert_eq!(p.orders.len(), 1);
    }
}
```

- [ ] **Step 3: Update `src-tauri/src/sheets/mod.rs`**

```rust
pub mod auth;
pub mod client;
pub mod parser;
pub mod week;
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib sheets::`
Expected: 7 passed (5 parser + 2 week).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sheets
git commit -m "feat(sheets): parser + week-date inference with table-driven tests"
```

---

## Phase D — Sync engine

### Task 10: Sync types + `preview_sync` (no writes)

**Files:**
- Create: `src-tauri/src/sync/mod.rs`
- Create: `src-tauri/src/sync/types.rs`
- Create: `src-tauri/src/sync/engine.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod sync;`)

- [ ] **Step 1: Create `src-tauri/src/sync/types.rs`**

```rust
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
    Existing { product_id: String },
    Create { name_th: String, name_en: Option<String>, selling_price: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomerMappingChoice {
    Existing { customer_id: String },
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
```

- [ ] **Step 2: Create `src-tauri/src/sync/engine.rs`**

```rust
use crate::db::{customers, orders, products};
use crate::sheets::client::SheetsClient;
use crate::sheets::parser::parse_tab;
use crate::sheets::week::parse_tab_week_start;
use crate::sync::types::*;
use anyhow::{anyhow, Result};
use chrono::Datelike;
use sqlx::SqlitePool;

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

    // Reconcile menu aliases
    let mut unknown_menus: Vec<UnknownMenu> = Vec::new();
    for m in &parsed.menu {
        if products::find_by_alias(pool, &m.menu_name).await?.is_none() {
            unknown_menus.push(UnknownMenu {
                alias: m.menu_name.clone(),
                suggested_price: m.price,
            });
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

    // Count insert/update/soft-delete
    let existing: Vec<(i64,)> = sqlx::query_as(
        r#"SELECT source_row FROM "order"
           WHERE source_tab = ? AND deleted_at IS NULL"#,
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
```

- [ ] **Step 3: Create `src-tauri/src/sync/mod.rs`**

```rust
pub mod engine;
pub mod types;
```

- [ ] **Step 4: Add `mod sync;` to `src-tauri/src/lib.rs`** (after `mod sheets;`):
```rust
mod sync;
```

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/sync src-tauri/src/lib.rs
git commit -m "feat(sync): preview_sync — fetch, parse, reconcile, count diff"
```

---

### Task 11: `apply_sync` transactional engine

**Files:**
- Modify: `src-tauri/src/sync/engine.rs`

- [ ] **Step 1: Append `apply_sync` to `src-tauri/src/sync/engine.rs`**

```rust
use crate::sheets::parser::ParsedOrder;
use std::collections::HashMap;

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
    let mut menu_alias_to_product: HashMap<String, String> = HashMap::new();
    for (alias, choice) in mappings.menu {
        let pid = match choice {
            MenuMappingChoice::Existing { product_id } => product_id,
            MenuMappingChoice::Create { name_th, name_en, selling_price } => {
                products::create(pool, &name_th, name_en.as_deref(), selling_price).await?.id
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
    // Also resolve top-menu prices keyed by alias for unit_price lookup.
    let menu_prices: HashMap<String, i64> = {
        let range = format!("{}!A1:E50", tab);
        let vr = sheets.get_values(spreadsheet_id, &range).await?;
        let parsed = parse_tab(&vr).map_err(|e| anyhow!(e.to_string()))?;
        parsed.menu.into_iter().map(|m| (m.menu_name, m.price)).collect()
    };

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

    // 3) Upsert orders in one transaction.
    let mut tx = pool.begin().await?;
    let mut added = 0i64;
    let mut updated = 0i64;
    let mut keep_rows: Vec<i64> = Vec::new();
    for ord in &preview.parsed_orders {
        let cust_id = customer_alias_to_id.get(&ord.customer)
            .ok_or_else(|| anyhow!("Unresolved customer {}", ord.customer))?.clone();

        let mut total: i64 = 0;
        let mut items: Vec<orders::UpsertOrderItemInput> = Vec::new();
        for item in &ord.items {
            let pid = menu_alias_to_product.get(&item.menu_name)
                .ok_or_else(|| anyhow!("Unresolved menu {}", item.menu_name))?;
            let unit = *menu_prices.get(&item.menu_name).unwrap_or(&0);
            total += unit * item.quantity;
            items.push(orders::UpsertOrderItemInput {
                product_id: pid,
                quantity: item.quantity,
                unit_price: unit,
            });
        }

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
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib sync::engine`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/engine.rs
git commit -m "feat(sync): apply_sync — transactional upsert, soft delete, sync_log"
```

---

## Phase E — Tauri commands

### Task 12: Shared `AppState` (db pool + sheets client) and init

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/state.rs`**

```rust
use crate::config::AppConfig;
use crate::sheets::auth::AuthClient;
use crate::sheets::client::{HttpSheetsClient, SheetsClient};
use anyhow::Result;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub db: SqlitePool,
    pub app_data_dir: PathBuf,
    sheets: RwLock<Option<Arc<dyn SheetsClient>>>,
}

impl AppState {
    pub async fn new(app_data_dir: PathBuf, db: SqlitePool) -> Self {
        Self { db, app_data_dir, sheets: RwLock::new(None) }
    }

    /// Build (or rebuild) a SheetsClient for the given service-account path.
    pub async fn ensure_sheets_client(&self, cfg: &AppConfig) -> Result<Arc<dyn SheetsClient>> {
        let mut guard = self.sheets.write().await;
        if let Some(c) = guard.as_ref() {
            return Ok(c.clone());
        }
        let sa_path = self.app_data_dir.join(&cfg.service_account_path);
        let auth = Arc::new(AuthClient::from_file(&sa_path)?);
        let client: Arc<dyn SheetsClient> = Arc::new(HttpSheetsClient::new(auth));
        *guard = Some(client.clone());
        Ok(client)
    }

    pub async fn invalidate_sheets_client(&self) {
        *self.sheets.write().await = None;
    }
}
```

- [ ] **Step 2: Modify `src-tauri/src/lib.rs`** to add state init + register modules

Replace the file with:

```rust
mod commands;
mod config;
mod db;
mod printer;
mod sheets;
mod state;
mod sync;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let app_data_dir = handle.path().app_data_dir()
                    .expect("resolve app_data_dir");
                std::fs::create_dir_all(&app_data_dir).ok();
                let db_path = app_data_dir.join("pos.sqlite");
                let pool = db::pool::init_pool(&db_path).await
                    .expect("init sqlite pool");
                let state = AppState::new(app_data_dir, pool).await;
                handle.manage(state);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::printer::test_printer,
            commands::printer::check_printer_status,
            commands::printer::print_receipt,
            commands::sync::test_sheets_connection,
            commands::sync::sync_week,
            commands::sync::apply_sync,
            commands::catalog::search_products,
            commands::catalog::search_customers,
            commands::orders::list_orders,
            commands::orders::get_order,
            commands::orders::print_order,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(The new command modules don't exist yet — next tasks add them. App won't compile until those are written; we keep this as the target and proceed.)

- [ ] **Step 3: Hold off on committing**

Don't commit yet — `cargo build` will fail because the referenced commands don't exist. Land this together with Tasks 13–15. Or: temporarily comment out the new handler lines, `cargo build`, then uncomment in Task 15. Recommended approach: **comment out** lines `commands::sync::*`, `commands::catalog::*`, `commands::orders::*` for now, restore them in Task 15.

```bash
cd src-tauri && cargo build
```
Expected: PASS with new handlers commented out.

- [ ] **Step 4: Commit (with handlers temporarily commented)**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(state): AppState with db pool + lazy sheets client; init in setup()"
```

---

### Task 13: Sync commands (`test_sheets_connection`, `sync_week`, `apply_sync`)

**Files:**
- Create: `src-tauri/src/commands/sync.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/sync.rs`**

```rust
use crate::config::AppConfig;
use crate::state::AppState;
use crate::sync::engine;
use crate::sync::types::{SyncMappings, SyncPreview, SyncResult};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsTabInfo {
    pub name: String,
}

#[tauri::command]
pub async fn test_sheets_connection(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<Vec<SheetsTabInfo>, String> {
    if config.spreadsheet_id.is_empty() {
        return Err("Spreadsheet ID is empty".to_string());
    }
    state.invalidate_sheets_client().await;
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    let tabs = client.list_tabs(&config.spreadsheet_id).await
        .map_err(|e| format!("Sheets API error: {}", e))?;
    Ok(tabs.into_iter().map(|name| SheetsTabInfo { name }).collect())
}

#[tauri::command]
pub async fn sync_week(
    state: State<'_, AppState>,
    config: AppConfig,
    tab: String,
) -> Result<SyncPreview, String> {
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    engine::preview_sync(&state.db, client.as_ref(), &config.spreadsheet_id, &tab).await
        .map_err(|e| format!("Sync preview failed: {}", e))
}

#[tauri::command]
pub async fn apply_sync(
    state: State<'_, AppState>,
    config: AppConfig,
    tab: String,
    mappings: SyncMappings,
) -> Result<SyncResult, String> {
    let client = state.ensure_sheets_client(&config).await
        .map_err(|e| format!("Auth error: {}", e))?;
    engine::apply_sync(&state.db, client.as_ref(), &config.spreadsheet_id, &tab, mappings).await
        .map_err(|e| format!("Apply sync failed: {}", e))
}
```

- [ ] **Step 2: Register submodule in `src-tauri/src/commands/mod.rs`**

Read current contents and add:
```rust
pub mod sync;
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/sync.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): sync_week, apply_sync, test_sheets_connection"
```

---

### Task 14: Catalog commands (`search_products`, `search_customers`)

**Files:**
- Create: `src-tauri/src/commands/catalog.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/catalog.rs`**

```rust
use crate::db::{customers, products};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn search_products(
    state: State<'_, AppState>,
    q: String,
    limit: Option<i64>,
) -> Result<Vec<products::ProductLite>, String> {
    products::search(&state.db, &q, limit.unwrap_or(20))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_customers(
    state: State<'_, AppState>,
    q: String,
    limit: Option<i64>,
) -> Result<Vec<customers::CustomerLite>, String> {
    customers::search(&state.db, &q, limit.unwrap_or(20))
        .await.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in `src-tauri/src/commands/mod.rs`** — append:

```rust
pub mod catalog;
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/catalog.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): search_products, search_customers"
```

---

### Task 15: Orders + print commands; restore handler registrations

**Files:**
- Create: `src-tauri/src/commands/orders.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/printer/receipt.rs` (verify `build_receipt` is `pub`)

- [ ] **Step 1: Check `src-tauri/src/printer/receipt.rs`** — ensure `pub fn build_receipt` and `pub struct ReceiptData`, `pub struct PrinterConfig` (already used by existing `print_receipt` command).

If `build_receipt` is not `pub`, change it to `pub` and re-export from `printer::receipt`. No new code if already public.

- [ ] **Step 2: Create `src-tauri/src/commands/orders.rs`**

```rust
use crate::config::AppConfig;
use crate::db::{customers, orders, products};
use crate::printer::network;
use crate::printer::receipt::{build_receipt, PrinterConfig, ReceiptData, ReceiptItem};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderListRow {
    pub id: String,
    pub order_number: String,
    pub customer_name: String,
    pub channel: Option<String>,
    pub total_amount: i64,
    pub source_tab: Option<String>,
    pub source_row: Option<i64>,
    pub printed_at: Option<String>,
    pub print_count: i64,
    pub deleted_at: Option<String>,
    pub order_date: String,
    pub notes: Option<String>,
    pub items_summary: String,
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
    pub items: Vec<OrderDetailItem>,
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
        out.push(OrderListRow {
            id: r.id, order_number: r.order_number, customer_name: cust,
            channel: r.channel, total_amount: r.total_amount,
            source_tab: r.source_tab, source_row: r.source_row,
            printed_at: r.printed_at, print_count: r.print_count,
            deleted_at: r.deleted_at, order_date: r.order_date,
            notes: r.notes, items_summary,
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
    Ok(Some(OrderDetail {
        id: r.id, order_number: r.order_number, customer_name: cust,
        channel: r.channel, delivery_location: r.delivery_location,
        notes: r.notes, status: r.status, total_amount: r.total_amount,
        discount: r.discount, delivery_fee: r.delivery_fee,
        order_date: r.order_date, source_tab: r.source_tab, source_row: r.source_row,
        printed_at: r.printed_at, print_count: r.print_count,
        deleted_at: r.deleted_at, items: detail_items,
    }))
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
            name, quantity: it.quantity as i32, price: it.unit_price as f64,
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
```

Note: this assumes the existing `ReceiptItem.price` is `f64`, `quantity` is `i32`, and the receipt builder accepts the existing shape. If field names/types differ, adjust the construction above to match `printer::receipt`. Inspect `printer/receipt.rs` once before writing and adjust this code only if fields differ.

- [ ] **Step 3: Register submodule and restore handler list**

Append to `src-tauri/src/commands/mod.rs`:
```rust
pub mod orders;
```

In `src-tauri/src/lib.rs`, uncomment (or ensure present) all handler lines in `invoke_handler!`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::config::load_config,
    commands::config::save_config,
    commands::printer::test_printer,
    commands::printer::check_printer_status,
    commands::printer::print_receipt,
    commands::sync::test_sheets_connection,
    commands::sync::sync_week,
    commands::sync::apply_sync,
    commands::catalog::search_products,
    commands::catalog::search_customers,
    commands::orders::list_orders,
    commands::orders::get_order,
    commands::orders::print_order,
])
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "feat(commands): list_orders/get_order/print_order + full handler wiring"
```

---

## Phase F — TypeScript

### Task 16: Reset TS types, drop `api.ts`, rewrite `tauri.ts` and `App.tsx` init

**Files:**
- Delete: `src/lib/api.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Replace `src/lib/types.ts`**

```typescript
// === Config (mirror of Rust AppConfig with camelCase serde) ===

export type TabStrategy =
  | 'latest'
  | 'currentWeek'
  | { pinned: string };

export interface AppConfig {
  printerIp: string;
  paperWidth: number;
  spreadsheetId: string;
  serviceAccountPath: string;
  defaultTabStrategy: TabStrategy;
  shopName: string;
  shopPhone: string;
  shopLine: string;
  promptpayType: string;        // "phone" | "id_card"
  promptpayValue: string;
  thankYouMessage: string;
}

// === Catalog ===

export interface ProductLite {
  id: string;
  nameTh: string;
  nameEn: string | null;
  sellingPrice: number;
}

export interface CustomerLite {
  id: string;
  name: string;
  nickname: string | null;
}

// === Orders ===

export interface OrderListRow {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: string | null;
  totalAmount: number;
  sourceTab: string | null;
  sourceRow: number | null;
  printedAt: string | null;
  printCount: number;
  deletedAt: string | null;
  orderDate: string;
  notes: string | null;
  itemsSummary: string;
}

export interface OrderDetailItem {
  productId: string;
  nameTh: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  status: string;
  totalAmount: number;
  discount: number;
  deliveryFee: number;
  orderDate: string;
  sourceTab: string | null;
  sourceRow: number | null;
  printedAt: string | null;
  printCount: number;
  deletedAt: string | null;
  items: OrderDetailItem[];
}

// === Sync ===

export interface UnknownMenu {
  alias: string;
  suggestedPrice: number;
}

export interface UnknownCustomer {
  alias: string;
}

export interface ParsedOrderItem {
  menuName: string;
  quantity: number;
}

export interface ParsedOrder {
  sourceRow: number;
  channel: string | null;
  customer: string;
  deliveryLocation: string | null;
  notes: string | null;
  items: ParsedOrderItem[];
}

export interface SyncPreview {
  tab: string;
  weekStartDate: string;
  unknownMenus: UnknownMenu[];
  unknownCustomers: UnknownCustomer[];
  parsedOrders: ParsedOrder[];
  willInsert: number;
  willUpdate: number;
  willSoftDelete: number;
  parseErrors: string[];
}

export type MenuMappingChoice =
  | { existing: { productId: string } }
  | { create: { nameTh: string; nameEn: string | null; sellingPrice: number } };

export type CustomerMappingChoice =
  | { existing: { customerId: string } }
  | { create: { name: string } };

export interface SyncMappings {
  menu: Array<[string, MenuMappingChoice]>;
  customer: Array<[string, CustomerMappingChoice]>;
}

export interface SyncResult {
  tab: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsSoftDeleted: number;
}

// === Receipt (existing) ===

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptData {
  customerName: string;
  items: ReceiptItem[];
  discountType: string;
  discount: number;
  deliveryFee: number;
}

export interface PrinterConfig {
  ip: string;
  paperWidth: number;
  shopName: string;
  shopPhone: string;
  shopLine: string;
  qrText: string;
  qrCodeType: string;
  qrCodeValue: string;
  thankYouMessage: string;
}

// === POSPage cart ===

export interface CartItem {
  product: ProductLite;
  quantity: number;
}
```

- [ ] **Step 2: Replace `src/lib/tauri.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  AppConfig,
  CustomerLite,
  OrderDetail,
  OrderListRow,
  ProductLite,
  ReceiptData,
  PrinterConfig,
  SyncMappings,
  SyncPreview,
  SyncResult,
} from './types';

export const appConfig = {
  load: () => invoke<AppConfig>('load_config'),
  save: (config: AppConfig) => invoke<string>('save_config', { config }),
};

export const printer = {
  test: (ip: string) => invoke<string>('test_printer', { ip }),
  checkStatus: (ip: string) => invoke<boolean>('check_printer_status', { ip }),
  printReceipt: (receipt: ReceiptData, config: PrinterConfig) =>
    invoke<string>('print_receipt', { receipt, config }),
};

export const sheets = {
  testConnection: (config: AppConfig) =>
    invoke<{ name: string }[]>('test_sheets_connection', { config }),
  syncWeek: (config: AppConfig, tab: string) =>
    invoke<SyncPreview>('sync_week', { config, tab }),
  applySync: (config: AppConfig, tab: string, mappings: SyncMappings) =>
    invoke<SyncResult>('apply_sync', { config, tab, mappings }),
};

export const catalog = {
  searchProducts: (q: string, limit = 20) =>
    invoke<ProductLite[]>('search_products', { q, limit }),
  searchCustomers: (q: string, limit = 20) =>
    invoke<CustomerLite[]>('search_customers', { q, limit }),
};

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
};
```

- [ ] **Step 3: Delete `src/lib/api.ts`**

```bash
git rm src/lib/api.ts
```

- [ ] **Step 4: Replace `src/App.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from './lib/types';
import { appConfig as tauriConfig } from './lib/tauri';
import StatusBar from './components/StatusBar';
import POSPage from './pages/POSPage';
import OrdersPage from './pages/OrdersPage';
import SyncPage from './pages/SyncPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'pos' | 'orders' | 'sync' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [initError, setInitError] = useState('');

  const initialize = useCallback(async () => {
    try {
      const loaded = await tauriConfig.load();
      setConfig(loaded);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to load config');
    }
  }, []);

  useEffect(() => { initialize(); }, [initialize]);

  const handleConfigSaved = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      <StatusBar printerIp={config?.printerIp || ''} />
      {initError && (
        <div className="bg-red-900/60 text-red-300 text-sm px-4 py-2 text-center">
          {initError}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos' && <POSPage appConfig={config} />}
        {activeTab === 'orders' && <OrdersPage appConfig={config} />}
        {activeTab === 'sync' && <SyncPage appConfig={config} />}
        {activeTab === 'settings' && (
          <SettingsPage appConfig={config} onConfigSaved={handleConfigSaved} />
        )}
      </div>
      <div className="flex border-t border-gray-700 bg-gray-800">
        <TabButton label="Orders" active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} />
        <TabButton label="Sync" active={activeTab === 'sync'} onClick={() => setActiveTab('sync')} />
        <TabButton label="POS" active={activeTab === 'pos'} onClick={() => setActiveTab('pos')} />
        <TabButton label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void; }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
        active
          ? 'text-blue-400 border-t-2 border-blue-400 bg-gray-900'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

export default App;
```

- [ ] **Step 5: Trim `src/components/StatusBar.tsx`** — remove any API-status references; keep only printer reachability + shop name. (Inspect existing file; remove only the API-dependent bits.)

- [ ] **Step 6: Build TS**

Run: `npm run build`
Expected: PASS (will fail on missing `SyncPage`/`POSPage`/etc props until later tasks — see note).

If build fails on missing `SyncPage` or broken `POSPage`/`OrdersPage`/`SettingsPage` props, **leave a stub** in each file that just renders `<div>TODO</div>` of the right component signature, just enough for the build to pass. The next tasks fill them in. Commit after.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts src/App.tsx src/components/StatusBar.tsx
git rm src/lib/api.ts
git commit -m "feat(ts): drop API client; new typed tauri.ts; add Sync tab in App"
```

---

### Task 17: `SearchPicker` reusable component

**Files:**
- Create: `src/components/SearchPicker.tsx`

- [ ] **Step 1: Create `src/components/SearchPicker.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';

export interface SearchResult {
  id: string;
  primary: string;
  secondary?: string | null;
}

interface SearchPickerProps {
  placeholder?: string;
  search: (q: string) => Promise<SearchResult[]>;
  onPick: (item: SearchResult) => void;
  onCreate: () => void;
  selected?: SearchResult | null;
  createLabel?: string;
}

export default function SearchPicker({
  placeholder = 'Search…',
  search,
  onPick,
  onCreate,
  selected,
  createLabel = '+ Create new',
}: SearchPickerProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(async () => {
      if (q.trim().length === 0) { setResults([]); return; }
      setLoading(true);
      try {
        setResults(await search(q.trim()));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [q, open, search]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={selected ? selected.primary : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto z-10">
            {loading && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
            {!loading && results.length === 0 && q.trim().length > 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => { onPick(r); setOpen(false); setQ(''); }}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                <div>{r.primary}</div>
                {r.secondary && <div className="text-xs text-gray-400">{r.secondary}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onCreate}
        className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg whitespace-nowrap"
      >
        {createLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles by running the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/SearchPicker.tsx
git commit -m "feat(ui): SearchPicker reusable typeahead + create button"
```

---

### Task 18: `MappingForm` component

**Files:**
- Create: `src/components/MappingForm.tsx`

- [ ] **Step 1: Create `src/components/MappingForm.tsx`**

```tsx
import { useState } from 'react';
import { catalog } from '../lib/tauri';
import type {
  CustomerMappingChoice,
  MenuMappingChoice,
  SyncMappings,
  SyncPreview,
} from '../lib/types';
import SearchPicker, { type SearchResult } from './SearchPicker';

interface MappingFormProps {
  preview: SyncPreview;
  onApply: (mappings: SyncMappings) => void;
  onCancel: () => void;
  applying: boolean;
}

type MenuRow = {
  alias: string;
  suggestedPrice: number;
  selected: SearchResult | null;
  draft: { nameTh: string; nameEn: string; sellingPrice: number } | null;
};

type CustomerRow = {
  alias: string;
  selected: SearchResult | null;
  draft: { name: string } | null;
};

export default function MappingForm({ preview, onApply, onCancel, applying }: MappingFormProps) {
  const [menuRows, setMenuRows] = useState<MenuRow[]>(
    preview.unknownMenus.map((m) => ({
      alias: m.alias, suggestedPrice: m.suggestedPrice, selected: null, draft: null,
    }))
  );
  const [customerRows, setCustomerRows] = useState<CustomerRow[]>(
    preview.unknownCustomers.map((c) => ({ alias: c.alias, selected: null, draft: null }))
  );

  const menuResolved = menuRows.every((r) => r.selected !== null || r.draft !== null);
  const customerResolved = customerRows.every((r) => r.selected !== null || r.draft !== null);
  const canApply = menuResolved && customerResolved;

  const buildMappings = (): SyncMappings => ({
    menu: menuRows.map((r): [string, MenuMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { productId: r.selected.id } }
        : { create: {
            nameTh: r.draft!.nameTh,
            nameEn: r.draft!.nameEn.trim() ? r.draft!.nameEn : null,
            sellingPrice: r.draft!.sellingPrice,
          } },
    ]),
    customer: customerRows.map((r): [string, CustomerMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { customerId: r.selected.id } }
        : { create: { name: r.draft!.name } },
    ]),
  });

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">
          Resolve unknowns — {preview.tab}
        </h2>
        <span className="text-sm text-gray-400">
          +{preview.willInsert} new / ~{preview.willUpdate} updated / −{preview.willSoftDelete} removed
        </span>
      </header>

      {menuRows.length > 0 && (
        <section>
          <h3 className="text-white font-semibold mb-3">
            Unknown menu names ({menuRows.length})
          </h3>
          <div className="space-y-3">
            {menuRows.map((row, i) => (
              <MenuRowEditor key={row.alias} row={row} onChange={(updated) =>
                setMenuRows((rows) => rows.map((r, idx) => idx === i ? updated : r))} />
            ))}
          </div>
        </section>
      )}

      {customerRows.length > 0 && (
        <section>
          <h3 className="text-white font-semibold mb-3">
            Unknown customers ({customerRows.length})
          </h3>
          <div className="space-y-3">
            {customerRows.map((row, i) => (
              <CustomerRowEditor key={row.alias} row={row} onChange={(updated) =>
                setCustomerRows((rows) => rows.map((r, idx) => idx === i ? updated : r))} />
            ))}
          </div>
        </section>
      )}

      {preview.parseErrors.length > 0 && (
        <section className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3">
          <h4 className="text-yellow-300 font-semibold mb-1">Parse warnings</h4>
          <ul className="text-yellow-200 text-sm list-disc list-inside">
            {preview.parseErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
          Cancel
        </button>
        <button
          onClick={() => onApply(buildMappings())}
          disabled={!canApply || applying}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg"
        >
          {applying ? 'Applying…' : 'Apply mappings & sync'}
        </button>
      </div>
    </div>
  );
}

function MenuRowEditor({ row, onChange }: {
  row: MenuRow;
  onChange: (r: MenuRow) => void;
}) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-white font-medium">{row.alias}</span>
          <span className="text-gray-400 text-sm ml-2">฿{row.suggestedPrice}</span>
        </div>
        {(row.selected || row.draft) && (
          <button onClick={() => onChange({ ...row, selected: null, draft: null })}
            className="text-xs text-gray-400 hover:text-white">Clear</button>
        )}
      </div>
      {!row.draft && (
        <SearchPicker
          placeholder="Map to existing product…"
          search={async (q) => {
            const items = await catalog.searchProducts(q);
            return items.map((p) => ({
              id: p.id, primary: p.nameTh, secondary: p.nameEn ?? null,
            }));
          }}
          onPick={(r) => onChange({ ...row, selected: r, draft: null })}
          onCreate={() => onChange({
            ...row, selected: null,
            draft: { nameTh: row.alias, nameEn: '', sellingPrice: row.suggestedPrice },
          })}
          selected={row.selected}
        />
      )}
      {row.draft && (
        <div className="grid grid-cols-3 gap-2">
          <input value={row.draft.nameTh}
            onChange={(e) => onChange({ ...row, draft: { ...row.draft!, nameTh: e.target.value } })}
            placeholder="Name (Thai)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
          <input value={row.draft.nameEn}
            onChange={(e) => onChange({ ...row, draft: { ...row.draft!, nameEn: e.target.value } })}
            placeholder="Name (English, optional)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
          <input type="number" value={row.draft.sellingPrice}
            onChange={(e) => onChange({ ...row,
              draft: { ...row.draft!, sellingPrice: parseInt(e.target.value || '0', 10) } })}
            placeholder="Price (THB)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
        </div>
      )}
    </div>
  );
}

function CustomerRowEditor({ row, onChange }: {
  row: CustomerRow;
  onChange: (r: CustomerRow) => void;
}) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-white font-medium">{row.alias}</span>
        {(row.selected || row.draft) && (
          <button onClick={() => onChange({ ...row, selected: null, draft: null })}
            className="text-xs text-gray-400 hover:text-white">Clear</button>
        )}
      </div>
      {!row.draft && (
        <SearchPicker
          placeholder="Map to existing customer…"
          search={async (q) => {
            const items = await catalog.searchCustomers(q);
            return items.map((c) => ({
              id: c.id, primary: c.name, secondary: c.nickname ?? null,
            }));
          }}
          onPick={(r) => onChange({ ...row, selected: r, draft: null })}
          onCreate={() => onChange({ ...row, selected: null, draft: { name: row.alias } })}
          selected={row.selected}
        />
      )}
      {row.draft && (
        <input value={row.draft.name}
          onChange={(e) => onChange({ ...row, draft: { name: e.target.value } })}
          placeholder="Canonical name"
          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MappingForm.tsx
git commit -m "feat(ui): MappingForm — searchable + create for menu and customers"
```

---

### Task 19: `SyncPage`

**Files:**
- Create: `src/pages/SyncPage.tsx`

- [ ] **Step 1: Create `src/pages/SyncPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { sheets } from '../lib/tauri';
import type { AppConfig, SyncMappings, SyncPreview, SyncResult } from '../lib/types';
import MappingForm from '../components/MappingForm';

interface SyncPageProps {
  appConfig: AppConfig | null;
}

export default function SyncPage({ appConfig }: SyncPageProps) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadTabs = useCallback(async () => {
    if (!appConfig || !appConfig.spreadsheetId) {
      setError('Configure Spreadsheet ID and service account in Settings');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await sheets.testConnection(appConfig);
      const names = result.map((t) => t.name);
      setTabs(names);
      if (names.length > 0 && !selectedTab) setSelectedTab(names[names.length - 1]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [appConfig, selectedTab]);

  useEffect(() => { loadTabs(); }, [loadTabs]);

  const runSync = async () => {
    if (!appConfig || !selectedTab) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const p = await sheets.syncWeek(appConfig, selectedTab);
      setPreview(p);
      if (p.unknownMenus.length === 0 && p.unknownCustomers.length === 0) {
        // No unknowns — apply immediately with empty mappings.
        await doApply({ menu: [], customer: [] }, p);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doApply = async (mappings: SyncMappings, p: SyncPreview) => {
    if (!appConfig) return;
    setApplying(true); setError('');
    try {
      const res: SyncResult = await sheets.applySync(appConfig, p.tab, mappings);
      setMessage(`Synced ${p.tab}: +${res.rowsAdded} new, ~${res.rowsUpdated} updated, −${res.rowsSoftDeleted} removed`);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      <header className="p-4 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-white text-xl font-bold flex-1">Sync from Google Sheet</h2>
        <select
          value={selectedTab}
          onChange={(e) => setSelectedTab(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={loadTabs} disabled={busy}
          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
          Refresh tabs
        </button>
        <button onClick={runSync} disabled={busy || !selectedTab}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm">
          Sync now
        </button>
      </header>

      {error && (
        <div className="bg-red-900/60 text-red-200 px-4 py-2 text-sm">{error}</div>
      )}
      {message && (
        <div className="bg-green-900/60 text-green-200 px-4 py-2 text-sm">{message}</div>
      )}

      <div className="flex-1 overflow-hidden">
        {preview && (preview.unknownMenus.length > 0 || preview.unknownCustomers.length > 0) ? (
          <MappingForm
            preview={preview}
            applying={applying}
            onApply={(m) => doApply(m, preview)}
            onCancel={() => setPreview(null)}
          />
        ) : (
          <div className="p-4 text-gray-400 text-sm">
            {busy ? 'Working…' : 'Pick a tab and click Sync now.'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SyncPage.tsx
git commit -m "feat(ui): SyncPage — tab picker, sync now, mapping flow, status banners"
```

---

### Task 20: Rewrite `OrdersPage` against local DB

**Files:**
- Modify: `src/pages/OrdersPage.tsx`

- [ ] **Step 1: Replace `src/pages/OrdersPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ordersApi } from '../lib/tauri';
import type { AppConfig, OrderListRow } from '../lib/types';

interface OrdersPageProps { appConfig: AppConfig | null; }

export default function OrdersPage({ appConfig }: OrdersPageProps) {
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<string>('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await ordersApi.list({
        tab: filterTab || undefined,
        includeDeleted: showRemoved,
        limit: 500,
      });
      setOrders(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterTab, showRemoved]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handlePrint = async (row: OrderListRow) => {
    if (!appConfig) return;
    setPrintingId(row.id);
    try {
      await ordersApi.print(appConfig, row.id);
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrintingId(null);
    }
  };

  const tabs = Array.from(new Set(orders.map((o) => o.sourceTab).filter((t): t is string => !!t)));

  return (
    <div className="h-full flex flex-col bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-white text-xl font-bold flex-1">Orders</h2>
        <select value={filterTab} onChange={(e) => setFilterTab(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm">
          <option value="">All weeks</option>
          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="text-sm text-gray-300 flex items-center gap-1">
          <input type="checkbox" checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)} />
          Show removed
        </label>
        <button onClick={fetchOrders}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/60 text-red-200 px-3 py-2 text-sm rounded mb-2">{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">No orders</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="text-gray-400 text-sm text-left">
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}
                    className={`border-b border-gray-800 ${o.deletedAt ? 'opacity-50' : 'hover:bg-gray-800/50'}`}>
                  <td className="px-3 py-2 text-white text-sm font-mono">{o.orderNumber}</td>
                  <td className="px-3 py-2 text-white text-sm">{o.customerName}</td>
                  <td className="px-3 py-2 text-gray-300 text-sm">{o.channel ?? ''}</td>
                  <td className="px-3 py-2 text-gray-300 text-sm">{o.itemsSummary}</td>
                  <td className="px-3 py-2 text-white text-sm text-right">฿{o.totalAmount}</td>
                  <td className="px-3 py-2 text-gray-400 text-sm">{o.notes ?? ''}</td>
                  <td className="px-3 py-2">
                    {o.deletedAt ? (
                      <span className="text-xs text-yellow-400">removed</span>
                    ) : (
                      <button onClick={() => handlePrint(o)}
                        disabled={printingId === o.id}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded">
                        {printingId === o.id
                          ? 'Printing…'
                          : o.printedAt ? `✓ Reprint (${o.printCount})` : '🖨 Print'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/OrdersPage.tsx
git commit -m "feat(ui): OrdersPage reads local DB; print + reprint with printed-state badge"
```

---

### Task 21: Repoint `POSPage` ad-hoc charge to local DB (minimal)

**Files:**
- Modify: `src/pages/POSPage.tsx`
- Modify: `src/components/PaymentDialog.tsx`
- Modify: `src/components/CustomerSearch.tsx`
- Modify: `src/stores/cart.ts` (only as needed)

The existing cart-based POSPage submits via the dead API. The minimal repair is: when the user charges, build a `ReceiptData` directly from cart state, print via `printer.printReceipt`, and DON'T persist (the Sheet is canonical). This preserves the emergency-print path with **zero local DB writes** from POSPage.

- [ ] **Step 1: Inspect current `PaymentDialog.tsx`** to find where it calls `api.orders.create` or similar.

- [ ] **Step 2: Modify `PaymentDialog.tsx`** — replace the API-create + print path with: build `ReceiptData` + `PrinterConfig` from cart store + appConfig, call `printer.printReceipt`, then `clear()` the cart.

Show the replacement code for the submit handler (adapt names to match the file):

```tsx
import { printer } from '../lib/tauri';
import type { ReceiptData, PrinterConfig } from '../lib/types';

// inside the submit handler:
if (!appConfig) throw new Error('Config not loaded');
const receipt: ReceiptData = {
  customerName: customerName || '(walk-in)',
  items: items.map((it) => ({
    name: it.product.nameTh,
    quantity: it.quantity,
    price: it.product.sellingPrice,
  })),
  discountType,
  discount: discountValue,
  deliveryFee,
};
const printerCfg: PrinterConfig = {
  ip: appConfig.printerIp,
  paperWidth: appConfig.paperWidth,
  shopName: appConfig.shopName,
  shopPhone: appConfig.shopPhone,
  shopLine: appConfig.shopLine,
  qrText: 'Scan to Pay',
  qrCodeType: appConfig.promptpayType,
  qrCodeValue: appConfig.promptpayValue,
  thankYouMessage: appConfig.thankYouMessage,
};
await printer.printReceipt(receipt, printerCfg);
clearCart();
onClose();
```

- [ ] **Step 3: Modify `CustomerSearch.tsx`** — replace any `api.customers.search` call with `catalog.searchCustomers` from `lib/tauri`.

- [ ] **Step 4: Modify `POSPage.tsx`** — remove the `products` prop / loading state. Replace the `ProductGrid` source with an inline `useEffect` that loads the local catalog:

```tsx
import { useEffect, useState } from 'react';
import type { ProductLite, AppConfig } from '../lib/types';
import { catalog } from '../lib/tauri';
import { useCartStore } from '../stores/cart';
import ProductGrid from '../components/ProductGrid';
import Cart from '../components/Cart';
import PaymentDialog from '../components/PaymentDialog';

interface POSPageProps { appConfig: AppConfig | null; }

export default function POSPage({ appConfig }: POSPageProps) {
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  useEffect(() => {
    (async () => {
      try {
        setProducts(await catalog.searchProducts('', 500));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex h-full">
      <div className="w-[60%] h-full bg-gray-900">
        <ProductGrid products={products} onAddToCart={addItem} loading={loading} />
      </div>
      <div className="w-[40%] h-full border-l border-gray-700">
        <Cart onCharge={() => setShowPayment(true)} />
      </div>
      {showPayment && (
        <PaymentDialog onClose={() => setShowPayment(false)} appConfig={appConfig} />
      )}
    </div>
  );
}
```

The empty `q = ''` search returns no rows because `LIKE '%%'` matches all. **Adjust `products::search`**: in `src-tauri/src/db/products.rs`, change the WHERE clause so an empty `q` returns all active rows:

```rust
pub async fn search(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<ProductLite>, sqlx::Error> {
    if q.is_empty() {
        return sqlx::query_as::<_, ProductLite>(
            "SELECT id, name_th, name_en, selling_price FROM product WHERE is_active = 1 ORDER BY name_th LIMIT ?"
        ).bind(limit).fetch_all(pool).await;
    }
    let like = format!("%{}%", q);
    sqlx::query_as::<_, ProductLite>(
        r#"SELECT id, name_th, name_en, selling_price FROM product
           WHERE is_active = 1 AND (name_th LIKE ? OR COALESCE(name_en, '') LIKE ?)
           ORDER BY name_th LIMIT ?"#,
    ).bind(&like).bind(&like).bind(limit).fetch_all(pool).await
}
```

Apply the same empty-q fix to `customers::search`.

- [ ] **Step 5: Update `src/stores/cart.ts`** — change `Product` import to `ProductLite`:

```typescript
import type { ProductLite, CartItem } from '../lib/types';
// ...
addItem: (product: ProductLite) => ...
```

- [ ] **Step 6: Build**

Run: `npm run build && cd src-tauri && cargo build`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/POSPage.tsx src/components/PaymentDialog.tsx src/components/CustomerSearch.tsx src/stores/cart.ts src-tauri/src/db/products.rs src-tauri/src/db/customers.rs
git commit -m "feat(ui): POSPage uses local catalog; PaymentDialog prints directly; empty-q lists all"
```

---

### Task 22: Restructure `SettingsPage` (Sheets section + Shop section, drop API)

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Replace `src/pages/SettingsPage.tsx`** with sections for Printer, Google Sheets, and Shop. (Existing file likely already has Printer; preserve that shape and add the other two.)

Full file:

```tsx
import { useEffect, useState } from 'react';
import { appConfig as tauriConfig, printer, sheets } from '../lib/tauri';
import type { AppConfig, TabStrategy } from '../lib/types';

interface SettingsPageProps {
  appConfig: AppConfig | null;
  onConfigSaved: (cfg: AppConfig) => void;
}

export default function SettingsPage({ appConfig, onConfigSaved }: SettingsPageProps) {
  const [cfg, setCfg] = useState<AppConfig | null>(appConfig);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => { setCfg(appConfig); }, [appConfig]);

  if (!cfg) return <div className="p-4 text-gray-400">Loading config…</div>;

  const update = (patch: Partial<AppConfig>) => setCfg({ ...cfg, ...patch });

  const save = async () => {
    setError(''); setMessage('');
    try {
      await tauriConfig.save(cfg);
      onConfigSaved(cfg);
      setMessage('Settings saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const testPrinter = async () => {
    setError(''); setMessage('');
    try { await printer.test(cfg.printerIp); setMessage('Test page sent'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const testSheets = async () => {
    setError(''); setMessage('');
    try {
      const result = await sheets.testConnection(cfg);
      setTabs(result.map((t) => t.name));
      setMessage(`Found ${result.length} tabs`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const strategyValue: string =
    cfg.defaultTabStrategy === 'latest' ? 'latest'
      : cfg.defaultTabStrategy === 'currentWeek' ? 'currentWeek'
      : 'pinned';

  const setStrategy = (v: string, pinned?: string) => {
    let s: TabStrategy = 'latest';
    if (v === 'currentWeek') s = 'currentWeek';
    if (v === 'pinned') s = { pinned: pinned ?? '' };
    update({ defaultTabStrategy: s });
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 bg-gray-900 text-white">
      <header>
        <h2 className="text-xl font-bold">Settings</h2>
        {error && <div className="mt-2 bg-red-900/60 text-red-200 px-3 py-2 text-sm rounded">{error}</div>}
        {message && <div className="mt-2 bg-green-900/60 text-green-200 px-3 py-2 text-sm rounded">{message}</div>}
      </header>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Printer</h3>
        <LabeledInput label="Printer IP" value={cfg.printerIp}
          onChange={(v) => update({ printerIp: v })} />
        <div className="flex items-center gap-3">
          <label className="text-sm">Paper width</label>
          <select value={cfg.paperWidth}
            onChange={(e) => update({ paperWidth: parseInt(e.target.value, 10) })}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value={58}>58 mm</option>
            <option value={80}>80 mm</option>
          </select>
          <button onClick={testPrinter}
            className="ml-auto px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Test print
          </button>
        </div>
      </section>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Google Sheets</h3>
        <LabeledInput label="Spreadsheet ID" value={cfg.spreadsheetId}
          onChange={(v) => update({ spreadsheetId: v })} />
        <LabeledInput label="Service account file"
          value={cfg.serviceAccountPath}
          onChange={(v) => update({ serviceAccountPath: v })}
          help="Filename relative to app data dir (default: service-account.json). Place the JSON key file in that folder." />
        <div className="flex items-center gap-3">
          <label className="text-sm">Default tab</label>
          <select value={strategyValue}
            onChange={(e) => setStrategy(e.target.value,
              typeof cfg.defaultTabStrategy === 'object' ? cfg.defaultTabStrategy.pinned : '')}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value="latest">Latest tab</option>
            <option value="currentWeek">Current ISO week</option>
            <option value="pinned">Pinned</option>
          </select>
          {strategyValue === 'pinned' && (
            <input
              value={typeof cfg.defaultTabStrategy === 'object' ? cfg.defaultTabStrategy.pinned : ''}
              onChange={(e) => setStrategy('pinned', e.target.value)}
              placeholder="Tab name (e.g. Order_30)"
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm" />
          )}
          <button onClick={testSheets}
            className="ml-auto px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Test connection
          </button>
        </div>
        {tabs.length > 0 && (
          <div className="text-xs text-gray-400">Tabs: {tabs.join(', ')}</div>
        )}
      </section>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Shop</h3>
        <LabeledInput label="Shop name" value={cfg.shopName} onChange={(v) => update({ shopName: v })} />
        <LabeledInput label="Phone" value={cfg.shopPhone} onChange={(v) => update({ shopPhone: v })} />
        <LabeledInput label="LINE ID" value={cfg.shopLine} onChange={(v) => update({ shopLine: v })} />
        <div className="flex items-center gap-3">
          <label className="text-sm w-40">PromptPay type</label>
          <select value={cfg.promptpayType}
            onChange={(e) => update({ promptpayType: e.target.value })}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value="phone">Phone</option>
            <option value="id_card">ID card</option>
          </select>
        </div>
        <LabeledInput label="PromptPay value" value={cfg.promptpayValue}
          onChange={(v) => update({ promptpayValue: v })} />
        <LabeledInput label="Thank-you message" value={cfg.thankYouMessage}
          onChange={(v) => update({ thankYouMessage: v })} />
      </section>

      <div className="flex justify-end">
        <button onClick={save}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg">
          Save settings
        </button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, help }: {
  label: string; value: string; onChange: (v: string) => void; help?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-300">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm" />
      {help && <span className="text-xs text-gray-500">{help}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Build full app**

Run: `npm run build && cd src-tauri && cargo build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(ui): SettingsPage — Printer + Google Sheets + Shop sections"
```

---

## Phase G — Manual smoke test

### Task 23: End-to-end smoke test in dev

**Files:** none

- [ ] **Step 1: Start dev**

Run: `npm run tauri dev`
Expected: App launches; default to Orders tab; empty list shown.

- [ ] **Step 2: Configure Sheets**

In Settings: paste a real `spreadsheetId`. Drop a real `service-account.json` into the app data dir (path shown in Settings help). Click **Test connection**. Expected: tab list appears.

- [ ] **Step 3: Configure Shop + Printer**

Fill shop name, phone, LINE, PromptPay, printer IP. **Save settings**. **Test print** to verify printer.

- [ ] **Step 4: First sync of current week tab**

Go to Sync tab → select `Order_<n>` → **Sync now**. Expected: mapping screen appears with N unknown menus + M unknown customers. For each menu, click **+ Create new**; verify pre-fill (name + price). For customers, **+ Create new** with default name. Click **Apply mappings & sync**. Expected: green banner "Synced Order_<n>: +K new …".

- [ ] **Step 5: Verify orders**

Go to Orders tab → filter to that week. Expected: all rows from the sheet, with items summary and totals.

- [ ] **Step 6: Print a receipt**

Click 🖨 on one row. Expected: receipt prints; row shows ✓ Reprint (1).

- [ ] **Step 7: Re-sync (idempotency)**

Add a new row in the Sheet (or modify a quantity). Back in Sync tab → **Sync now**. Expected: if new aliases, mapping screen for those only. After apply, Orders tab shows the new row; the already-printed row still shows ✓.

- [ ] **Step 8: Soft-delete**

Delete a row in the Sheet. **Sync now** → apply. In Orders tab, toggle **Show removed**. Expected: deleted row appears with "removed" badge.

- [ ] **Step 9: Network failure path**

Disable network. Sync tab → **Sync now** → expected red banner with sheets error. Orders tab still lists synced rows; print still works.

- [ ] **Step 10: Commit no-code outcomes**

If any minor fixes were needed during smoke test, commit them individually. Otherwise nothing to commit.

---

## Self-Review

- [x] Spec coverage:
  - Architecture, schema, sync invariants → Tasks 3, 6, 10, 11
  - Service-account auth, Sheets client, parser → Tasks 7–9
  - Manual mapping with search + create → Tasks 17, 18
  - Tab discovery + week date → Tasks 9 (week.rs), 13 (test_sheets_connection), 19, 22
  - Print flow + reprint preserves printed_at → Tasks 6 (`mark_printed`), 15 (`print_order`), 20
  - Settings: API removed, Sheets + Shop added → Tasks 2, 16, 22
  - Config migration → Task 2
  - Error handling (auth/parse/transaction rollback) → Tasks 7, 9, 11, 13
  - Edge cases (red cells, empty qty, trailing rows, name with K./P', deleted rows) → Task 9 (parser tests), Task 11 (engine tests)
  - Out-of-scope items (writeback, polling, export) → not implemented (correct).

- Placeholders: none.

- Type consistency: `ProductLite`/`CustomerLite` used in commands match TS types; `SyncMappings`/`SyncPreview`/`SyncResult` shapes match Rust serde rename_all="camelCase"; `MenuMappingChoice`/`CustomerMappingChoice` use serde untagged enum semantics — confirmed via `rename_all = "camelCase"` on enum → TS shape `{ existing: ... } | { create: ... }`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-sheet-sync-local-store-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session, batched with checkpoints.

Which approach?
