# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Granny's POS** (`grannys-pos`) is a Tauri 2 desktop point-of-sale app. A small
bakery's orders are entered into a weekly Google Sheet; this app syncs those
orders into a local SQLite store and prints receipts (with PromptPay QR codes)
to a network thermal printer. Thai-language receipts.

- **Frontend**: React 18 + TypeScript + Vite, Tailwind + Radix/shadcn UI, Zustand for cart state.
- **Backend**: Rust (`src-tauri/`) — SQLite via `sqlx`, Google Sheets HTTP client, ESC/POS printing.

## Commands

```bash
npm run tauri dev        # run the full desktop app (Rust + webview) — use this, not `npm run dev`
npm run dev              # vite-only frontend on :1420 (no Tauri APIs; invoke() calls fail)
npm run build            # tsc typecheck + vite build (frontend only)
npm run tauri build      # build distributable .dmg / .msi

npm test                 # frontend unit tests (vitest run)
npx vitest run src/lib/orderEdit.test.ts   # single file
npx vitest run -t "merge"                  # by test name
npm run test:e2e         # Playwright layout tests (spins up vite on :1420)

cd src-tauri && cargo test                 # all Rust tests
cd src-tauri && cargo test preview_sync    # single Rust test by name
```

There is no separate lint script; `npm run build` runs `tsc` as the typecheck gate.

## Architecture

### IPC boundary (the spine)
All frontend↔backend calls go through `src/lib/tauri.ts`, which wraps
`@tauri-apps/api` `invoke()`. Every command it calls **must** be registered in
the `invoke_handler!` macro in `src-tauri/src/lib.rs`. Adding a feature that
crosses the boundary means touching three places: the Rust command in
`src-tauri/src/commands/`, the registration in `lib.rs`, and the typed wrapper
in `tauri.ts`.

JS sends **camelCase** args; Rust structs use `#[serde(rename_all = "camelCase")]`
so e.g. `printerIp` ↔ `printer_ip`. Keep both sides in sync or the call silently
fails to deserialize.

### Backend layers (`src-tauri/src/`)
- `commands/` — thin Tauri command handlers (config, printer, sync, catalog, orders). Validation + orchestration only.
- `db/` — `sqlx` data access. SQLite at `<app_data_dir>/pos.sqlite`, WAL mode, foreign keys on. Schema lives in `db/migrations/*.sql` (run automatically at startup via `sqlx::migrate!`). Tables: `order`, `order_item`, `product`, `customer`, `product_alias`, `customer_alias`, `sync_log`, `tab_week_mapping`, sync-ignore. **Schema changes = new numbered migration file**, never edit an applied one.
- `sheets/` — Google Sheets: service-account JWT auth (`auth.rs`), HTTP client (`client.rs`), tab parsing (`parser.rs`), week-from-tab-name logic (`week.rs`).
- `sync/engine.rs` — the most intricate module; read it before touching sync. See below.
- `printer/` — ESC/POS over TCP (`network.rs`), receipt layout (`receipt.rs`), Thai text shaping (`thai.rs`), PromptPay QR (`promptpay.rs`).
- `state.rs` — `AppState` holds the DB pool, the live `AppConfig` (loaded once at startup; commands read `state.config()` rather than taking config per-call — only the "test what I typed" commands `test_sheets_connection`/`test_printer` take explicit input), and a lazily-built, cached `SheetsClient` (dropped on `save_config`). `config.rs` — `AppConfig` (persisted as JSON); `load_or_init` is the single load path, `migrate_from_json` gives forward-compat on old config files.

### The sync engine (`sync/engine.rs`)
Two-phase: `preview_sync` (read-only diff shown to the user) → `apply_sync`
(writes). The hard part is **menu alias reconciliation**: a weekly tab has two
surfaces holding menu names — a top summary table (column A, carries prices) and
the order-table column headers (what each order row references, often a
shortened/Thai form). They're maintained in the *same order*, so price is
recovered **positionally** (column N ↔ summary row N). The engine surfaces
*unknown* menus (no product alias), *drifted* prices (sheet price ≠ bound
product's price — surfaced, never silently applied), and honors per-tab
**ignore** lists for rows and menu names. Catalog mutations (new aliases/prices)
commit before the order transaction.

### Frontend (`src/`)
- `App.tsx` — four tabs (Orders, Sync, POS, Settings), each a page in `pages/`.
- `stores/cart.ts` — Zustand cart (items, customer, discount, delivery fee, totals).
- `lib/types.ts` — shared TS types mirroring the Rust serde structs (single source of truth for the IPC payload shapes).
- `components/ui/` — shadcn/Radix primitives; `components/` — app components.
- Order-edit and aggregation logic (`lib/orderEdit.ts`, `lib/aggregateOrderItems.ts`) is unit-tested in isolation — prefer adding logic there over inline in components.

### Tests
- **vitest** (`src/**/*.test.{ts,tsx}`, jsdom) for unit/component logic.
- **Playwright** (`e2e/`) exists *only* for CSS layout bugs jsdom can't catch (overflow/ellipsis). Don't put logic tests here.
- **cargo test** for all backend logic; sync/db tests use an in-memory SQLite pool (`db::pool::init_memory_pool`).

## Notes
- Design specs and plans live in `docs/superpowers/`; architecture decisions in `docs/adr/`.
- Requires the webview Tauri runtime for any `invoke()` to work — pure-vite `npm run dev` is only useful for static UI work.
