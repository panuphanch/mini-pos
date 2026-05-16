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
