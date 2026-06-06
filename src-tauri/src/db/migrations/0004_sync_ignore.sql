-- Lets the cashier hide records the sync should not touch.
--
-- Two kinds of "noise" show up in the weekly sheet:
--   * menu column headers that are typos / leftovers and should not become
--     products (sync_ignored_menu)
--   * order rows that are duplicated, mistaken, or trailing garbage and should
--     not sync (sync_ignored_row)
--
-- Both are scoped per tab (source_tab) because the sheet is rebuilt weekly and
-- an ignore decision in one week should not silently suppress a same-named
-- entry in another.

CREATE TABLE sync_ignored_menu (
    source_tab TEXT NOT NULL,
    alias      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_tab, alias)
);

CREATE TABLE sync_ignored_row (
    source_tab TEXT NOT NULL,
    source_row INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_tab, source_row)
);
